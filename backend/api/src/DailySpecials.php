<?php

declare(strict_types=1);

/**
 * Special days (SPEC 9.15): a calendar kept in the back office
 * (daily_specials: date, id, localized name, emoji, icon, cover, scope).
 *
 * - world: the day's challenge gets theme "special" and special_id (the
 *   importer or the back office sets them); its approved proofs earn a
 *   limited-edition stamp (Passport "Special stamps"), never a Local Pass stamp.
 * - country / city: the challenge stays the weekday's; the founder brings the
 *   day in through the Local Twist (the back office calendar shows it).
 *
 * id is a slug ("halloween"), unique: a special that comes back next year
 * gets a new one ("halloween-2027") so its stamp stays limited.
 */
final class DailySpecials
{
    public const SCOPES = ['world', 'country', 'city'];

    /** Defaults for a special created by an import: emoji (push, stamp) and app icon (Ionicons). */
    private const KNOWN = [
        'halloween' => ['🎃', 'skull-outline'],
        'christmas' => ['🎄', 'gift-outline'],
        'new-year'  => ['🎆', 'sparkles-outline'],
        'tet'       => ['🧧', 'flower-outline'],
    ];
    private const DEFAULT_EMOJI = '✨';
    private const DEFAULT_ICON  = 'sparkles-outline';

    /** @var array<string, ?array> per request */
    private static array $rows = [];

    public static function isValidId(mixed $id): bool
    {
        return is_string($id) && preg_match('/^[a-z0-9][a-z0-9-]{0,47}$/', $id) === 1;
    }

    public static function find(?string $id): ?array
    {
        if ($id === null || $id === '') {
            return null;
        }
        if (!array_key_exists($id, self::$rows)) {
            try {
                $stmt = Database::pdo()->prepare("SELECT * FROM daily_specials WHERE id = ?");
                $stmt->execute([$id]);
                self::$rows[$id] = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
            } catch (\Throwable $e) {
                self::$rows[$id] = null;   // before the migration
            }
        }
        return self::$rows[$id];
    }

    /** The special's name in $locale (English fallback). Pure. */
    public static function nameOf(array $row, string $locale): string
    {
        $names = is_array($row['name_i18n'] ?? null) ? $row['name_i18n'] : (json_decode((string) ($row['name_i18n'] ?? '{}'), true) ?: []);
        return DailyI18n::pick($names, $locale) ?? (string) ($names['en'] ?? $row['id']);
    }

    /** Payload {id, name, emoji, icon, coverUrl, scope} of a challenge's special, or null. */
    public static function payload(?string $id, ?string $locale = null): ?array
    {
        $row = self::find($id);
        if ($row === null) {
            return null;
        }
        return [
            'id'       => $row['id'],
            'name'     => self::nameOf($row, $locale ?? DailyI18n::current()),
            'emoji'    => $row['emoji'] ?: self::DEFAULT_EMOJI,
            'icon'     => $row['icon'] ?: self::DEFAULT_ICON,
            'coverUrl' => ($row['cover_url'] ?? null) ?: null,
            'scope'    => $row['scope'],
        ];
    }

    /** Push emoji of a special (its own, else the default). */
    public static function emoji(?string $id): string
    {
        return (self::find($id)['emoji'] ?? null) ?: self::DEFAULT_EMOJI;
    }

    // ── Back office ──────────────────────────────────────────────────────────

    /** Specials from $from on (all when null), by date. */
    public static function listFrom(?string $from = null): array
    {
        $sql  = "SELECT s.*, ch.name AS city_name FROM daily_specials s LEFT JOIN channels ch ON ch.id = s.city_id";
        $args = [];
        if ($from !== null) {
            $sql   .= " WHERE s.date >= ?";
            $args[] = $from;
        }
        $stmt = Database::pdo()->prepare($sql . " ORDER BY s.date, s.id");
        $stmt->execute($args);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** Specials of the dates between $from and $to: date => [rows]. */
    public static function byDate(string $from, string $to): array
    {
        try {
            $stmt = Database::pdo()->prepare("SELECT * FROM daily_specials WHERE date BETWEEN ? AND ? ORDER BY scope, id");
            $stmt->execute([$from, $to]);
        } catch (\Throwable $e) {
            return [];
        }
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $out[(string) $r['date']][] = $r;
        }
        return $out;
    }

