<?php

declare(strict_types=1);

/**
 * Back office › Cities (V5-01 step 4): search and edit a city (short name,
 * aliases, live switch, proof tolerance), merge two cities, force a suburb
 * onto its main city (geo_city_overrides), and the cities created at a first
 * visit. Every change is written to admin_audit_log.
 */
final class CityAdmin
{
    /**
     * Every column holding a city's channel id ('city_N') and how a merge moves
     * it: null = a plain move; [cols] = rows of the merged city that would
     * collide with a row of the target on these columns are dropped (the
     * target's kept); ['earliest' => ts, 'key' => [cols]] = of two colliding
     * rows the earliest stays (pioneer, Local pass).
     * Not here: channel_events/topics/challenges.channel_id (their own channel),
     * daily_results.scope (recomputed), JSON (moveJson()).
     */
    public const MOVES = [
        ['channels', 'parent_id', null],
        ['messages', 'channel_id', null], // its 3 partial unique keys: dropMessageDuplicates()
        ['presence', 'channel_id', ['session_id']],
        ['user_city_memberships', 'channel_id', ['user_id']],
        ['arrival_cooldown', 'channel_id', ['arriver_key']],
        ['channel_read_positions', 'channel_id', ['identity_key']],
        ['city_sync_log', 'channel_id', []],
        ['channel_events', 'city_id', null],
        ['channel_topics', 'city_id', null],
        ['channel_challenges', 'city_id', null],
        ['channel_challenges', 'target_city_id', null],
        ['event_series', 'city_id', null],
        ['daily_proofs', 'city_id', null],
        ['daily_proofs', 'home_city_id', null],
        ['daily_proposals', 'city_id', null],
        ['daily_specials', 'city_id', null],
        ['daily_twists', 'city_id', null], // one selected twist a day: unselectTwistDuplicates()
        ['daily_local_passes', 'city_id', ['earliest' => 'earned_at', 'key' => ['user_id']]],
        ['daily_pioneers', 'city_id', ['earliest' => 'awarded_at', 'key' => []]],
        ['daily_vote_flags', 'city_id', ['challenge_id', 'user_id']],
        ['places', 'city_id', null],
        ['score_events', 'city_id', null],
        ['user_city_roles', 'city_id', ['user_id', 'role']],
        ['users', 'current_city_id', null],
        ['users', 'home_city_id', null],
        ['users', 'pending_city_id', null],
    ];

    // ── Reads ────────────────────────────────────────────────────────────────

