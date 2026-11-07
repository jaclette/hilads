<?php

declare(strict_types=1);

/**
 * Reaction clips from Pixabay for "Different Worlds" topics in the reaction
 * format (Admin › Worlds › "Find another clip"). PIXABAY_API_KEY comes from the
 * environment (Render), never logged nor sent to the browser.
 *
 * Pixabay Content License (https://pixabay.com/service/license-summary/): free
 * for commercial use, no attribution required (we credit anyway), modifying
 * allowed; not allowed: redistributing it as is, recognisable brands used
 * commercially, immoral or illegal use (especially with recognisable people),
 * misleading use. API rules: searches cached 24 h, no permanent hotlinking: a
 * chosen clip is copied to R2 (DwStudio::setReactionClip).
 */
final class DwPixabay
{
    public const LICENSE = 'Pixabay Content License';
    public const LICENSE_URL = 'https://pixabay.com/service/license-summary/';
    private const API = 'https://pixabay.com/api/videos/';
    private const CACHE_SECONDS = 86400;
    private const UA = 'HiladsWorlds/1.0 (https://hilads.live; Different Worlds reaction clips)';
    // The top third of the screen is 1080 × 640: the smallest rendition that covers it is enough.
    private const MIN_WIDTH = 1080;
    private const MIN_HEIGHT = 640;

    public static function configured(): bool
    {
        return trim((string) getenv('PIXABAY_API_KEY')) !== '';
    }

    /** Up to 20 videos for a query, newest search cached 24 h: [hit] (see hit()). */
    public static function search(string $query): array
    {
        $query = trim(preg_replace('/\s+/u', ' ', $query) ?? '');
        if ($query === '' || mb_strlen($query) > 100) {
            throw new InvalidArgumentException('A search of 1 to 100 characters is needed.');
        }
        $body = self::call(['q' => $query, 'safesearch' => 'true', 'per_page' => 20, 'order' => 'popular']);
        return array_values(array_filter(array_map([self::class, 'hit'], $body['hits'] ?? [])));
    }

    /** One video by its Pixabay id, or null. */
    public static function byId(int $id): ?array
    {
        if ($id <= 0) {
            return null;
        }
        $body = self::call(['id' => (string) $id]);
        $hit = $body['hits'][0] ?? null;
        return is_array($hit) ? self::hit($hit) : null;
    }

    /**
     * A video as we use it: {id, page, author, tags, duration, width, height, thumb, url, ai},
     * url = the smallest rendition covering 1080 × 640, else the largest; null without a file. Pure.
     */
    public static function hit(array $h): ?array
    {
        $files = array_values(array_filter((array) ($h['videos'] ?? []), static fn($v) => is_array($v) && !empty($v['url'])));
        if ($files === []) {
            return null;
        }
        usort($files, static fn($a, $b) => ((int) ($a['width'] ?? 0)) <=> ((int) ($b['width'] ?? 0)));
        $pick = end($files);
        foreach ($files as $f) {
            if ((int) ($f['width'] ?? 0) >= self::MIN_WIDTH && (int) ($f['height'] ?? 0) >= self::MIN_HEIGHT) {
                $pick = $f;
                break;
            }
        }
        $tags = trim((string) ($h['tags'] ?? ''));
        return [
            'id'       => (int) ($h['id'] ?? 0),
            'page'     => (string) ($h['pageURL'] ?? ''),
            'author'   => (string) ($h['user'] ?? ''),
            'tags'     => $tags,
            'duration' => (int) ($h['duration'] ?? 0),
            'width'    => (int) ($pick['width'] ?? 0),
            'height'   => (int) ($pick['height'] ?? 0),
            'thumb'    => (string) ($pick['thumbnail'] ?? ''),
            'url'      => (string) $pick['url'],
            'ai'       => self::aiTagged($tags),
        ];
    }

    /** Pixabay tags its AI-generated media "ai generated". Pure. */
    public static function aiTagged(string $tags): bool
    {
        return (bool) preg_match('/(^|,)\s*ai[ -]generated\s*(,|$)/i', $tags);
    }

    /** A clip file we download: an mp4 on Pixabay's CDN. Pure. */
    public static function fileOk(string $url): bool
    {
        return (bool) preg_match('#^https://cdn\.pixabay\.com/video/\S+\.mp4(\?\S*)?$#i', trim($url));
    }

    /** The clip file's bytes (mp4, 60 MB at most). */
    public static function download(string $url): string
    {
        if (!self::fileOk($url)) {
            throw new InvalidArgumentException('Not a Pixabay video file.');
        }
        $ch = curl_init(trim($url));
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 90, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXFILESIZE => 60 * 1024 * 1024, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_USERAGENT => self::UA]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if (!is_string($body) || $code !== 200 || strlen($body) < 1000) {
            throw new RuntimeException("the clip could not be downloaded (HTTP {$code})");
        }
        return $body;
    }

    /** A GET on the API, cached 24 h (Pixabay's rule) in the temp folder. Errors never include the key. */
    private static function call(array $params): array
    {
        if (!self::configured()) {
            throw new RuntimeException('PIXABAY_API_KEY is not set on the server.');
        }
        ksort($params);
        $cache = sys_get_temp_dir() . '/hilads-pixabay-' . sha1(json_encode($params)) . '.json';
        if (is_file($cache) && filemtime($cache) > time() - self::CACHE_SECONDS) {
            $cached = json_decode((string) file_get_contents($cache), true);
            if (is_array($cached)) {
                return $cached;
            }
        }
        $ch = curl_init(self::API . '?' . http_build_query(['key' => trim((string) getenv('PIXABAY_API_KEY'))] + $params));
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_USERAGENT => self::UA]);
        $raw = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($code === 429) {
            throw new RuntimeException('Pixabay is rate-limiting us: try again in a minute.');
        }
        $body = is_string($raw) ? json_decode($raw, true) : null;
        if ($code !== 200 || !is_array($body)) {
            throw new RuntimeException("Pixabay did not answer (HTTP {$code}).");
        }
        @file_put_contents($cache, $raw);
        return $body;
    }
}
