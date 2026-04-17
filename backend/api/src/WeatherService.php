<?php

declare(strict_types=1);

/**
 * WeatherService — injects a live weather system message into city channels.
 *
 * Data source : Open-Meteo (free, no API key, GDPR-compliant)
 * Cache       : APCu (preferred) or /tmp file, 45-minute TTL per city
 * Cooldown    : at most one weather message every 4 hours per city channel
 *               (checked via MAX(created_at) on the messages table)
 *
 * Open-Meteo docs: https://open-meteo.com/en/docs
 *
 * Sample URL:
 *   https://api.open-meteo.com/v1/forecast
 *     ?latitude=48.8566&longitude=2.3522
 *     &current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m
 *     &wind_speed_unit=kmh&timezone=auto
 */
final class WeatherService
{
    // How long to cache Open-Meteo data (seconds).
    private const CACHE_TTL = 45 * 60;

    // Minimum gap between weather feed messages per city channel (seconds).
    private const INJECT_COOLDOWN = 4 * 3600;

    private const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

    // ── Public entry point ────────────────────────────────────────────────────

    /**
     * Checks whether a weather message is due for $channelId and inserts one
     * if the 4-hour cooldown has elapsed. Non-fatal — caller must catch.
     *
     * @param int   $channelId  Integer city channel ID
     * @param array $city       Row from CityRepository: {id, name, lat, lng, ...}
     */
    public static function maybeInject(int $channelId, array $city): void
    {
        // Cooldown check — one DB query
        if (!self::isDue($channelId)) {
            return;
        }

        $weather = self::fetch((float) $city['lat'], (float) $city['lng']);
        if ($weather === null) {
            return; // API unreachable — skip silently, try again next request
        }

        $content = self::buildText($city['name'], $weather);
        MessageRepository::addWeatherSystem($channelId, $content);
    }

    // ── Cooldown ──────────────────────────────────────────────────────────────

