<?php

declare(strict_types=1);

class TicketmasterImporter
{
    private const REFRESH_COOLDOWN = 604800; // 7 days between syncs per city
    private const MAX_EVENTS       = 10;
    private const TIMEOUT          = 5;   // curl timeout in seconds

    /**
     * Syncs Ticketmaster events for a city channel if the cooldown has passed.
     * Falls back to city name when lat/lng are not provided.
     * Silent no-op if TM is unavailable — stored events are used as fallback.
     */
    public static function syncIfNeeded(int $channelId, ?float $lat, ?float $lng, string $cityName): void
    {
        self::sync($channelId, $lat, $lng, $cityName, false);
    }

    public static function forceSync(int $channelId, ?float $lat, ?float $lng, string $cityName): void
    {
        self::sync($channelId, $lat, $lng, $cityName, true);
    }

    private static function sync(int $channelId, ?float $lat, ?float $lng, string $cityName, bool $force): void
    {
        try {
            if (!$force && !self::needsRefresh($channelId)) {
                error_log("[TM] ch={$channelId}: skipping — cooldown active");
                return;
            }

            $apiKey = getenv('TICKETMASTER_API_KEY');
            if (empty($apiKey)) {
                error_log("[TM] ch={$channelId}: TICKETMASTER_API_KEY is not set — sync skipped");
                return;
            }

            error_log("[TM] ch={$channelId}: syncing city={$cityName} lat={$lat} lng={$lng} force=" . ($force ? 'true' : 'false'));

            $raw    = self::fetch($apiKey, $lat, $lng, $cityName);
            $items  = $raw['_embedded']['events'] ?? [];
            error_log("[TM] ch={$channelId}: TM returned " . count($items) . " raw events");
            $events = self::normalize($raw, $channelId);
            error_log("[TM] ch={$channelId}: normalized to " . count($events) . " valid events");
            EventRepository::upsertPublic($channelId, $events);
            self::markSynced($channelId, count($events));
        } catch (\Throwable $e) {
            $class = get_class($e);
            if (str_contains($class, 'PDO') || str_contains($e->getMessage(), 'database')) {
                error_log("[TM] ch={$channelId}: DB error during sync — " . $e->getMessage());
            } elseif (str_contains($e->getMessage(), 'Ticketmaster')) {
                error_log("[TM] ch={$channelId}: external API error — " . $e->getMessage());
            } else {
                error_log("[TM] ch={$channelId}: unexpected error — {$class}: " . $e->getMessage());
            }
        }
    }

    private static function needsRefresh(int $channelId): bool
    {
        $stmt = Database::pdo()->prepare("
            SELECT synced_at FROM city_sync_log WHERE channel_id = ?
        ");
        $stmt->execute(['city_' . $channelId]);
        $row = $stmt->fetch();

        if (!$row) {
            return true;
        }

        $lastSynced = strtotime($row['synced_at']);
        return (time() - $lastSynced) >= self::REFRESH_COOLDOWN;
    }

    private static function markSynced(int $channelId, int $eventCount): void
    {
        Database::pdo()->prepare("
            INSERT INTO city_sync_log (channel_id, synced_at, event_count, status)
            VALUES (:channel_id, now(), :event_count, 'ok')
            ON CONFLICT (channel_id) DO UPDATE SET
                synced_at   = now(),
                event_count = EXCLUDED.event_count,
                status      = 'ok'
        ")->execute([
            'channel_id'  => 'city_' . $channelId,
            'event_count' => $eventCount,
        ]);
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

            // Venue name, address, and coordinates
            $venue    = null;
            $location = null;
            $venueLat = null;
            $venueLng = null;
            if (!empty($item['_embedded']['venues'][0])) {
                $v        = $item['_embedded']['venues'][0];
                $venue    = $v['name'] ?? null;
                $location = self::buildVenueAddress($v);
                $rawLat   = $v['location']['latitude']  ?? null;
                $rawLng   = $v['location']['longitude'] ?? null;
                if (is_numeric($rawLat) && is_numeric($rawLng)) {
                    $venueLat = (float) $rawLat;
                    $venueLng = (float) $rawLng;
                }
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
                'venue_lat'    => $venueLat,
                'venue_lng'    => $venueLng,
                'image_url'    => $imageUrl,
                'external_url' => $item['url'] ?? null,
                'starts_at'    => $startsAt,
                'expires_at'   => $startsAt + 3 * 3600, // expire 3h after the event starts
            ];
        }

        return $events;
    }

    private static function buildVenueAddress(array $venue): ?string
    {
        $candidates = [
            $venue['formattedAddress'] ?? null,
            $venue['address']['formattedAddress'] ?? null,
            $venue['address']['line1'] ?? null,
            $venue['address']['address1'] ?? null,
        ];

        foreach ($candidates as $candidate) {
            $clean = self::cleanAddressPart($candidate);
            if ($clean !== null) {
                return self::composeAddress($clean, [
                    $venue['district']['name'] ?? null,
                    $venue['borough']['name'] ?? null,
                    $venue['city']['name'] ?? null,
                    $venue['state']['name'] ?? null,
                ]);
            }
        }

        $street = self::cleanAddressPart($venue['address']['street'] ?? $venue['street'] ?? null);
        $streetNumber = self::cleanAddressPart(
            $venue['address']['streetNumber']
            ?? $venue['address']['houseNumber']
            ?? $venue['streetNumber']
            ?? $venue['houseNumber']
            ?? null
        );
        $line2 = self::cleanAddressPart($venue['address']['line2'] ?? $venue['address']['address2'] ?? null);

        $streetLine = trim(implode(' ', array_filter([$street, $streetNumber])));

        return self::composeAddress($streetLine !== '' ? $streetLine : null, [
            $line2,
            $venue['district']['name'] ?? null,
            $venue['borough']['name'] ?? null,
            $venue['city']['name'] ?? null,
            $venue['state']['name'] ?? null,
            $venue['postalCode'] ?? $venue['address']['postalCode'] ?? null,
            $venue['country']['name'] ?? null,
        ]);
    }

    private static function composeAddress(?string $primary, array $parts): ?string
    {
        $clean = [];
        if ($primary !== null && $primary !== '') {
            $clean[] = $primary;
        }

        foreach ($parts as $part) {
            $value = self::cleanAddressPart($part);
            if ($value === null) {
                continue;
            }
            if (in_array(mb_strtolower($value), array_map('mb_strtolower', $clean), true)) {
                continue;
            }
            $clean[] = $value;
        }

        return empty($clean) ? null : implode(', ', $clean);
    }

    private static function cleanAddressPart(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }

        $value = trim(preg_replace('/\s+/', ' ', $value));
        return $value !== '' ? $value : null;
    }
}
