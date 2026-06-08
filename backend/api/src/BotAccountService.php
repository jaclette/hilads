<?php

declare(strict_types=1);

/**
 * BotAccountService - central blacklist for accounts we've identified as
 * crawler / automated (e.g. Googlebot-driven). Their reads (POST /bootstrap,
 * any GET endpoint) keep working untouched; we only want to suppress the
 * NOISE they generate as actors:
 *
 *   - "X just landed" feed lines + WS broadcasts
 *   - city_join push notifications when they arrive
 *   - Every other push/bell row they would trigger (channel_message,
 *     event_message, dm_message, profile_view, vibe_received, …)
 *
 * Why a separate class:
 *   Two chokepoints need this check (NotificationRepository::emitCityArrival
 *   for arrivals, and NotificationRepository::createUnchecked for everything
 *   else). Without a shared helper the blacklist would drift.
 *
 * Adding a new bot account:
 *   Append its username to BLACKLIST_USERNAMES. The first call after restart
 *   resolves the user_id (single SELECT, statically cached) so subsequent
 *   checks are array-lookup-fast.
 */
class BotAccountService
{
    /**
     * Usernames identified as crawler-controlled. Lowercased compare; case
     * doesn't matter. Stored in the `users.username` column (also commonly
     * mirrors `display_name` for these auto-generated handles).
     */
    private const BLACKLIST_USERNAMES = [
        'sunny_nomad_5259',
        'calm_regular_4138',
    ];

    /** Resolved user_id set (lowercase string IDs). Populated on first use. */
    private static ?array $idCache = null;

    /**
     * True when the given user_id belongs to a blacklisted bot account.
     * Null / empty input → false (no DB query). First call per process does
     * one SELECT to resolve usernames → ids; subsequent calls are O(1).
     */
    public static function isBotUserId(?string $userId): bool
    {
        if ($userId === null || $userId === '') return false;
        return isset(self::ids()[$userId]);
    }

    /**
     * True when the nickname/display_name matches a blacklisted account.
     * Used for guest-path arrivals (no userId yet resolved) and as a fast
     * pre-check that avoids the DB lookup when possible.
     */
    public static function isBotNickname(?string $nickname): bool
    {
        if ($nickname === null || $nickname === '') return false;
        $lc = strtolower(trim($nickname));
        foreach (self::BLACKLIST_USERNAMES as $name) {
            if ($lc === $name) return true;
        }
        return false;
    }

    /**
     * True if any of the conventional actor fields in a notification's data
     * payload resolves to a bot account. Covers the keys our notification
     * call sites actually use:
     *   senderUserId - dm/channel/event/topic_message, mention, profile_view
     *   actorId      - vibe_received
     *   viewerId     - profile_view (paired with senderUserId)
     *   accepterUserId - friend_request_accepted
     *   arriverUserId - (not present today; future-proof for city_join)
     */
    public static function isBotActor(array $data): bool
    {
        foreach (['senderUserId', 'actorId', 'viewerId', 'accepterUserId', 'arriverUserId'] as $key) {
            $val = $data[$key] ?? null;
            if (is_string($val) && self::isBotUserId($val)) return true;
        }
        return false;
    }

    /**
     * Resolve usernames → user_ids once per process. Failures (DB down,
     * accounts not yet created) degrade to an empty set so the rest of the
     * system keeps working; the nickname-based gate still catches arrivals.
     */
    private static function ids(): array
    {
        if (self::$idCache !== null) return self::$idCache;

        try {
            $placeholders = implode(',', array_fill(0, count(self::BLACKLIST_USERNAMES), '?'));
            $stmt = Database::pdo()->prepare(
                "SELECT id FROM users WHERE LOWER(username) IN ($placeholders)"
            );
            $stmt->execute(self::BLACKLIST_USERNAMES);
            $rows = $stmt->fetchAll(\PDO::FETCH_COLUMN) ?: [];
            self::$idCache = array_flip($rows);
        } catch (\Throwable $e) {
            error_log('[bot-account] id resolve failed: ' . $e->getMessage());
            self::$idCache = [];
        }
        return self::$idCache;
    }
}
