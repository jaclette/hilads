<?php

declare(strict_types=1);

/**
 * Where an account came from (Back office › Users): one row per account in
 * user_signups, written at sign-up, and the account's last activity on users
 * (last_seen_*), written at most every 5 minutes.
 *
 * Network: never the IP itself, only its salted hash (Invites::ipHash, the same
 * hash as user_devices, so one network can be spotted across accounts) and the
 * country / approximate city Cloudflare derives from it (CF-IPCountry,
 * CF-IPCity). Without CF-IPCity the city is the one the guest was in when
 * signing up (city_source 'arrival').
 *
 * Accounts created before this table get a row from what history still holds
 * (backfill: platform of the first device, country and city of the first
 * arrival, the inviter); its source says 'backfill'.
 */
final class UserSignups
{
    public const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ttclid', 'ref'];

    /** Short, stable id of a network for the back office: 8 hex characters of the salted hash. */
    public static function networkId(?string $ipHash): ?string
    {
        return $ipHash !== null && $ipHash !== '' ? substr($ipHash, 0, 8) : null;
    }

    /** The UTM / ad parameters kept from a client's `source.utm` (known keys, short strings). */
    public static function cleanUtm(mixed $utm): ?array
    {
        if (!is_array($utm)) return null;
        $out = [];
        foreach (self::UTM_KEYS as $k) {
            if (isset($utm[$k]) && is_scalar($utm[$k]) && trim((string) $utm[$k]) !== '') {
                $out[$k] = mb_substr(trim((string) $utm[$k]), 0, 120);
            }
        }
        return $out === [] ? null : $out;
    }

    /** First language tag of a locale or Accept-Language value ("fr-FR,fr;q=0.9" → "fr-FR"), or null. */
    public static function language(?string $raw): ?string
    {
        $tag = trim(explode(';', explode(',', (string) $raw)[0])[0]);
        return preg_match('/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/', $tag) ? $tag : null;
    }

    /** The store an app came from: from the platform (and Android's install referrer). */
    public static function store(string $platform, ?string $referrer): ?string
    {
        return match ($platform) {
            'ios'     => 'App Store',
            'android' => 'Google Play' . ($referrer !== null && $referrer !== '' && !str_contains($referrer, 'organic') ? ' (referred)' : ''),
            default   => null,
        };
    }

    private static function appVersion(): ?string
    {
        $v = trim((string) ($_SERVER['HTTP_X_APP_VERSION'] ?? ''));
        return preg_match('/^\d+(\.\d+){0,3}$/', $v) ? $v : null;
    }