    /**
     * Validated back-office / import input. $in: id, date, names {locale: name}
     * (en required), emoji, icon, scope, country, cityId. Pure apart from the
     * city check callback. Throws InvalidArgumentException.
     */
    public static function clean(array $in, ?callable $cityExists = null): array
    {
        $id = strtolower(trim((string) ($in['id'] ?? '')));
        if (!self::isValidId($id)) {
            throw new InvalidArgumentException('Id: lowercase letters, digits and dashes (e.g. halloween).');
        }
        $date = trim((string) ($in['date'] ?? ''));
        if (!DailyClock::isValidDate($date)) {
            throw new InvalidArgumentException('Date must be YYYY-MM-DD.');
        }
        $names = [];
        foreach (is_array($in['names'] ?? null) ? $in['names'] : [] as $l => $v) {
            $l = DailyI18n::normalize((string) $l);
            $v = trim((string) $v);
            if ($v !== '') {
                if (mb_strlen($v) > 40) {
                    throw new InvalidArgumentException("Name ({$l}) is longer than 40 characters.");
                }
                $names[$l] = $v;
            }
        }
        if (($names['en'] ?? '') === '') {
            throw new InvalidArgumentException('The English name is required.');
        }
        $scope = (string) ($in['scope'] ?? 'world');
        if (!in_array($scope, self::SCOPES, true)) {
            throw new InvalidArgumentException('Scope is world, country or city.');
        }
        $country = strtoupper(trim((string) ($in['country'] ?? '')));
        $cityId  = trim((string) ($in['cityId'] ?? ''));
        if ($scope === 'country' && !preg_match('/^[A-Z]{2}$/', $country)) {
            throw new InvalidArgumentException('A country special needs a 2-letter country code (VN, FR...).');
        }
        if ($scope === 'city' && ($cityId === '' || ($cityExists !== null && !$cityExists($cityId)))) {
            throw new InvalidArgumentException('A city special needs a city.');
        }
        $emoji = trim((string) ($in['emoji'] ?? ''));
        $icon  = trim((string) ($in['icon'] ?? ''));
        if ($icon !== '' && !preg_match('/^[a-z0-9-]{1,40}$/', $icon)) {
            throw new InvalidArgumentException('Icon: an Ionicons name such as skull-outline.');
        }
        return [
            'id' => $id, 'date' => $date, 'names' => $names, 'scope' => $scope,
            'country' => $scope === 'country' ? $country : null,
            'cityId'  => $scope === 'city' ? $cityId : null,
            'emoji'   => mb_substr($emoji, 0, 8) ?: (self::KNOWN[$id][0] ?? self::DEFAULT_EMOJI),
            'icon'    => $icon ?: (self::KNOWN[$id][1] ?? self::DEFAULT_ICON),
        ];
    }

    /** Create or update (cover untouched). */
    public static function save(array $s): void
    {
        Database::pdo()->prepare("
            INSERT INTO daily_specials (id, date, name_i18n, emoji, icon, scope, country, city_id)
            VALUES (?, ?, ?::jsonb, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, name_i18n = EXCLUDED.name_i18n, emoji = EXCLUDED.emoji,
                icon = EXCLUDED.icon, scope = EXCLUDED.scope, country = EXCLUDED.country, city_id = EXCLUDED.city_id,
                updated_at = now()
        ")->execute([$s['id'], $s['date'], json_encode((object) $s['names'], JSON_UNESCAPED_UNICODE),
                     $s['emoji'], $s['icon'], $s['scope'], $s['country'], $s['cityId']]);
        unset(self::$rows[$s['id']]);
    }

    /**
     * A special named by an import ("special": {"id", "name"}): created as a
     * world special on $date, or its names and date updated (emoji, icon and
     * cover kept). $names = {locale: name}, en required.
     */
    public static function upsertFromImport(string $id, string $date, array $names): void
    {
        $row = self::find($id);
        self::save(self::clean([
            'id' => $id, 'date' => $date, 'names' => $names, 'scope' => 'world',
            'emoji' => $row['emoji'] ?? '', 'icon' => $row['icon'] ?? '',
        ]));
    }

    public static function setCover(string $id, ?string $url): void
    {
        Database::pdo()->prepare("UPDATE daily_specials SET cover_url = ?, updated_at = now() WHERE id = ?")->execute([$url, $id]);
        unset(self::$rows[$id]);
    }

    /** Delete a special; its challenges keep their text and become their weekday's theme. */
    public static function delete(string $id): void
    {
        $pdo = Database::pdo();
        $pdo->prepare("
            UPDATE daily_challenges SET theme = NULL, special_id = NULL WHERE special_id = ?
        ")->execute([$id]);
        $pdo->prepare("DELETE FROM daily_specials WHERE id = ?")->execute([$id]);
        unset(self::$rows[$id]);
    }

    // ── Stamps ───────────────────────────────────────────────────────────────

    /**
     * A user's limited-edition stamps: one per special day with an approved
     * proof, oldest first: [{id, name, emoji, icon, date, city}].
     */
    public static function stampsFor(string $userId, ?string $locale = null): array
    {
        try {
            $stmt = Database::pdo()->prepare("
                SELECT DISTINCT ON (s.id) s.*, p.city_id, ch.name AS city_name
                FROM daily_proofs p
                JOIN daily_challenges dc ON dc.id = p.challenge_id
                JOIN daily_specials s    ON s.id = dc.special_id
                LEFT JOIN channels ch    ON ch.id = p.city_id
                WHERE p.user_id = ? AND p.moderation_status = 'approved' AND NOT p.is_seed AND NOT p.is_demo
                ORDER BY s.id, p.created_at
            ");
            $stmt->execute([$userId]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (\Throwable $e) {
            return [];
        }
        usort($rows, static fn(array $a, array $b): int => strcmp((string) $a['date'], (string) $b['date']));
        $locale = $locale ?? DailyI18n::current();
        return array_map(static fn(array $r): array => [
            'id'    => $r['id'],
            'name'  => self::nameOf($r, $locale),
            'emoji' => $r['emoji'] ?: self::DEFAULT_EMOJI,
            'icon'  => $r['icon'] ?: self::DEFAULT_ICON,
            'date'  => (string) $r['date'],
            'city'  => $r['city_id'] !== null
                ? ['id' => (int) substr((string) $r['city_id'], 5), 'name' => $r['city_name'], 'country' => CityRepository::countryOf((string) $r['city_id'])]
                : null,
        ], $rows);
    }
}
