<?php

declare(strict_types=1);

/**
 * Open Graph link preview fetcher + cache.
 *
 * Backs the GET /api/v1/link-preview endpoint that the chat clients (web +
 * mobile) call when a message contains a URL. First call fetches + parses; the
 * result is cached for 24 h on success and 1 h on failure so the same URL
 * across many messages costs one network hop.
 *
 * Safety:
 *  - http/https only.
 *  - SSRF guard: hostname resolved to an IP that must NOT be private/reserved.
 *  - 5 s total timeout, 3 s connect timeout, max 3 redirects.
 *  - Response body capped at 1 MB via CURLOPT_WRITEFUNCTION (curl aborts
 *    cleanly when the limit is exceeded).
 *  - Final URL (post-redirect) re-checked through the same guard.
 */
final class LinkPreviewService
{
    private const TTL_SUCCESS    = 86400;    // 24 h
    private const TTL_FAILURE    = 3600;     // 1 h
    private const MAX_BYTES      = 1048576;  // 1 MB
    private const TIMEOUT_S      = 5;
    private const CONNECT_S      = 3;
    private const MAX_REDIRECTS  = 3;
    private const URL_MAX_LEN    = 2048;
    private const HEAD_PARSE_MAX = 131072;   // 128 KB cap on the <head> slice we regex through

    /** Return a cached or freshly-fetched preview. Null if the URL fails the SSRF guard. */
    public static function get(string $url): ?array
    {
        $url = trim($url);
        if (!self::isSafeUrl($url)) return null;

        $hash = sha1($url);
        $pdo  = Database::pdo();

        $stmt = $pdo->prepare(
            "SELECT url, title, description, image, site_name
               FROM link_previews
              WHERE url_hash = ? AND ttl_until > now()"
        );
        $stmt->execute([$hash]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if ($row !== false) return $row;

        $parsed  = self::fetchAndParse($url);
        $success = ($parsed['title'] !== null) || ($parsed['image'] !== null);
        $ttl     = $success ? self::TTL_SUCCESS : self::TTL_FAILURE;

        $pdo->prepare("
            INSERT INTO link_previews (url_hash, url, title, description, image, site_name, fetched_at, ttl_until)
            VALUES (?, ?, ?, ?, ?, ?, now(), now() + (INTERVAL '1 second' * ?))
            ON CONFLICT (url_hash) DO UPDATE SET
                title       = EXCLUDED.title,
                description = EXCLUDED.description,
                image       = EXCLUDED.image,
                site_name   = EXCLUDED.site_name,
                fetched_at  = now(),
                ttl_until   = EXCLUDED.ttl_until
        ")->execute([
            $hash, $url,
            $parsed['title'], $parsed['description'], $parsed['image'], $parsed['site_name'],
            $ttl,
        ]);

        return [
            'url'         => $url,
            'title'       => $parsed['title'],
            'description' => $parsed['description'],
            'image'       => $parsed['image'],
            'site_name'   => $parsed['site_name'],
        ];
    }

