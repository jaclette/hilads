<?php

declare(strict_types=1);

class UserRepository
{
    public static function create(array $data): array
    {
        $id  = bin2hex(random_bytes(16));
        $now = time();

        error_log('[hilads:repo] UserRepository::create email=' . ($data['email'] ?? 'null'));

        $stmt = Database::pdo()->prepare('
            INSERT INTO users
                (id, email, password_hash, google_id, display_name, birth_year,
                 profile_photo_url, home_city, interests, guest_id, created_at, updated_at)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ');

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

        $created = self::findById($id);
        error_log('[hilads:repo] UserRepository::create done id=' . $id . ' found=' . ($created !== null ? 'yes' : 'no'));
        return $created;
    }

    public static function findById(string $id): ?array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch() ?: null;
        error_log('[hilads:repo] UserRepository::findById id=' . $id . ' found=' . ($row !== null ? 'yes' : 'no'));
        return $row;
    }

    public static function findByEmail(string $email): ?array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM users WHERE email = ?');
        $stmt->execute([strtolower($email)]);
        $row = $stmt->fetch() ?: null;
        error_log('[hilads:repo] UserRepository::findByEmail email=' . $email . ' found=' . ($row !== null ? 'yes' : 'no'));
        return $row;
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
