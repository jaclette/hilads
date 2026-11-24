<?php

declare(strict_types=1);

/**
 * Launch Season photos (Admin › Launch Season › Photos): the season's real photos for the prize
 * screen and the cards, stored in contest_seasons.photos as
 * [{url, caption, credit, source: pixabay|own, sourceUrl, license}].
 *
 * Two ways in, nothing else (never a random web image):
 * - Pixabay (PIXABAY_API_KEY, on Render): an image search, a picked photo is copied to R2 (the
 *   API forbids permanent hotlinking) with its author, page and the Pixabay Content License
 *   (free for commercial use, no attribution required: we credit anyway; AI-tagged hits skipped).
 * - Our own photo, uploaded from the admin (credit as typed).
 * Reads the network and R2 only; the admin writes contest_seasons.
 */
final class ContestPhotos
{
    public const LICENSE = 'Pixabay Content License';
    public const LICENSE_URL = 'https://pixabay.com/service/license-summary/';
    private const API = 'https://pixabay.com/api/';
    private const UA = 'HiladsLaunchSeason/1.0 (https://hilads.live; contest photos)';
    public const MAX = 12;

    /** The season's photos (normalized). */
    public static function of(array $season): array
    {
        $raw = $season['photos'] ?? [];
        if (is_string($raw)) $raw = json_decode($raw, true);
        if (!is_array($raw)) return [];
        $out = [];
        foreach ($raw as $p) {
            if (!is_array($p) || !preg_match('#^https?://#', (string) ($p['url'] ?? ''))) continue;
            $out[] = [
                'url' => (string) $p['url'], 'caption' => (string) ($p['caption'] ?? ''), 'credit' => (string) ($p['credit'] ?? ''),
                'source' => (string) ($p['source'] ?? 'own'), 'sourceUrl' => (string) ($p['sourceUrl'] ?? ''), 'license' => (string) ($p['license'] ?? ''),
            ];
        }
        return $out;
    }

    /** What the apps get: url, caption, credit line. */
    public static function payload(array $season): array
    {
        return array_map(static fn(array $p): array => [
            'url' => $p['url'], 'caption' => $p['caption'],
            'credit' => $p['credit'] !== '' ? ($p['source'] === 'pixabay' ? $p['credit'] . ' · Pixabay' : $p['credit']) : '',
        ], self::of($season));
    }

    public static function configured(): bool
    {
        return trim((string) getenv('PIXABAY_API_KEY')) !== '';
    }