    /** http/https only, sane length, hostname resolves to a non-private/non-reserved IP. */
    public static function isSafeUrl(string $url): bool
    {
        if ($url === '' || strlen($url) > self::URL_MAX_LEN) return false;
        $p = parse_url($url);
        if ($p === false || !isset($p['scheme'], $p['host'])) return false;
        $scheme = strtolower((string) $p['scheme']);
        if ($scheme !== 'http' && $scheme !== 'https') return false;
        $host = strtolower((string) $p['host']);
        if ($host === '' || $host === 'localhost') return false;

        $ip = filter_var($host, FILTER_VALIDATE_IP) ? $host : gethostbyname($host);
        // gethostbyname returns the host unchanged on failure → reject.
        if ($ip === $host && !filter_var($ip, FILTER_VALIDATE_IP)) return false;
        // FILTER_FLAG_NO_PRIV_RANGE blocks RFC1918 + ULA; NO_RES_RANGE blocks
        // loopback, link-local, multicast, reserved, etc. Returns false on bad ip.
        return (bool) filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE,
        );
    }

    /** Returns ['title' => ?, 'description' => ?, 'image' => ?, 'site_name' => ?]. */
    private static function fetchAndParse(string $url): array
    {
        $body     = '';
        $maxBytes = self::MAX_BYTES;

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION  => true,
            CURLOPT_MAXREDIRS       => self::MAX_REDIRECTS,
            CURLOPT_TIMEOUT         => self::TIMEOUT_S,
            CURLOPT_CONNECTTIMEOUT  => self::CONNECT_S,
            CURLOPT_USERAGENT       => 'Hilads-Preview/1.0 (+https://hilads.live/)',
            CURLOPT_ACCEPT_ENCODING => '',  // negotiate gzip/deflate
            CURLOPT_PROTOCOLS       => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_WRITEFUNCTION   => function ($_ch, $chunk) use (&$body, $maxBytes) {
                $body .= $chunk;
                if (strlen($body) > $maxBytes) return -1; // signal abort
                return strlen($chunk);
            },
        ]);
        curl_exec($ch);
        $code     = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $finalUrl = (string) (curl_getinfo($ch, CURLINFO_EFFECTIVE_URL) ?: $url);
        curl_close($ch);

        $empty = ['title' => null, 'description' => null, 'image' => null, 'site_name' => null];
        if ($code < 200 || $code >= 300 || $body === '') return $empty;
        // Re-validate post-redirect URL against the SSRF guard.
        if (!self::isSafeUrl($finalUrl)) return $empty;

        return self::parseHtml($body, $finalUrl);
    }

    private static function parseHtml(string $html, string $baseUrl): array
    {
        // Only parse the <head> slice - sites put OG/title there, and bounding
        // the regex domain keeps catastrophic backtracking out of reach.
        $headPos = stripos($html, '</head>');
        $head = $headPos !== false ? substr($html, 0, $headPos + 7) : substr($html, 0, self::HEAD_PARSE_MAX);

        $g = function (string $pattern) use ($head): ?string {
            if (preg_match($pattern, $head, $m)) {
                return self::decode(trim($m[1]));
            }
            return null;
        };

        // Try both attribute orderings for each meta tag (property/content vs content/property).
        $title = $g('/<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']*)["\']/i')
              ?? $g('/<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\']og:title["\']/i')
              ?? $g('/<title[^>]*>([^<]+)<\/title>/i');

        $desc = $g('/<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']*)["\']/i')
             ?? $g('/<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\']og:description["\']/i')
             ?? $g('/<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)["\']/i')
             ?? $g('/<meta[^>]+content=["\']([^"\']*)["\'][^>]+name=["\']description["\']/i');

        $image = $g('/<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']*)["\']/i')
              ?? $g('/<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\']og:image["\']/i');

        $site = $g('/<meta[^>]+property=["\']og:site_name["\'][^>]+content=["\']([^"\']*)["\']/i')
             ?? $g('/<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\']og:site_name["\']/i');

        // Resolve relative og:image against the (post-redirect) base URL; then
        // require http(s) - drop any data: / javascript: / etc.
        if ($image !== null && !preg_match('#^https?://#i', $image)) {
            $image = self::resolveUrl($baseUrl, $image);
        }
        if ($image !== null && !preg_match('#^https?://#i', $image)) {
            $image = null;
        }

        // Bound the size of each field (DB-level too via DOM, but UI cares).
        if ($title !== null) $title = mb_substr($title, 0, 200);
        if ($desc  !== null) $desc  = mb_substr($desc,  0, 400);
        if ($site  !== null) $site  = mb_substr($site,  0, 80);
        if ($image !== null) $image = mb_substr($image, 0, 1024);

        return [
            'title'       => $title,
            'description' => $desc,
            'image'       => $image,
            'site_name'   => $site,
        ];
    }

    private static function decode(string $s): string
    {
        return html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    private static function resolveUrl(string $base, string $rel): string
    {
        if ($rel === '') return $base;
        if (str_starts_with($rel, '//')) {
            $scheme = parse_url($base, PHP_URL_SCHEME) ?: 'https';
            return $scheme . ':' . $rel;
        }
        $b = parse_url($base);
        if (!$b || !isset($b['scheme'], $b['host'])) return $rel;
        $origin = $b['scheme'] . '://' . $b['host'] . (isset($b['port']) ? ':' . $b['port'] : '');
        if (str_starts_with($rel, '/')) return $origin . $rel;
        $path = $b['path'] ?? '/';
        $dir  = substr($path, 0, strrpos($path, '/') + 1);
        return $origin . $dir . $rel;
    }
}