    private static function isDue(int $channelId): bool
    {
        $stmt = Database::pdo()->prepare("
            SELECT EXTRACT(EPOCH FROM MAX(created_at))::INTEGER
            FROM messages
            WHERE channel_id = ? AND type = 'system' AND event = 'weather'
        ");
        $stmt->execute(['city_' . $channelId]);
        $lastAt = $stmt->fetchColumn();

        if (!$lastAt) {
            return true; // never injected → go ahead
        }

        return (time() - (int) $lastAt) >= self::INJECT_COOLDOWN;
    }

    // ── Fetch + cache ─────────────────────────────────────────────────────────

    private static function fetch(float $lat, float $lng): ?array
    {
        $cacheKey = sprintf('hilads_wx_%.4f_%.4f', $lat, $lng);

        $cached = self::cacheGet($cacheKey);
        if ($cached !== null) {
            return $cached;
        }

        $url = self::OPEN_METEO_URL . '?' . http_build_query([
            'latitude'        => $lat,
            'longitude'       => $lng,
            'current'         => 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',
            'wind_speed_unit' => 'kmh',
            'timezone'        => 'auto',
        ]);

        $ctx = stream_context_create(['http' => [
            'timeout'       => 4,   // 4 s hard timeout — never block a chat request long
            'ignore_errors' => true,
            'user_agent'    => 'Hilads/1.0 (https://hilads.app)',
        ]]);

        $raw = @file_get_contents($url, false, $ctx);
        if ($raw === false) {
            error_log('[weather] Open-Meteo request failed: ' . $url);
            return null;
        }

        $data = json_decode($raw, true);
        if (!is_array($data) || !isset($data['current'])) {
            error_log('[weather] unexpected Open-Meteo response: ' . substr($raw, 0, 300));
            return null;
        }

        $c = $data['current'];
        $weather = [
            'temp'        => round((float) ($c['temperature_2m']      ?? 0), 1),
            'feelsLike'   => round((float) ($c['apparent_temperature'] ?? 0), 1),
            'code'        => (int)   ($c['weather_code']               ?? 0),
            'isDay'       => (bool)  ($c['is_day']                     ?? true),
            'windSpeed'   => round((float) ($c['wind_speed_10m']       ?? 0)),
        ];

        self::cacheSet($cacheKey, $weather, self::CACHE_TTL);
        return $weather;
    }

    // ── Message text ──────────────────────────────────────────────────────────

    private static function buildText(string $cityName, array $w): string
    {
        $temp  = (int) round((float) $w['temp']);
        $code  = (int) $w['code'];
        $isDay = (bool) $w['isDay'];

        // Clear sky
        if ($code === 0 && $isDay && $temp >= 30) {
            return "☀️ {$temp}°C · gorgeous out there";
        }
        if ($code === 0 && $isDay) {
            return "☀️ {$temp}°C · clear skies";
        }
        if ($code === 0) {
            return "🌙 {$temp}°C · clear tonight";
        }

        // Mainly clear
        if ($code === 1 && $isDay) {
            return "🌤️ {$temp}°C · mainly clear";
        }
        if ($code === 1) {
            return "🌙 {$temp}°C · mainly clear tonight";
        }

        // Partly cloudy
        if ($code === 2) {
            return "⛅ {$temp}°C · a few clouds around";
        }

        // Overcast
        if ($code === 3) {
            return "☁️ {$temp}°C · grey skies today";
        }

        // Fog
        if ($code === 45 || $code === 48) {
            return "🌫️ {$temp}°C · foggy out there";
        }

        // Drizzle
        if ($code >= 51 && $code <= 55) {
            return "🌦️ {$temp}°C · light drizzle, grab a jacket";
        }
        if ($code === 56 || $code === 57) {
            return "🌦️ {$temp}°C · freezing drizzle, stay warm";
        }

        // Rain
        if ($code === 61) {
            return "🌧️ {$temp}°C · light rain";
        }
        if ($code === 63) {
            return "🌧️ {$temp}°C · raining right now";
        }
        if ($code === 65) {
            return "🌧️ {$temp}°C · heavy rain, stay covered";
        }
        if ($code === 66 || $code === 67) {
            return "🌧️ {$temp}°C · freezing rain, be careful";
        }

        // Snow
        if ($code === 71) {
            return "❄️ {$temp}°C · light snow";
        }
        if ($code === 73 || $code === 75) {
            return "❄️ {$temp}°C · snowing!";
        }
        if ($code === 77) {
            return "❄️ {$temp}°C · snow grains";
        }

        // Showers
        if ($code === 80) {
            return "🌦️ {$temp}°C · light showers";
        }
        if ($code === 81) {
            return "🌧️ {$temp}°C · rain showers";
        }
        if ($code === 82) {
            return "⛈️ {$temp}°C · heavy showers, take cover";
        }
        if ($code === 85 || $code === 86) {
            return "🌨️ {$temp}°C · snow showers";
        }

        // Thunderstorm
        if ($code === 95) {
            return "⛈️ {$temp}°C · thunderstorm, stay safe";
        }
        if ($code === 96 || $code === 99) {
            return "⛈️ {$temp}°C · thunderstorm with hail, stay indoors";
        }

        // Fallback (unknown code)
        return "🌡️ {$temp}°C right now";
    }

    // ── Cache: APCu (preferred) or /tmp file fallback ─────────────────────────

    private static function useApcu(): bool
    {
        return function_exists('apcu_fetch')
            && filter_var(ini_get('apc.enabled'), FILTER_VALIDATE_BOOL)
            && PHP_SAPI !== 'cli';
    }

    private static function cacheGet(string $key): ?array
    {
        if (self::useApcu()) {
            $val = apcu_fetch($key, $ok);
            return ($ok && is_array($val)) ? $val : null;
        }

        $path = self::filePath($key);
        $raw  = @file_get_contents($path);
        if ($raw === false) {
            return null;
        }

        $entry = json_decode($raw, true);
        if (!is_array($entry) || ($entry['expires_at'] ?? 0) < time()) {
            return null; // expired
        }

        return $entry['data'] ?? null;
    }

    private static function cacheSet(string $key, array $data, int $ttl): void
    {
        if (self::useApcu()) {
            apcu_store($key, $data, $ttl);
            return;
        }

        $dir = sys_get_temp_dir() . '/hilads-weather';
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
            return; // can't create cache dir — skip silently
        }

        @file_put_contents(
            self::filePath($key),
            json_encode(['data' => $data, 'expires_at' => time() + $ttl]),
            LOCK_EX,
        );
    }

    private static function filePath(string $key): string
    {
        return sys_get_temp_dir() . '/hilads-weather/' . hash('sha256', $key) . '.json';
    }
}
