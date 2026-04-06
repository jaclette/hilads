<?php

declare(strict_types=1);

/**
 * UserResource — single canonical serializer for user data across all API endpoints.
 *
 * Produces the UserDTO shape consumed by web and native clients:
 *
 *   id           string        Registered user UUID, or guestId for guests.
 *   accountType  string        'registered' | 'guest'
 *   displayName  string        Human-readable name.
 *   avatarUrl    string|null   R2 profile photo URL, or null.
 *   badges       string[]      Badge keys in display order: primary first, then context.
 *                              Known keys: ghost · fresh · regular · local · host
 *   vibe         string|null   User-chosen vibe key, or null for guests.
 *   isFriend     bool|null     Viewer-relative. Omit (null) when not applicable.
 *   isOnline     bool|null     Presence-relative. Omit (null) when not applicable.
 *
 * All endpoints that return user data MUST go through this class.
 * Do not hand-build user arrays in api.php.
 */
final class UserResource
{
    /**
     * Build a DTO for a registered user without city context.
     *
     * @param array    $user      Full user DB row (id, display_name, profile_photo_url, vibe, created_at …)
     * @param string[] $badges    Badge keys already resolved. If empty, only the primary badge is computed.
     * @param array    $opts      Optional flags: isFriend (bool), isOnline (bool)
     */
    public static function fromUser(array $user, array $badges = [], array $opts = []): array
    {
        if (empty($badges)) {
            $primary = UserBadgeService::primaryForUser($user);
            $badges  = [$primary['key']];
        }

        return [
            'id'          => $user['id'],
            'accountType' => 'registered',
            'displayName' => $user['display_name'],
            'avatarUrl'   => $user['profile_photo_url'] ?? null,
            'badges'      => $badges,
            'vibe'        => $user['vibe'] ?? null,
            'mode'        => $user['mode'] ?? null,
            'isFriend'    => $opts['isFriend'] ?? null,
            'isOnline'    => $opts['isOnline'] ?? null,
        ];
    }

    /**
     * Build a DTO for a registered user in a city context.
     * Resolves the context badge (host / local) from the pre-fetched ambassadors map.
     *
     * @param array  $user        Full user DB row — must include home_city.
     * @param array  $ambassadors Map of userId => true for city ambassadors (from UserBadgeService::ambassadorsForCity).
     * @param string $cityName    City display name used for the 'local' badge comparison.
     * @param array  $opts        Optional flags: isFriend, isOnline.
     */
    public static function fromUserInCity(
        array  $user,
        array  $ambassadors,
        string $cityName,
        array  $opts = [],
    ): array {
        $primary = UserBadgeService::primaryForUser($user);
        $badges  = [$primary['key']];

        if (isset($ambassadors[$user['id']])) {
            $badges[] = 'host';
        } elseif (
            !empty($user['home_city'])
            && strcasecmp(trim($user['home_city']), trim($cityName)) === 0
        ) {
            $badges[] = 'local';
        }

        return self::fromUser($user, $badges, $opts);
    }

    /**
     * Build a DTO for an anonymous guest session.
     */
    public static function fromGuest(string $guestId, string $nickname, ?string $mode = null): array
    {
        return [
            'id'          => $guestId,
            'accountType' => 'guest',
            'displayName' => $nickname,
            'avatarUrl'   => null,
            'badges'      => ['ghost'],
            'vibe'        => null,
            'mode'        => $mode,
            'isFriend'    => null,
            'isOnline'    => null,
        ];
    }
}
