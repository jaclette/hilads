<?php

declare(strict_types=1);

class UserRepository
{
    public static function create(array $data): array
    {
        $id  = bin2hex(random_bytes(16));
        $now = time();

        $stmt = Database::pdo()->prepare('
            INSERT INTO users
                (id, email, password_hash, google_id, username, display_name, birth_year,
                 profile_photo_url, home_city, interests, guest_id, mode, is_verified, created_at, updated_at)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ');

        try {
            $stmt->execute([
                $id,
                $data['email']             ?? null,
                $data['password_hash']     ?? null,
                $data['google_id']         ?? null,
                $data['username']          ?? null,
                $data['display_name'],
                $data['birth_year']        ?? null,
                $data['profile_photo_url'] ?? null,
                $data['home_city']         ?? null,
                $data['interests']         ?? '[]',
                $data['guest_id']          ?? null,
                $data['mode']              ?? null,
                0,                                // is_verified: false (PDO coerces PHP bool to '' which breaks PostgreSQL)
                $now,
                $now,
            ]);
        } catch (\PDOException $e) {
            // SQLSTATE 23xxx = integrity constraint violation (unique, not-null, fk, check).
            // Distinguish username vs email collisions so the caller can show the right error.
            if (str_starts_with((string) $e->getCode(), '23')) {
                if (stripos($e->getMessage(), 'username') !== false) {
                    throw new \RuntimeException('username_taken');
                }
                throw new \RuntimeException('email_already_exists');
            }
            throw $e;
        }

        return self::findById($id);
    }

    public static function findById(string $id): ?array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->fetch() ?: null;
    }