    /** The city the guest was in when signing up: [channel id, name] of their latest arrival, or nulls. */
    private static function arrivalCity(?string $guestId): array
    {
        if ($guestId === null || $guestId === '') return [null, null];
        $stmt = Database::pdo()->prepare("
            SELECT m.channel_id, ch.name FROM messages m JOIN channels ch ON ch.id = m.channel_id
            WHERE m.guest_id = ? AND m.type = 'system' AND m.event = 'join' ORDER BY m.created_at DESC LIMIT 1
        ");
        $stmt->execute([$guestId]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        return $r ? [$r['channel_id'], $r['name']] : [null, null];
    }

    /** Record a fresh sign-up. $body: the sign-up request (locale?, source? {utm, share, store_referrer}). */
    public static function record(array $user, array $body, ?string $guestId): void
    {
        try {
            $source   = is_array($body['source'] ?? null) ? $body['source'] : [];
            $platform = Request::platform();
            $referrer = is_string($source['store_referrer'] ?? null) ? mb_substr($source['store_referrer'], 0, 300) : null;
            $ipCity   = Request::city();
            [$arrivalId, $arrivalName] = $ipCity === null ? self::arrivalCity($guestId) : [null, null];
            $stmt = Database::pdo()->prepare("SELECT invited_by_user_id, invite_code FROM users WHERE id = ?");
            $stmt->execute([$user['id']]);
            $inv = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
            Database::pdo()->prepare("
                INSERT INTO user_signups (user_id, signed_up_at, method, platform, app_version, locale, country, city, city_channel_id,
                                          city_source, ip_hash, guest_id, invite_code, inviter_user_id, share_link, utm, store, store_referrer, source)
                VALUES (?, now(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, 'signup')
                ON CONFLICT (user_id) DO NOTHING
            ")->execute([
                $user['id'], !empty($user['google_id']) ? 'google' : 'email', $platform, self::appVersion(),
                self::language(is_string($body['locale'] ?? null) ? $body['locale'] : ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? null)),
                Request::country(), $ipCity ?? $arrivalName, $arrivalId, $ipCity !== null ? 'ip' : ($arrivalName !== null ? 'arrival' : null),
                Invites::ipHash() ?: null, $guestId ?: null,
                is_string($body['invite_code'] ?? null) ? mb_substr($body['invite_code'], 0, 40) : null, $inv['invited_by_user_id'] ?? null,
                is_string($source['share'] ?? null) ? mb_substr($source['share'], 0, 300) : null,
                ($u = self::cleanUtm($source['utm'] ?? null)) !== null ? json_encode($u) : null,
                self::store($platform, $referrer), $referrer,
            ]);
        } catch (\Throwable $e) {
            error_log('[signups] record skipped: ' . $e->getMessage());
        }
    }

    /** Note the account's activity: time, platform, app version, country, city. At most every 5 minutes. */
    public static function touch(string $userId, ?string $cityChannelId = null): void
    {
        try {
            $platform = Request::platform();
            Database::pdo()->prepare("
                UPDATE users SET last_seen_at = now(),
                       last_seen_platform    = CASE WHEN ?::text <> 'unknown' THEN ?::text ELSE last_seen_platform END,
                       last_seen_app_version = coalesce(?::text, CASE WHEN ?::text = 'web' THEN NULL ELSE last_seen_app_version END),
                       last_seen_country     = coalesce(?::text, last_seen_country),
                       last_seen_city_id     = coalesce(?::text, current_city_id, last_seen_city_id)
                WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes' OR ?::text IS NOT NULL)
            ")->execute([$platform, $platform, self::appVersion(), $platform, Request::country(), $cityChannelId, $userId, $cityChannelId]);
        } catch (\Throwable $e) {
            error_log('[signups] touch skipped: ' . $e->getMessage());
        }
    }

    /** A row for each account without one, from what history holds. Returns the number of rows written. */
    public static function backfill(): int
    {
        $pdo = Database::pdo();
        return (int) $pdo->exec("
            INSERT INTO user_signups (user_id, signed_up_at, method, platform, country, city, city_channel_id, city_source,
                                      guest_id, invite_code, inviter_user_id, store, source)
            SELECT u.id, to_timestamp(u.created_at),
                   CASE WHEN u.google_id IS NOT NULL THEN 'google' ELSE 'email' END,
                   d.platform, fa.country, fa.city_name, fa.channel_id, CASE WHEN fa.channel_id IS NOT NULL THEN 'arrival' END,
                   u.guest_id, NULL, u.invited_by_user_id,
                   CASE d.platform WHEN 'ios' THEN 'App Store' WHEN 'android' THEN 'Google Play' END,
                   'backfill'
            FROM users u
            LEFT JOIN LATERAL (SELECT platform FROM user_devices WHERE user_id = u.id AND platform IS NOT NULL
                               ORDER BY first_seen LIMIT 1) d ON true
            LEFT JOIN LATERAL (
                SELECT m.country, m.channel_id, ch.name AS city_name FROM messages m JOIN channels ch ON ch.id = m.channel_id
                WHERE m.type = 'system' AND m.event = 'join'
                  AND (m.user_id = u.id OR m.guest_id IN (SELECT guest_id FROM user_guest_links WHERE user_id = u.id))
                ORDER BY m.created_at LIMIT 1
            ) fa ON true
            WHERE NOT EXISTS (SELECT 1 FROM user_signups s WHERE s.user_id = u.id)
            ON CONFLICT (user_id) DO NOTHING
        ");
    }
}
