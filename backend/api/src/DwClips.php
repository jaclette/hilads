<?php

declare(strict_types=1);

/**
 * Stock video clips for "Different Worlds" topics in video mode: one per slide,
 * found from the slide's clip_query on Pexels (PEXELS_API_KEY), else Pixabay
 * (PIXABAY_API_KEY). Only the chosen clip's details are stored (dw_slides.clip);
 * the Mac downloads the file when it renders the video (tools/promo, cached).
 *
 * Both licenses allow social media use with no attribution required; Pexels'
 * API asks to credit the videographer and Pixabay's to show the source, so the
 * slide reads "Video: <author>, <Pexels|Pixabay>" and the admin links the page.
 * Searches are cached 24 h (dw_clip_searches): Pixabay's terms, and Pexels
 * allows 200 requests an hour.
 *
 * Which file: a portrait clip fills the 1080×1920 frame from a file at least
 * 1280 px tall (the smallest 1920+ when there is one); a landscape clip is
 * cropped to 9:16, so only from 1440 px tall (2560×1440: 810×1440 kept).
 */
final class DwClips
{
    public const LICENSES = ['pexels' => 'Pexels License', 'pixabay' => 'Pixabay Content License'];
    public const NAMES    = ['pexels' => 'Pexels', 'pixabay' => 'Pixabay'];

    /** A slide lasts up to 4.5 s plus its 8-frame crossfade. */
    public const NEED_SECONDS = 4.8;
    /** Shorter clips are slowed down to fill it, never below 0.65×. */
    public const MIN_RATE     = 0.65;
    /** Longer clips mean bigger files for nothing. */
    public const MAX_SECONDS  = 40;
    public const PORTRAIT_MIN = 1280;
    public const PORTRAIT_FULL = 1920;
    public const LANDSCAPE_MIN = 1440;
    private const CACHE_HOURS = 24;

    public static function configured(): bool
    {
        return self::key('pexels') !== null || self::key('pixabay') !== null;
    }

    private static function key(string $provider): ?string
    {
        $k = trim((string) getenv($provider === 'pexels' ? 'PEXELS_API_KEY' : 'PIXABAY_API_KEY'));
        return $k === '' ? null : $k;
    }

    /**
     * The first usable clip for $query that isn't in $tried ("provider:id"),
     * best first: Pexels portrait, Pixabay portrait, then landscape from either.
     * Null: none. Throws RuntimeException when a provider refused (rate limit)
     * and nothing usable was found elsewhere: the slide can be retried later.
     */
    public static function pick(string $query, array $tried = []): ?array
    {
        $query = self::normalize($query);
        if ($query === '') {
            return null;
        }
        $portrait = [];
        $landscape = [];
        $refused = null;
        foreach (['pexels', 'pixabay'] as $provider) {
            if (self::key($provider) === null) {
                continue;
            }
            try {
                foreach (self::search($provider, $query) as $clip) {
                    if (in_array($clip['provider'] . ':' . $clip['id'], $tried, true)) {
                        continue;
                    }
                    if ($clip['height'] > $clip['width']) {
                        $portrait[] = $clip;
                    } else {
                        $landscape[] = $clip;
                    }
                }
            } catch (RuntimeException $e) {
                $refused = $e;
            }
            // Pexels' portraits are enough: Pixabay isn't asked (requests and its 24 h cache spared).
            if ($portrait !== []) {
                break;
            }
        }
        $best = $portrait[0] ?? $landscape[0] ?? null;
        if ($best === null && $refused !== null) {
            throw $refused;
        }
        return $best === null ? null : $best + ['query' => $query];
    }