    /**
     * Cities whose name, short name or alias starts with $q, or of that
     * country (2 letters) or id (city_N / N / a GeoNames id). Merged ones too
     * when $withMerged. With members (current city) and photos, most members first.
     */
    public static function search(string $q, bool $withMerged = false, int $limit = 100): array
    {
        $q     = trim($q);
        $where = [];
        $args  = [];
        if ($q !== '') {
            $like  = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower($q)) . '%';
            $or    = ["lower(ch.name) LIKE ?", "lower(coalesce(ci.short_name, '')) LIKE ?",
                      "EXISTS (SELECT 1 FROM unnest(ci.aliases) a WHERE lower(a) LIKE ?)"];
            array_push($args, $like, $like, $like);
            if (preg_match('/^[A-Za-z]{2}$/', $q)) {
                $or[]   = 'ci.country = ?';
                $args[] = strtoupper($q);
            }
            if (preg_match('/^(?:city_)?(\d+)$/', $q, $m)) {
                $or[]   = 'ch.id = ? OR ci.geoname_id = ?';
                array_push($args, 'city_' . $m[1], (int) $m[1]);
            }
            $where[] = '(' . implode(' OR ', $or) . ')';
        }
        if (!$withMerged) $where[] = "ch.status = 'active'";
        return self::rows(($where ? 'WHERE ' . implode(' AND ', $where) : ''), $args, 'members DESC, photos DESC, ch.id', $limit);
    }

    /** The cities created at a first visit, newest first. */
    public static function autoCreated(int $limit = 100): array
    {
        return self::rows("WHERE ci.auto_created AND ch.status = 'active'", [], 'ch.created_at DESC', $limit);
    }

    /** One city with everything the edit page shows, or null. */
    public static function get(string $channelId): ?array
    {
        $rows = self::rows('WHERE ch.id = ?', [$channelId], 'ch.id', 1);
        if (!$rows) return null;
        $city = $rows[0];
        if ($city['geoname_id'] !== null) {
            $stmt = Database::pdo()->prepare("
                SELECT g.name, g.population, g.admin1, o.target_geoname_id, o.note,
                       (o.geoname_id IS NOT NULL) AS has_override
                FROM geo_cities g LEFT JOIN geo_city_overrides o ON o.geoname_id = g.geoname_id
                WHERE g.geoname_id = ?
            ");
            $stmt->execute([$city['geoname_id']]);
            $city['geo'] = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
        }
        // The first people and photos (the created-automatically list links here).
        $stmt = Database::pdo()->prepare("
            SELECT id, username, display_name, created_at FROM users
            WHERE current_city_id = ? AND deleted_at IS NULL ORDER BY current_city_set_at NULLS LAST LIMIT 10
        ");
        $stmt->execute([$channelId]);
        $city['firstUsers'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $stmt = Database::pdo()->prepare("
            SELECT p.id, p.challenge_id, p.photo_url, p.created_at, u.username
            FROM daily_proofs p LEFT JOIN users u ON u.id = p.user_id
            WHERE p.city_id = ? ORDER BY p.created_at LIMIT 12
        ");
        $stmt->execute([$channelId]);
        $city['firstPhotos'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
        return $city;
    }

    private static function rows(string $where, array $args, string $order, int $limit): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT ch.id, ch.name, ch.status, ch.created_at, ci.country, ci.timezone, ci.lat, ci.lng,
                   ci.geoname_id, ci.auto_created, ci.short_name, ci.short_name_i18n::text AS short_name_i18n,
                   array_to_json(ci.aliases)::text AS aliases, ci.merged_into, ci.force_live,
                   ci.proof_geotag_tolerance_km,
                   (SELECT count(*) FROM users u WHERE u.current_city_id = ch.id AND u.deleted_at IS NULL) AS members,
                   (SELECT count(*) FROM daily_proofs p WHERE p.city_id = ch.id) AS photos
            FROM channels ch JOIN cities ci ON ci.channel_id = ch.id
            {$where}
            ORDER BY {$order}
            LIMIT {$limit}
        ");
        $stmt->execute($args);
        return array_map(static function (array $r): array {
            $r['geoname_id']      = $r['geoname_id'] !== null ? (int) $r['geoname_id'] : null;
            $r['short_name_i18n'] = json_decode((string) $r['short_name_i18n'], true) ?: [];
            $r['aliases']         = json_decode((string) $r['aliases'], true) ?: [];
            $r['members']         = (int) $r['members'];
            $r['photos']          = (int) $r['photos'];
            return $r;
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    // ── Edit ─────────────────────────────────────────────────────────────────

    /**
     * Save a city's names and switches. $in: name, short_name, short_name_i18n
     * ("vi = Sài Gòn" lines), aliases (comma or line separated), force_live,
     * tolerance_km (empty = default).
     */
    public static function update(string $channelId, array $in): void
    {
        $before = self::get($channelId);
        if ($before === null) throw new \RuntimeException('Unknown city.');

        $name = trim((string) ($in['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 80) throw new \RuntimeException('The name is required (80 characters at most).');
        $short = trim((string) ($in['short_name'] ?? ''));
        $i18n  = [];
        foreach (preg_split('/\R/', (string) ($in['short_name_i18n'] ?? '')) as $line) {
            if (trim($line) === '') continue;
            if (!preg_match('/^\s*([a-z]{2}(?:-[a-z]+)?)\s*=\s*(.+?)\s*$/i', $line, $m) || !in_array(strtolower($m[1]), DailyI18n::LOCALES, true)) {
                throw new \RuntimeException("Short name per language: \"{$line}\" is not \"locale = name\" with one of our 19 locales.");
            }
            $i18n[strtolower($m[1])] = $m[2];
        }
        $aliases = array_values(array_unique(array_filter(array_map('trim', preg_split('/[,\n]/', (string) ($in['aliases'] ?? ''))))));
        $tol     = trim((string) ($in['tolerance_km'] ?? ''));
        if ($tol !== '' && (!ctype_digit($tol) || (int) $tol < 1 || (int) $tol > 500)) {
            throw new \RuntimeException('Proof tolerance: a number of km between 1 and 500, or empty for the default.');
        }

        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare("UPDATE channels SET name = ?, updated_at = now() WHERE id = ?")->execute([$name, $channelId]);
            $pdo->prepare("
                UPDATE cities SET short_name = ?, short_name_i18n = ?::jsonb, aliases = ?::text[],
                                  force_live = ?, proof_geotag_tolerance_km = ?
                WHERE channel_id = ?
            ")->execute([
                $short !== '' ? $short : null,
                json_encode($i18n ?: new \stdClass(), JSON_UNESCAPED_UNICODE),
                self::pgArray($aliases),
                !empty($in['force_live']) ? 'true' : 'false',
                $tol !== '' ? (int) $tol : null,
                $channelId,
            ]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        self::forgetCaches();
        $keys = ['name', 'short_name', 'short_name_i18n', 'aliases', 'force_live', 'proof_geotag_tolerance_km'];
        DailyAdminService::audit('city.update', 'city', $channelId,
            array_intersect_key($before, array_flip($keys)),
            array_intersect_key(self::get($channelId) ?? [], array_flip($keys)));
    }

    // ── Merge ────────────────────────────────────────────────────────────────

    /**
     * What merging $from into $to moves: [label => rows], only the non-zero
     * ones. Throws when the merge isn't allowed.
     */
    public static function mergePlan(string $from, string $to): array
    {
        self::checkMerge($from, $to);
        $pdo    = Database::pdo();
        $counts = [];
        foreach (self::MOVES as [$table, $col]) {
            $n = self::count("SELECT count(*) FROM {$table} WHERE {$col} = ?", [$from]);
            if ($n > 0) $counts["{$table}.{$col}"] = $n;
        }
        foreach (self::jsonTargets() as [$label, $countSql]) {
            $n = self::count($countSql, self::jsonArgs($countSql, $from));
            if ($n > 0) $counts[$label] = $n;
        }
        $n = self::count("SELECT count(*) FROM daily_results WHERE scope = ?", [$from]);
        if ($n > 0) $counts['daily_results (recomputed)'] = $n;

        // A column added since MOVES was written must not be left behind (or
        // cascade-deleted later): refuse while one holds this city.
        $known = array_map(static fn($m) => "{$m[0]}.{$m[1]}", self::MOVES);
        $fks   = $pdo->query("
            SELECT DISTINCT kcu.table_name || '.' || kcu.column_name
            FROM information_schema.referential_constraints rc
            JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name AND kcu.table_schema = 'public'
            JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = rc.unique_constraint_name AND ccu.table_schema = 'public'
            WHERE ccu.table_name = 'channels' AND ccu.column_name = 'id'
        ")->fetchAll(PDO::FETCH_COLUMN);
        foreach (array_diff($fks, $known, ['cities.channel_id']) as $fk) {
            [$table, $col] = explode('.', $fk);
            if (self::count("SELECT count(*) FROM {$table} WHERE {$col} = ?", [$from]) > 0) {
                throw new \RuntimeException("{$fk} holds {$from} and the merge doesn't know it yet: add it to CityAdmin::MOVES.");
            }
        }
        return $counts;
    }

    /**
     * Merge $from into $to in one transaction: every row and JSON id moves to
     * $to (colliding rows resolved, see MOVES), $from's name becomes an alias
     * of $to, its GeoNames city is attached to $to's (placement sends its
     * people to $to), and $from is marked merged (apps and links that kept it
     * are sent to $to). Then the results of its challenges and the monthly
     * ranks are recomputed. Returns the moved row counts.
     */
    public static function merge(string $from, string $to): array
    {
        $counts = self::mergePlan($from, $to);
        $a   = self::get($from);
        $b   = self::get($to);
        $pdo = Database::pdo();

        $stmt = $pdo->prepare("SELECT DISTINCT challenge_id FROM daily_results WHERE scope IN (?, ?)");
        $stmt->execute([$from, $to]);
        $challenges = $stmt->fetchAll(PDO::FETCH_COLUMN);

        $pdo->beginTransaction();
        try {
            self::dropMessageDuplicates($from, $to);
            self::unselectTwistDuplicates($from, $to);
            foreach (self::MOVES as [$table, $col, $rule]) {
                self::move($table, $col, $rule, $from, $to);
            }
            self::moveJson($from, $to);
            $pdo->prepare("DELETE FROM daily_results WHERE scope = ?")->execute([$from]);

            // $from's GeoNames city now plays in $to's (the 4 duplicate seeds are
            // the same GeoNames city: nothing to attach).
            if ($a['geoname_id'] !== null && $b['geoname_id'] !== null && $a['geoname_id'] !== $b['geoname_id']) {
                $pdo->prepare("
                    INSERT INTO geo_city_overrides (geoname_id, target_geoname_id, note) VALUES (?, ?, ?)
                    ON CONFLICT (geoname_id) DO UPDATE SET target_geoname_id = EXCLUDED.target_geoname_id, note = EXCLUDED.note
                ")->execute([$a['geoname_id'], $b['geoname_id'], "merged {$from} into {$to}"]);
            }
            $aliases = array_values(array_unique(array_merge($b['aliases'], [$a['name']], $a['aliases'])));
            $aliases = array_values(array_filter($aliases, static fn($x) => mb_strtolower($x) !== mb_strtolower($b['name'])));
            $pdo->prepare("UPDATE cities SET aliases = ?::text[], force_live = force_live OR ? WHERE channel_id = ?")
                ->execute([self::pgArray($aliases), $a['force_live'] ? 'true' : 'false', $to]);
            $pdo->prepare("UPDATE cities SET merged_into = ?, geoname_id = NULL WHERE channel_id = ?")->execute([$to, $from]);
            $pdo->prepare("UPDATE channels SET status = 'merged', updated_at = now() WHERE id = ?")->execute([$from]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        self::forgetCaches();
        foreach ($challenges as $challengeId) {
            try {
                DailyResults::compute((string) $challengeId);
            } catch (\Throwable $e) {
                error_log("[city-merge] results of {$challengeId}: " . $e->getMessage());
            }
        }
        try {
            MonthlyRankService::recalcAll();
        } catch (\Throwable $e) {
            error_log('[city-merge] rank recalc: ' . $e->getMessage());
        }
        DailyAdminService::audit('city.merge', 'city', $from, ['city' => $a['name'], 'rows' => $counts], ['merged_into' => $to, 'city' => $b['name']]);
        return $counts;
    }

    private static function checkMerge(string $from, string $to): void
    {
        if ($from === $to) throw new \RuntimeException('A city cannot be merged into itself.');
        foreach ([$from, $to] as $id) {
            $c = preg_match('/^city_\d+$/', $id) ? self::get($id) : null;
            if ($c === null) throw new \RuntimeException("Unknown city {$id}.");
            if ($c['status'] !== 'active') throw new \RuntimeException("{$id} ({$c['name']}) is already merged.");
        }
    }

    private static function move(string $table, string $col, ?array $rule, string $from, string $to): void
    {
        $pdo = Database::pdo();
        if (isset($rule['earliest'])) {
            // Of two colliding rows the earliest stays: drop the target's when later.
            $on = self::sameKey($rule['key']);
            $pdo->prepare("
                DELETE FROM {$table} b WHERE b.{$col} = :to
                  AND EXISTS (SELECT 1 FROM {$table} a WHERE a.{$col} = :from {$on} AND a.{$rule['earliest']} < b.{$rule['earliest']})
            ")->execute(['from' => $from, 'to' => $to]);
            $rule = $rule['key'];
        }
        if ($rule !== null) {
            $on = self::sameKey($rule);
            $pdo->prepare("
                DELETE FROM {$table} a WHERE a.{$col} = :from
                  AND EXISTS (SELECT 1 FROM {$table} b WHERE b.{$col} = :to {$on})
            ")->execute(['from' => $from, 'to' => $to]);
        }
        $pdo->prepare("UPDATE {$table} SET {$col} = ? WHERE {$col} = ?")->execute([$to, $from]);
    }

    /** "AND a.k = b.k" for each key column. */
    private static function sameKey(array $cols): string
    {
        return implode('', array_map(static fn($k) => " AND a.{$k} = b.{$k}", $cols));
    }

    /** The Daily system messages a city's chat holds once per challenge / proof / hour. */
    private static function dropMessageDuplicates(string $from, string $to): void
    {
        foreach (['daily_challenge' => 'challengeId', 'daily_proof' => 'proofId', 'daily_proof_group' => 'hour'] as $event => $key) {
            Database::pdo()->prepare("
                DELETE FROM messages a WHERE a.channel_id = :from AND a.event = :event
                  AND EXISTS (SELECT 1 FROM messages b WHERE b.channel_id = :to AND b.event = :event
                              AND b.payload->>'{$key}' = a.payload->>'{$key}')
            ")->execute(['from' => $from, 'to' => $to, 'event' => $event]);
        }
    }

    /** One selected Local Twist per challenge and city: the target's stays selected. */
    private static function unselectTwistDuplicates(string $from, string $to): void
    {
        Database::pdo()->prepare("
            UPDATE daily_twists a SET status = 'proposed', updated_at = now()
            WHERE a.city_id = :from AND a.status = 'selected'
              AND EXISTS (SELECT 1 FROM daily_twists b WHERE b.city_id = :to AND b.status = 'selected' AND b.challenge_id = a.challenge_id)
        ")->execute(['from' => $from, 'to' => $to]);
    }

    /** [label, count SQL] of the city ids kept inside JSON. */
    private static function jsonTargets(): array
    {
        return [
            ['daily_world_tours.slides', "SELECT count(*) FROM daily_world_tours WHERE slides::text LIKE :quoted"],
            ['daily_index_weeks.cards', "SELECT count(*) FROM daily_index_weeks WHERE cards::text LIKE :quoted"],
            ['push_broadcasts.audience_filter', "SELECT count(*) FROM push_broadcasts WHERE audience_filter->>'channelId' = :num"],
            ['scheduled_pushes.audience_filter', "SELECT count(*) FROM scheduled_pushes WHERE audience_filter->>'channelId' = :num"],
        ];
    }

    private static function jsonArgs(string $sql, string $id): array
    {
        $args = [];
        if (str_contains($sql, ':quoted')) $args['quoted'] = '%"' . $id . '"%';
        if (str_contains($sql, ':num')) $args['num'] = substr($id, 5);
        return $args;
    }

    /** Tours and Index cards keep "city_N"; push audiences {"channelId": N}. */
    private static function moveJson(string $from, string $to): void
    {
        $pdo = Database::pdo();
        foreach (['daily_world_tours' => 'slides', 'daily_index_weeks' => 'cards'] as $table => $col) {
            $pdo->prepare("UPDATE {$table} SET {$col} = replace({$col}::text, :a, :b)::jsonb WHERE {$col}::text LIKE :like")
                ->execute(['a' => '"' . $from . '"', 'b' => '"' . $to . '"', 'like' => '%"' . $from . '"%']);
        }
        foreach (['push_broadcasts', 'scheduled_pushes'] as $table) {
            $pdo->prepare("
                UPDATE {$table} SET audience_filter = jsonb_set(audience_filter, '{channelId}', to_jsonb(CAST(:to AS int)))
                WHERE audience_filter->>'channelId' = :from
            ")->execute(['to' => (int) substr($to, 5), 'from' => substr($from, 5)]);
        }
    }

    // ── Suburbs (placement overrides) ────────────────────────────────────────

    /** Every placement override, with the GeoNames names and Hilads cities involved. */
    public static function overrides(): array
    {
        $rows = Database::pdo()->query("
            SELECT o.geoname_id, o.target_geoname_id, o.note, o.created_at,
                   g.name, g.country, g.population, t.name AS target_name,
                   ch.id AS channel_id, ch.status AS channel_status, tch.id AS target_channel_id
            FROM geo_city_overrides o
            LEFT JOIN geo_cities g ON g.geoname_id = o.geoname_id
            LEFT JOIN geo_cities t ON t.geoname_id = o.target_geoname_id
            LEFT JOIN cities ci ON ci.geoname_id = o.geoname_id
            LEFT JOIN channels ch ON ch.id = ci.channel_id
            LEFT JOIN cities tci ON tci.geoname_id = o.target_geoname_id
            LEFT JOIN channels tch ON tch.id = tci.channel_id
            ORDER BY o.created_at DESC
        ")->fetchAll(PDO::FETCH_ASSOC);
        return $rows;
    }

    /**
     * Force a GeoNames city onto another (its people play there), or keep it
     * its own city ($target null: never absorbed). Returns the Hilads city the
     * suburb already has, if any: the page then offers to merge it.
     */
    public static function setOverride(int $geonameId, ?int $target, string $note): ?string
    {
        $pdo  = Database::pdo();
        $name = static function (int $id) use ($pdo): ?string {
            $s = $pdo->prepare("SELECT name FROM geo_cities WHERE geoname_id = ?");
            $s->execute([$id]);
            return $s->fetchColumn() ?: null;
        };
        if ($name($geonameId) === null) throw new \RuntimeException("Unknown GeoNames id {$geonameId}.");
        if ($target !== null && ($target === $geonameId || $name($target) === null)) throw new \RuntimeException("Unknown or same target {$target}.");

        $before = $pdo->prepare("SELECT target_geoname_id, note FROM geo_city_overrides WHERE geoname_id = ?");
        $before->execute([$geonameId]);
        $pdo->prepare("
            INSERT INTO geo_city_overrides (geoname_id, target_geoname_id, note) VALUES (?, ?, ?)
            ON CONFLICT (geoname_id) DO UPDATE SET target_geoname_id = EXCLUDED.target_geoname_id, note = EXCLUDED.note
        ")->execute([$geonameId, $target, trim($note) !== '' ? trim($note) : null]);
        DailyAdminService::audit('city.override', 'geoname', (string) $geonameId, $before->fetch(PDO::FETCH_ASSOC) ?: null,
            ['target_geoname_id' => $target, 'note' => $note]);

        $own = CityRepository::findByGeonameId($geonameId);
        return $own !== null ? 'city_' . $own['id'] : null;
    }

    public static function deleteOverride(int $geonameId): void
    {
        $pdo    = Database::pdo();
        $before = $pdo->prepare("SELECT target_geoname_id, note FROM geo_city_overrides WHERE geoname_id = ?");
        $before->execute([$geonameId]);
        $pdo->prepare("DELETE FROM geo_city_overrides WHERE geoname_id = ?")->execute([$geonameId]);
        DailyAdminService::audit('city.override_delete', 'geoname', (string) $geonameId, $before->fetch(PDO::FETCH_ASSOC) ?: null, null);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static function count(string $sql, array $args): int
    {
        $stmt = Database::pdo()->prepare($sql);
        $stmt->execute($args);
        return (int) $stmt->fetchColumn();
    }

    /** A PHP list as a Postgres text[] literal. */
    private static function pgArray(array $items): string
    {
        return '{' . implode(',', array_map(static fn($x) => '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $x) . '"', $items)) . '}';
    }

    private static function forgetCaches(): void
    {
        CityRepository::forget();
        Cache::forget('cities_active_v1');
        DailyRules::forgetLiveCities();
    }
}
