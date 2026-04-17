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
                (id, email, password_hash, google_id, display_name, birth_year,
                 profile_photo_url, home_city, interests, guest_id, mode, is_verified, created_at, updated_at)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ');

        try {
            $stmt->execute([
                $id,
                $data['email']             ?? null,
                $data['password_hash']     ?? null,
                $data['google_id']         ?? null,
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
            // SQLSTATE 23xxx = integrity constraint violation (unique, not-null, fk, check)
            if (str_starts_with((string) $e->getCode(), '23')) {
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

    /**
     * Partial update — only the keys present in $fields are touched.
     * Allowed fields: display_name, birth_year, profile_photo_url, home_city, interests.
     */
    public static function update(string $id, array $fields): array
    {
        // NOTE: profile_thumb_photo_url is intentionally omitted until the
        // migrate_thumb_photo_url.sql migration has been applied on the server.
        // Add it back here once the column exists in production.
        $allowed = [
            'display_name', 'birth_year', 'profile_photo_url', 'home_city', 'about_me', 'interests', 'vibe', 'mode',
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
            $stmt->execute($values);
        }

        return self::findById($id);
    }

    /**
     * Admin-only user creation — skips cooldowns, allows is_fake flag.
     */
    public static function adminCreate(array $data): array
    {
        $id  = bin2hex(random_bytes(16));
        $now = time();

        $stmt = Database::pdo()->prepare('
            INSERT INTO users
                (id, email, password_hash, display_name, birth_year,
                 profile_photo_url, home_city, interests, vibe, is_fake, is_verified,
                 created_at, updated_at)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, ?, ?)
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
                $data['is_fake']           ?? 0,
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
     * Admin-only full update — can touch email, password_hash, is_fake, etc.
     */
    public static function adminUpdate(string $id, array $fields): array
    {
        $allowed = [
            'display_name', 'email', 'password_hash', 'birth_year',
            'profile_photo_url', 'home_city', 'interests', 'vibe', 'is_fake',
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
