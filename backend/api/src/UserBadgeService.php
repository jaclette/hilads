<?php

declare(strict_types=1);

/**
 * UserBadgeService — resolves identity badges for users in a city context.
 *
 * Primary badge   (always one):
 *   ghost  👻 Ghost  — anonymous guest session (no registered account)
 *   fresh  ✨ Fresh  — registered user, account < 60 days old
 *   crew   😎 Crew   — registered user, account ≥ 60 days old
 *
 * Context badge   (at most one, city-specific):
 *   host   ⭐ Host   — ambassador role for this city  (priority)
 *   local  🌍 Local  — home_city matches the current city
 *   null              — no context badge
 */
final class UserBadgeService
{
    // Threshold for "fresh" users: 60 days (roughly 2 months)
    private const FRESH_TTL = 60 * 24 * 3600;


    // ── Single-user resolution ─────────────────────────────────────────────────

    /**
     * Resolve both badges for a single user in a city.
     *
     * @param array|null $user       Full user row (id, created_at, home_city, …)
     *                               or null for a guest session.
     * @param int        $cityChannelId  Integer city ID (e.g. 20 for 'city_20').
     * @param string     $cityName   City display name (e.g. 'Paris').
     */
    public static function resolveForCity(?array $user, int $cityChannelId, string $cityName): array
    {
        $primary = self::primaryForUser($user);
        $context = null;

        if ($user !== null) {
            $channelKey = 'city_' . $cityChannelId;

            // Ambassador check
            $stmt = Database::pdo()->prepare("
                SELECT 1 FROM user_city_roles
                WHERE user_id = ? AND city_id = ? AND role = 'ambassador'
            ");
            $stmt->execute([$user['id'], $channelKey]);
            if ($stmt->fetchColumn()) {
                $context = ['key' => 'host', 'label' => '⭐ Host'];
            } elseif (!empty($user['home_city'])
                && strcasecmp(trim($user['home_city']), trim($cityName)) === 0) {
                $context = ['key' => 'local', 'label' => '🌍 Local'];
            }
        }

        return ['primaryBadge' => $primary, 'contextBadge' => $context];
    }

    // ── Batch resolution (messages and presence) ───────────────────────────────

    /**
     * Batch-resolve full badges for many registered users in one city.
     * Runs exactly two DB queries regardless of how many users there are.
     *
     * @param string[] $userIds       Array of registered user IDs.
     * @param int      $cityChannelId Integer city ID.
     * @param string   $cityName      City display name.
     * @return array   [ userId => ['primaryBadge' => …, 'contextBadge' => …] ]
     */
    public static function batchForCity(array $userIds, int $cityChannelId, string $cityName): array
    {
        if (empty($userIds)) {
            return [];
        }

        $channelKey = 'city_' . $cityChannelId;
        $in         = implode(',', array_fill(0, count($userIds), '?'));

        // 1 query: fetch created_at + home_city for all senders
        $stmt = Database::pdo()->prepare(
            "SELECT id, created_at, home_city FROM users WHERE id IN ($in)"
        );
        $stmt->execute($userIds);
        $userRows = [];
        foreach ($stmt->fetchAll() as $row) {
            $userRows[$row['id']] = $row;
        }

        // 2nd query: fetch ambassador roles for this city
        $ambassadors = [];
        $stmt = Database::pdo()->prepare(
            "SELECT user_id FROM user_city_roles
             WHERE city_id = ? AND role = 'ambassador' AND user_id IN ($in)"
        );
        $stmt->execute([$channelKey, ...$userIds]);
        foreach ($stmt->fetchAll() as $row) {
            $ambassadors[$row['user_id']] = true;
        }

        $result = [];
        foreach ($userIds as $userId) {
            $u       = $userRows[$userId] ?? null;
            $primary = self::primaryForUser($u);
            $context = null;

            if ($u !== null) {
                if (isset($ambassadors[$userId])) {
                    $context = ['key' => 'host', 'label' => '⭐ Host'];
                } elseif (!empty($u['home_city'])
                    && strcasecmp(trim($u['home_city']), trim($cityName)) === 0) {
                    $context = ['key' => 'local', 'label' => '🌍 Local'];
                }
            }

            $result[$userId] = ['primaryBadge' => $primary, 'contextBadge' => $context];
        }

        return $result;
    }

    /**
     * Batch-check ambassador roles only (one query).
     * Used when we already have user data from a JOIN (presence list).
     *
     * @return array [ userId => true ] for ambassador users only.
     */
    public static function ambassadorsForCity(array $userIds, int $cityChannelId): array
    {
        if (empty($userIds)) {
            return [];
        }

        $channelKey = 'city_' . $cityChannelId;
        $in         = implode(',', array_fill(0, count($userIds), '?'));

        $stmt = Database::pdo()->prepare(
            "SELECT user_id FROM user_city_roles
             WHERE city_id = ? AND role = 'ambassador' AND user_id IN ($in)"
        );
        $stmt->execute([$channelKey, ...$userIds]);

        $result = [];
        foreach ($stmt->fetchAll() as $row) {
            $result[$row['user_id']] = true;
        }
        return $result;
    }

    // ── Primary badge helper (no DB needed) ───────────────────────────────────

    /**
     * Compute the primary badge from a user row or null (guest).
     * Safe to call with only { created_at } populated in the user array.
     */
    public static function primaryForUser(?array $user): array
    {
        if ($user === null) {
            return ['key' => 'ghost', 'label' => '👻 Ghost'];
        }

        $raw = $user['created_at'] ?? 0;
        $ts  = is_numeric($raw) ? (int) $raw : (int) strtotime((string) $raw);

        if ($ts > 0 && (time() - $ts) < self::FRESH_TTL) {
            return ['key' => 'fresh', 'label' => '✨ Fresh'];
        }

        return ['key' => 'crew', 'label' => '😎 Crew'];
    }
}
