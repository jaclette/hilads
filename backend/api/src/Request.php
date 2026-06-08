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
     * Crawler / link-previewer User-Agent match. The web SPA also skips React
     * hydration for these UAs (apps/web/src/main.jsx), so this is defense in
     * depth - short-circuits any backend write that might slip through.
     */
    public static function isBot(): bool
    {
        $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
        if ($ua === '') return false;
        return (bool) preg_match(
            // "WhatsApp" intentionally excluded - Android in-app browsers append
            // "WhatsApp/<ver>" to a regular Chromium UA; matching it would
            // mis-classify real human users. The link previewer doesn't hit
            // /guest/session anyway.
            '/(Googlebot|bingbot|YandexBot|DuckDuckBot|Slurp|Baiduspider|Applebot|Twitterbot|facebookexternalhit|LinkedInBot|Slackbot|Discordbot|TelegramBot|AhrefsBot|SemrushBot|MJ12bot|PetalBot|GPTBot|ClaudeBot|Bytespider)/i',
            $ua,
        );
    }
}
