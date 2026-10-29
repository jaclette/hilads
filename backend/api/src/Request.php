<?php

declare(strict_types=1);

class Request
{
    public static function json(): ?array
    {
        $body = file_get_contents('php://input');
        $data = json_decode($body, true);

        return is_array($data) ? $data : null;
    }

    public static function ip(): string
    {
        $forwarded = $_SERVER['HTTP_CF_CONNECTING_IP']
            ?? $_SERVER['HTTP_X_FORWARDED_FOR']
            ?? $_SERVER['REMOTE_ADDR']
            ?? 'unknown';

        if (str_contains($forwarded, ',')) {
            $forwarded = trim(explode(',', $forwarded)[0]);
        }

        return trim((string) $forwarded) ?: 'unknown';
    }

    /**
     * ISO-2 origin country from Cloudflare's CF-IPCountry header (free, no API
     * call). Returns null when absent or a non-country sentinel (XX = unknown,
     * T1 = Tor). Uppercased + validated to two letters.
     */
    public static function country(): ?string
    {
        $cc = $_SERVER['HTTP_CF_IPCOUNTRY'] ?? null;
        if (!is_string($cc)) return null;
        $cc = strtoupper(trim($cc));
        if (!preg_match('/^[A-Z]{2}$/', $cc) || in_array($cc, ['XX', 'T1'], true)) {
            return null;
        }
        return $cc;
    }

    /**
     * Client platform from the X-Platform header that the web + mobile apps
     * send on each request: 'web' | 'ios' | 'android'. Anything else (or a
     * missing header, e.g. an old client / crawler) → 'unknown'. Used to stamp
     * arrivals so the BO can tell where a session came from.
     */
    public static function platform(): string
    {
        $p = strtolower(trim((string) ($_SERVER['HTTP_X_PLATFORM'] ?? '')));
        return in_array($p, ['web', 'ios', 'android'], true) ? $p : 'unknown';
    }

    /**
     * Crawler / link-previewer User-Agent match. The web SPA also skips React
     * hydration for these UAs (apps/web/src/main.jsx), so this is defense in
     * depth - short-circuits any backend write that might slip through.
     */
    public static function isBot(): bool
    {
        if (self::isCrawlerNetwork()) return true;
        $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
        if ($ua === '') return false;
        return (bool) preg_match(
            // "WhatsApp" intentionally excluded - Android in-app browsers append
            // "WhatsApp/<ver>" to a regular Chromium UA; matching it would
            // mis-classify real human users. The link previewer doesn't hit
            // /guest/session anyway.
            // The last token: any other "<name>bot/<version>" crawler (Reflectionbot/1.0),
            // the slash and version keeping a phone brand like CUBOT out.
            '/(Googlebot|bingbot|YandexBot|DuckDuckBot|Slurp|Baiduspider|Applebot|Twitterbot|facebookexternalhit|LinkedInBot|Slackbot|Discordbot|TelegramBot|AhrefsBot|SemrushBot|MJ12bot|PetalBot|GPTBot|ClaudeBot|Bytespider|[a-z](?:bot|crawler|spider)\/\d)/i',
            $ua,
        );
    }

    /**
     * Crawler networks that run the web app with an ordinary browser User-Agent,
     * so isBot() can't tell them by name. 16.216.88.0/24: Reflection AI's
     * renderer (reverse DNS reflectionbot-*.reflection.ai), which arrived in a
     * city chat on every /city page it read (2026-10-29).
     */
    private const CRAWLER_PREFIXES = ['16.216.88.'];

    private static function isCrawlerNetwork(): bool
    {
        $ip = self::ip();
        foreach (self::CRAWLER_PREFIXES as $prefix) {
            if (str_starts_with($ip, $prefix)) return true;
        }
        return false;
    }
}