    /** The usable clips of one provider for a query, in its order (cached 24 h). */
    private static function search(string $provider, string $query): array
    {
        $pdo = Database::pdo();
        $stmt = $pdo->prepare("SELECT results FROM dw_clip_searches WHERE provider = ? AND query = ? AND fetched_at > now() - make_interval(hours => ?)");
        $stmt->execute([$provider, $query, self::CACHE_HOURS]);
        $cached = $stmt->fetchColumn();
        if ($cached !== false) {
            return json_decode((string) $cached, true) ?: [];
        }
        $clips = $provider === 'pexels' ? self::pexels($query) : self::pixabay($query);
        $pdo->prepare("
            INSERT INTO dw_clip_searches (provider, query, results, fetched_at) VALUES (?, ?, ?::jsonb, now())
            ON CONFLICT (provider, query) DO UPDATE SET results = EXCLUDED.results, fetched_at = now()
        ")->execute([$provider, $query, json_encode($clips, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);
        return $clips;
    }

    private static function pexels(string $query): array
    {
        $out = [];
        // Portrait first; landscape only when no portrait is usable (one more request).
        foreach (['portrait', 'landscape'] as $orientation) {
            $json = self::get('https://api.pexels.com/v1/videos/search?' . http_build_query([
                'query' => $query, 'orientation' => $orientation, 'per_page' => 20,
            ]), ['Authorization: ' . self::key('pexels')]);
            foreach ($json['videos'] ?? [] as $v) {
                $files = [];
                foreach ($v['video_files'] ?? [] as $f) {
                    if (($f['file_type'] ?? '') === 'video/mp4' && !empty($f['link']) && (int) ($f['width'] ?? 0) > 0) {
                        $files[] = ['url' => (string) $f['link'], 'width' => (int) $f['width'], 'height' => (int) $f['height']];
                    }
                }
                $clip = self::clip('pexels', (string) $v['id'], (float) ($v['duration'] ?? 0), $files,
                    (string) ($v['url'] ?? ''), (string) ($v['user']['name'] ?? ''), (string) ($v['user']['url'] ?? ''), (string) ($v['image'] ?? ''));
                if ($clip !== null) {
                    $out[] = $clip;
                }
            }
            if (array_filter($out, static fn($c) => $c['height'] > $c['width']) !== []) {
                break;
            }
        }
        return $out;
    }

    private static function pixabay(string $query): array
    {
        $json = self::get('https://pixabay.com/api/videos/?' . http_build_query([
            'key' => self::key('pixabay'), 'q' => mb_substr($query, 0, 100), 'video_type' => 'film', 'safesearch' => 'true', 'per_page' => 50,
        ]));
        $out = [];
        foreach ($json['hits'] ?? [] as $v) {
            $files = [];
            foreach (['large', 'medium', 'small', 'tiny'] as $size) {
                $f = $v['videos'][$size] ?? null;
                if (is_array($f) && !empty($f['url']) && (int) ($f['width'] ?? 0) > 0) {
                    $files[] = ['url' => (string) $f['url'], 'width' => (int) $f['width'], 'height' => (int) $f['height']];
                }
            }
            $user = (string) ($v['user'] ?? '');
            $clip = self::clip('pixabay', (string) $v['id'], (float) ($v['duration'] ?? 0), $files, (string) ($v['pageURL'] ?? ''),
                $user, $user !== '' ? 'https://pixabay.com/users/' . rawurlencode($user) . '-' . (int) ($v['user_id'] ?? 0) . '/' : '',
                (string) ($v['videos']['tiny']['thumbnail'] ?? ''));
            if ($clip !== null) {
                $out[] = $clip;
            }
        }
        return $out;
    }

    /**
     * A clip we can use, or null: long enough (slowed down at most to MIN_RATE),
     * not too long, with a file sharp enough for the 1080×1920 frame. Pure.
     */
    public static function clip(string $provider, string $id, float $duration, array $files, string $pageUrl,
                                string $author, string $authorUrl, string $image): ?array
    {
        if ($duration < self::NEED_SECONDS * self::MIN_RATE || $duration > self::MAX_SECONDS || $files === []) {
            return null;
        }
        $file = self::bestFile($files);
        if ($file === null) {
            return null;
        }
        usort($files, static fn($a, $b) => $a['width'] * $a['height'] <=> $b['width'] * $b['height']);
        $rate = $duration >= self::NEED_SECONDS ? 1.0 : round($duration / self::NEED_SECONDS, 3);
        return [
            'provider'    => $provider,
            'id'          => $id,
            'page_url'    => $pageUrl,
            'file_url'    => $file['url'],
            'width'       => $file['width'],
            'height'      => $file['height'],
            // The admin's preview: the lightest file.
            'preview_url' => $files[0]['url'],
            'image'       => $image,
            'duration'    => $duration,
            'rate'        => $rate,
            // Past a clip's first half second (often a fade-in) when it is long enough.
            'start'       => $duration >= self::NEED_SECONDS + 1 ? 0.5 : 0.0,
            'author'      => $author,
            'author_url'  => $authorUrl,
            'license'     => self::LICENSES[$provider],
        ];
    }

    /** The smallest file sharp enough for the frame, or null. Pure. */
    public static function bestFile(array $files): ?array
    {
        $ok = [];
        foreach ($files as $f) {
            $portrait = $f['height'] > $f['width'];
            $min = $portrait ? self::PORTRAIT_MIN : self::LANDSCAPE_MIN;
            if ($f['height'] >= $min) {
                $ok[] = $f + ['full' => $portrait && $f['height'] >= self::PORTRAIT_FULL];
            }
        }
        if ($ok === []) {
            return null;
        }
        // A full-size portrait file when there is one, then the fewest pixels.
        usort($ok, static fn($a, $b) => [$b['full'], $a['width'] * $a['height']] <=> [$a['full'], $b['width'] * $b['height']]);
        unset($ok[0]['full']);
        return $ok[0];
    }

    /** The slide's credit line: "Video: <author>, Pexels". */
    public static function credit(array $clip): string
    {
        $name = trim((string) ($clip['author'] ?? ''));
        return 'Video: ' . ($name !== '' ? $name . ', ' : '') . (self::NAMES[$clip['provider'] ?? ''] ?? 'stock');
    }

    public static function normalize(string $query): string
    {
        return mb_strtolower(trim((string) preg_replace('/\s+/', ' ', $query)));
    }

    /** GET JSON; RuntimeException on a refusal (rate limit, bad key) or a network failure. */
    private static function get(string $url, array $headers = []): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_HTTPHEADER => $headers,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_USERAGENT => 'HiladsWorlds/1.0 (https://hilads.live)']);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if (!is_string($body) || $code !== 200) {
            $host = (string) parse_url($url, PHP_URL_HOST);
            throw new RuntimeException($code === 429 ? "{$host}: request limit reached, try again later" : "{$host}: HTTP {$code}");
        }
        return json_decode($body, true) ?: [];
    }
}
