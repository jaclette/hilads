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
                 profile_photo_url, home_city, interests, guest_id, created_at, updated_at)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        $allowed = ['display_name', 'birth_year', 'profile_photo_url', 'home_city', 'interests'];
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
}