    public static function findByEmail(string $email): ?array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM users WHERE email = ?');
        $stmt->execute([strtolower($email)]);
        return $stmt->fetch() ?: null;
    }

    public static function findByGuestId(string $guestId): ?array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM users WHERE guest_id = ?');
        $stmt->execute([$guestId]);
        return $stmt->fetch() ?: null;
    }

    public static function findByGoogleId(string $googleId): ?array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM users WHERE google_id = ?');
        $stmt->execute([$googleId]);
        return $stmt->fetch() ?: null;
    }

    /** Case-insensitive lookup by @-handle. Excludes soft-deleted users. */
    public static function findByUsername(string $username): ?array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM users WHERE lower(username) = lower(?) AND deleted_at IS NULL');
        $stmt->execute([trim($username)]);
        return $stmt->fetch() ?: null;
    }

    /**
     * Stamp the user's EULA acceptance time (Apple G1.2). Idempotent - only
     * sets the timestamp if it's currently NULL, so re-acceptance preserves
     * the original acceptance moment.
     */
    public static function acceptEula(string $id): array
    {
        Database::pdo()
            ->prepare("UPDATE users SET eula_accepted_at = now() WHERE id = ? AND eula_accepted_at IS NULL")
            ->execute([$id]);
        return self::findById($id);
    }

    /**
     * Partial update - only the keys present in $fields are touched.
     * Allowed fields: display_name, birth_year, profile_photo_url, home_city, interests.
     */
    public static function update(string $id, array $fields): array
    {
        $allowed = [
            'username', 'display_name', 'birth_year', 'profile_photo_url', 'profile_thumb_photo_url',
            'home_city', 'about_me', 'interests', 'vibe', 'mode',
            'ambassador_restaurant', 'ambassador_spot', 'ambassador_tip', 'ambassador_story',
        ];
        $sets    = [];
        $values  = [];

        foreach ($allowed as $key) {
            if (array_key_exists($key, $fields)) {
                $sets[]   = "$key = ?";
                $values[] = $fields[$key];
            }
        }

        if (!empty($sets)) {
            $sets[]   = 'updated_at = ?';
            $values[] = time();
            $values[] = $id;

            $stmt = Database::pdo()->prepare(
                'UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = ?'
            );
            try {
                $stmt->execute($values);
            } catch (\PDOException $e) {
                // Race-safe backstop for the username unique index.
                if (str_starts_with((string) $e->getCode(), '23') && stripos($e->getMessage(), 'username') !== false) {
                    throw new \RuntimeException('username_taken');
                }
                throw $e;
            }
        }

        return self::findById($id);
    }

    /**
     * Admin-only user creation - skips cooldowns, allows is_fake flag.
     */
    public static function adminCreate(array $data): array
    {
        $id  = bin2hex(random_bytes(16));
        $now = time();

        // current_city_id is optional - admin-form CreateUser auto-derives it
        // from the picked home_city so the fake appears in that city's crew
        // immediately under the MEMBERS_USE_CURRENT_CITY=on rule. The
        // current_city_set_at + current_city_last_confirmed_at timestamps
        // are populated to "now" so the two-signal transition rule treats
        // the placement as already-confirmed rather than a fresh GPS hint.
        $currentCityId = $data['current_city_id'] ?? null;

        $stmt = Database::pdo()->prepare('
            INSERT INTO users
                (id, email, password_hash, display_name, birth_year,
                 profile_photo_url, home_city, interests, vibe, is_fake, is_verified,
                 current_city_id, current_city_set_at, current_city_last_confirmed_at,
                 created_at, updated_at)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false,
                 ?, ?, ?,
                 ?, ?)
        ');

        try {
            $stmt->execute([
                $id,
                $data['email']             ?? null,
                $data['password_hash']     ?? null,
                $data['display_name'],
                $data['birth_year']        ?? null,
                $data['profile_photo_url'] ?? null,
                $data['home_city']         ?? null,
                $data['interests']         ?? '[]',
                $data['vibe']              ?? 'chill',
                // PDO + Postgres: a raw PHP false binds as '' which the
                // BOOLEAN column rejects ("invalid input syntax for type
                // boolean: ''"). Cast to int 0/1 so the bind is unambiguous.
                (int) (bool) ($data['is_fake'] ?? false),
                $currentCityId,
                $currentCityId !== null ? date('c', $now) : null,
                $currentCityId !== null ? date('c', $now) : null,
                $now,
                $now,
            ]);
        } catch (\PDOException $e) {
            if (str_starts_with((string) $e->getCode(), '23')) {
                throw new \RuntimeException('email_already_exists');
            }
            throw $e;
        }

        return self::findById($id);
    }

    /**
     * Admin-only full update - can touch email, password_hash, is_fake, etc.
     */
    public static function adminUpdate(string $id, array $fields): array
    {
        $allowed = [
            'display_name', 'email', 'password_hash', 'birth_year',
            'profile_photo_url', 'home_city', 'interests', 'vibe', 'is_fake',
            // PR14: admin override of the cached leaderboard scores. Direct
            // mutation of users.score_* - bypasses score_events but useful
            // for moderation / corrections / seed-data tweaks from the BO.
            'score_alltime', 'score_month', 'score_month_ref',
            // PR16: admin override of the user's current city membership. The
            // BO writes current_city_id directly (channel id like "city_42")
            // and bumps the set/confirmed timestamps so the change reads as
            // a deliberate switch, not stale geo data. The caller is
            // responsible for upserting the legacy user_city_memberships row
            // alongside this (see admin/user_edit.php) so the members list
            // picks up the change under both feature-flag modes.
            'current_city_id', 'current_city_set_at', 'current_city_last_confirmed_at',
        ];
        $sets   = [];
        $values = [];

        foreach ($allowed as $key) {
            if (array_key_exists($key, $fields)) {
                $sets[]   = "$key = ?";
                $values[] = $fields[$key];
            }
        }

        if (!empty($sets)) {
            $sets[]   = 'updated_at = ?';
            $values[] = time();
            $values[] = $id;

            Database::pdo()->prepare(
                'UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = ?'
            )->execute($values);
        }

        return self::findById($id);
    }

    /**
     * Soft-delete a user: marks deleted_at, kills all sessions and push tokens.
     * Historical data (messages, events, DMs) is preserved.
     */
    public static function softDelete(string $id): void
    {
        $pdo = Database::pdo();
        $pdo->prepare("UPDATE users SET deleted_at = now() WHERE id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM user_sessions WHERE user_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM mobile_push_tokens WHERE user_id = ?")->execute([$id]);
    }
}
