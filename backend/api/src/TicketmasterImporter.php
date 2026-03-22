<?php

declare(strict_types=1);

class TicketmasterImporter
{
    private const REFRESH_COOLDOWN = 604800; // 7 days between syncs per city
    private const MAX_EVENTS       = 10;
    private const TIMEOUT          = 5;   // curl timeout in seconds

    private static function syncFilePath(): string
    {
        return Storage::path('city_sync.json');
    }

    /**
     * Syncs Ticketmaster events for a city channel if the cooldown has passed.
     * Falls back to city name when lat/lng are not provided.
     * Silent no-op if TM is unavailable — stored events are used as fallback.
     */
    public static function syncIfNeeded(int $channelId, ?float $lat, ?float $lng, string $cityName): void
    {
        if (!self::needsRefresh($channelId)) {
            error_log("[TM] ch={$channelId}: skipping — cooldown active");
            return;
        }

        $apiKey = getenv('TICKETMASTER_API_KEY');
        if (empty($apiKey)) {
            error_log("[TM] ch={$channelId}: TICKETMASTER_API_KEY is not set — sync skipped");
            return;
        }

        error_log("[TM] ch={$channelId}: syncing city={$cityName} lat={$lat} lng={$lng}");

        try {
            $raw    = self::fetch($apiKey, $lat, $lng, $cityName);
            $items  = $raw['_embedded']['events'] ?? [];
            error_log("[TM] ch={$channelId}: TM returned " . count($items) . " raw events");
            $events = self::normalize($raw, $channelId);
            error_log("[TM] ch={$channelId}: normalized to " . count($events) . " valid events");
            EventRepository::upsertPublic($channelId, $events);
            self::markSynced($channelId);
        } catch (RuntimeException $e) {
            error_log("[TM] ch={$channelId}: sync failed — " . $e->getMessage());
        }
    }

    private static function needsRefresh(int $channelId): bool
    {
        if (!file_exists(self::syncFilePath())) {
            return true;
        }

        $data = json_decode(file_get_contents(self::syncFilePath()), true);
        $last = $data[(string) $channelId] ?? 0;

        return (time() - $last) >= self::REFRESH_COOLDOWN;
    }

    private static function markSynced(int $channelId): void
    {
        $data = [];
        if (file_exists(self::syncFilePath())) {
            $data = json_decode(file_get_contents(self::syncFilePath()), true) ?? [];
        }

        $data[(string) $channelId] = time();
        file_put_contents(self::syncFilePath(), json_encode($data), LOCK_EX);
    }

    private static function fetch(string $apiKey, ?float $lat, ?float $lng, string $cityName): array
    {
        $params = [
            'apikey' => $apiKey,
            'size'   => self::MAX_EVENTS,
            'sort'   => 'date,asc',
        ];

        if ($lat !== null && $lng !== null) {
            $params['latlong'] = $lat . ',' . $lng;
            $params['radius']  = '50';
            $params['unit']    = 'km';
        } else {
            $params['city'] = $cityName;
        }

        $url = 'https://app.ticketmaster.com/discovery/v2/events.json?' . http_build_query($params);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => self::TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => self::TIMEOUT,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($response === false || $curlErr !== '') {
            throw new RuntimeException('Ticketmaster request failed: ' . $curlErr);
        }

        if ($httpCode !== 200) {
            throw new RuntimeException('Ticketmaster returned HTTP ' . $httpCode);
        }

        $data = json_decode($response, true);

        if (!is_array($data)) {
            throw new RuntimeException('Ticketmaster returned invalid JSON');
        }

        return $data;
    }

    private static function normalize(array $data, int $channelId): array
    {
        $items = $data['_embedded']['events'] ?? [];
        if (!is_array($items)) {
            return [];
        }

        $now    = time();
        $events = [];

        foreach ($items as $item) {
            $externalId = $item['id']   ?? null;
            $title      = $item['name'] ?? null;

            if (empty($externalId) || empty($title)) {
                continue;
            }

            // Parse event start → unix timestamp
            $dateStr  = $item['dates']['start']['dateTime']
                ?? ($item['dates']['start']['localDate'] ?? null);
            $startsAt = $dateStr ? (int) strtotime($dateStr) : null;

            // Skip events without a valid date or already past
            if (empty($startsAt) || $startsAt < $now) {
                continue;
            }

            // Venue and location label
            $venue    = null;
            $location = null;
            if (!empty($item['_embedded']['venues'][0])) {
                $v        = $item['_embedded']['venues'][0];
                $venue    = $v['name'] ?? null;
                $location = $v['city']['name'] ?? null;
            }

            // Image: prefer 16:9, fall back to first available
            $imageUrl = null;
            foreach ($item['images'] ?? [] as $img) {
                if (($img['ratio'] ?? '') === '16_9' && !empty($img['url'])) {
                    $imageUrl = $img['url'];
                    break;
                }
            }
            if ($imageUrl === null) {
                $imageUrl = $item['images'][0]['url'] ?? null;
            }

            $events[] = [
                'external_id'  => $externalId,
                'channel_id'   => $channelId,
                'title'        => mb_substr($title, 0, 100),
                'venue'        => $venue,
                'location'     => $location,
                'image_url'    => $imageUrl,
                'external_url' => $item['url'] ?? null,
                'starts_at'    => $startsAt,
                'expires_at'   => $startsAt + 3 * 3600, // expire 3h after the event starts
            ];
        }

        return $events;
    }
}