    /** Up to 24 landscape photos for a query (cached 24 h, Pixabay's rule), AI-tagged ones left out. */
    public static function search(string $query): array
    {
        $query = trim(preg_replace('/\s+/u', ' ', $query) ?? '');
        if ($query === '' || mb_strlen($query) > 100) throw new InvalidArgumentException('A search of 1 to 100 characters is needed.');
        if (!self::configured()) throw new RuntimeException('PIXABAY_API_KEY is not set on the server.');
        $params = ['q' => $query, 'image_type' => 'photo', 'orientation' => 'horizontal', 'safesearch' => 'true',
                   'per_page' => 24, 'min_width' => 1600, 'order' => 'popular'];
        ksort($params);
        $cache = sys_get_temp_dir() . '/hilads-pixabay-img-' . sha1(json_encode($params)) . '.json';
        if (is_file($cache) && filemtime($cache) > time() - 86400) {
            $body = json_decode((string) file_get_contents($cache), true);
        } else {
            $ch = curl_init(self::API . '?' . http_build_query(['key' => trim((string) getenv('PIXABAY_API_KEY'))] + $params));
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_USERAGENT => self::UA, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS]);
            $raw  = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_close($ch);
            if (!is_string($raw) || $code !== 200) throw new RuntimeException("Pixabay did not answer (HTTP {$code}).");
            $body = json_decode($raw, true);
            if (is_array($body)) @file_put_contents($cache, $raw);
        }
        $out = [];
        foreach ((array) ($body['hits'] ?? []) as $h) {
            if (!is_array($h) || preg_match('/\b(ai generated|ai-generated|generative|midjourney|stable diffusion)\b/i', (string) ($h['tags'] ?? ''))) continue;
            if (empty($h['largeImageURL']) || empty($h['pageURL'])) continue;
            // The same photo on Pixabay's image CDN (the API's previewURL, _150 -> _640 / _1280): pixabay.com/get
            // links are throttled (429) for servers and refused to browsers sending a referrer.
            $cdn = (string) ($h['previewURL'] ?? '');
            $isCdn = (bool) preg_match('#^https://cdn\.pixabay\.com/photo/\S+_150\.(jpe?g|png)$#i', $cdn);
            $out[] = ['id' => (int) $h['id'],
                      'preview' => $isCdn ? preg_replace('/_150\.(jpe?g|png)$/i', '_640.$1', $cdn) : (string) ($h['webformatURL'] ?? ''),
                      'large' => $isCdn ? preg_replace('/_150\.(jpe?g|png)$/i', '_1280.$1', $cdn) : (string) $h['largeImageURL'],
                      'fallback' => (string) $h['largeImageURL'],
                      'page' => (string) $h['pageURL'], 'user' => (string) ($h['user'] ?? ''), 'tags' => (string) ($h['tags'] ?? '')];
        }
        return $out;
    }

    /** Copies a picked Pixabay photo to R2: the stored entry. */
    public static function importPixabay(string $large, string $page, string $user, string $caption, string $fallback = ''): array
    {
        $ok = static fn(string $u): bool => (bool) preg_match('#^https://(pixabay\.com/get/|cdn\.pixabay\.com/photo/)\S+\.(jpe?g|png)(\?\S*)?$#i', $u);
        if (!$ok($large)) throw new InvalidArgumentException('Not a Pixabay photo file.');
        if (!preg_match('#^https://pixabay\.com/\S+#', $page)) throw new InvalidArgumentException('Not a Pixabay page.');
        // The CDN rendition first, then the API's own link; one short retry when throttled.
        $bytes = null; $code = 0;
        foreach (array_values(array_unique(array_filter([$large, $ok($fallback) ? $fallback : '']))) as $url) {
            for ($try = 0; $try < 2 && $bytes === null; $try++) {
                if ($try) sleep(2);
                [$bytes, $code] = self::fetch($url);
                if ($code !== 429) break;
            }
            if ($bytes !== null) break;
        }
        if ($bytes === null) throw new RuntimeException("The photo could not be downloaded (HTTP {$code}). Try again in a minute.");
        $tmp = tempnam(sys_get_temp_dir(), 'lsp');
        file_put_contents($tmp, $bytes);
        try {
            $url = self::store($tmp);
        } finally {
            @unlink($tmp);
        }
        return ['url' => $url, 'caption' => self::clean($caption, 60), 'credit' => self::clean($user, 60), 'source' => 'pixabay',
                'sourceUrl' => $page, 'license' => self::LICENSE];
    }

    /** [bytes or null, HTTP code]. */
    private static function fetch(string $url): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 45, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXFILESIZE => 15 * 1024 * 1024, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_USERAGENT => self::UA]);
        $bytes = curl_exec($ch);
        $code  = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return [is_string($bytes) && $code === 200 && strlen($bytes) >= 5000 ? $bytes : null, $code];
    }

    /** Our own photo (an admin upload): the stored entry. */
    public static function importUpload(array $file, string $credit, string $caption): array
    {
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
            throw new InvalidArgumentException('Choose a photo to upload.');
        }
        if ($file['size'] > 15 * 1024 * 1024) throw new InvalidArgumentException('The photo must be under 15 MB.');
        $url = self::store($file['tmp_name']);
        return ['url' => $url, 'caption' => self::clean($caption, 60), 'credit' => self::clean($credit, 60) ?: 'Hilads', 'source' => 'own',
                'sourceUrl' => '', 'license' => 'Own photo'];
    }

    /** A JPEG/PNG/WebP, metadata stripped and at most 2000 px, put on R2: its URL. */
    private static function store(string $path): string
    {
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($path) ?: '';
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) throw new InvalidArgumentException('A JPEG, PNG or WebP photo is needed.');
        $info = @getimagesize($path);
        if (!$info || $info[0] < 800) throw new InvalidArgumentException('The photo must be at least 800 px wide.');
        $clean = ImageProcessor::stripMetadata($path, $mime, 2000) ?? $path;
        $outMime = (new \finfo(FILEINFO_MIME_TYPE))->file($clean) ?: $mime;
        $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'][$outMime] ?? 'jpg';
        $name = 'contest/' . bin2hex(random_bytes(12)) . '.' . $ext;
        try {
            return R2Uploader::put($clean, $name, $outMime);
        } finally {
            if ($clean !== $path) @unlink($clean);
        }
    }

    private static function clean(string $s, int $max): string
    {
        return mb_substr(trim(preg_replace('/\s+/u', ' ', $s) ?? ''), 0, $max);
    }
}
