<?php

declare(strict_types=1);

/**
 * Spots in the back office (V3-05): list, detail, rename, tags, hide,
 * approve/reject, merge, the queue of new places, and seed spots.
 *
 * A seed is a real, approved proof (is_seed) posted from an account (default
 * @hilads) and attached to a hidden per-theme 'seed' challenge: it backs the
 * spot (map, stats, photos) but stays out of the game (no points, cards,
 * pushes, stamps, Local Pass or challenge gallery).
 */
final class SpotsAdmin
{
    public const LIST_LIMIT     = 200;
    public const NEARBY_M       = 100;
    public const SEED_USERNAME  = 'hilads';
    public const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

    // ── Pure helpers ──────────────────────────────────────────────────────────

    /**
     * A position typed or pasted by the admin: "10.7769, 106.7009", or a map
     * link with "@lat,lng", "ll=" / "q=" / "query=" / "center=", OpenStreetMap
     * "mlat=…&mlon=…" or "#map=z/lat/lng". [lat, lng] or null.
     */
    public static function parsePosition(string $raw): ?array
    {
        $raw = trim(urldecode($raw));
        $num = '(-?\d{1,3}(?:\.\d+)?)';
        $patterns = [
            "/^{$num}\s*[,; ]\s*{$num}$/",
            "/@{$num},{$num}/",
            "/[?&#](?:ll|q|query|center|sll)={$num},\s*{$num}/",
            "/mlat={$num}&mlon={$num}/",
            "/#map=\d+(?:\.\d+)?\/{$num}\/{$num}/",
        ];
        foreach ($patterns as $re) {
            if (preg_match($re, $raw, $m)) {
                [$lat, $lng] = [(float) $m[1], (float) $m[2]];
                if (abs($lat) <= 90 && abs($lng) <= 180 && !($lat == 0.0 && $lng == 0.0)) {
                    return [$lat, $lng];
                }
            }
        }
        return null;
    }

    /** Why $drop can't be merged into $keep, or null when it can. */
    public static function mergeError(array $drop, ?array $keep): ?string
    {
        if ($keep === null) {
            return 'Spot to keep not found.';
        }
        if ($drop['id'] === $keep['id']) {
            return 'Pick another spot to merge into.';
        }
        if ($drop['merged_into'] !== null) {
            return 'This spot was already merged.';
        }
        if ($keep['merged_into'] !== null) {
            return 'That spot was merged into another one: merge into that one instead.';
        }
        if ($keep['status'] === 'rejected') {
            return "Can't merge into a rejected place.";
        }
        if (DailyProofRepository::bool($keep['hidden'])) {
            return 'That spot is hidden: show it first.';
        }
        return null;
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    /**
     * Places for the list, newest first. Filters: city ('city_N'), theme,
     * status (pending | approved | rejected), hidden ('1' | '0'), q (name or
     * admin tag, accent and case insensitive). Merged places are left out.
     */
    public static function list(array $f): array
    {
        [$weekStart, $weekEnd] = Spots::week(DailyClock::currentDate());
        $where = ['pl.merged_into IS NULL'];
        $args  = [$weekStart, $weekEnd];
        if (!empty($f['city'])) {
            $where[] = 'pl.city_id = ?';
            $args[]  = $f['city'];
        }
        if (in_array($f['status'] ?? '', ['pending', 'approved', 'rejected'], true)) {
            $where[] = 'pl.status = ?';
            $args[]  = $f['status'];
        }
        if (($f['hidden'] ?? '') === '1' || ($f['hidden'] ?? '') === '0') {
            $where[] = $f['hidden'] === '1' ? 'pl.hidden' : 'NOT pl.hidden';
        }
        $having = '';
        if (!empty($f['theme'])) {
            $having = 'HAVING bool_or(dc.theme = ? AND p.moderation_status = \'approved\')';
            $args[] = $f['theme'];
        }
        $stmt = Database::pdo()->prepare("
            SELECT pl.id, pl.name, pl.city_id, ch.name AS city_name, pl.status, pl.hidden, pl.created_at,
                   u.username AS creator,
                   count(p.id) FILTER (WHERE p.moderation_status = 'approved') AS approved,
                   count(p.id) FILTER (WHERE p.moderation_status = 'pending')  AS pending,
                   count(p.id) FILTER (WHERE p.is_seed)                         AS seeds,
                   COALESCE(sum(p.vote_count) FILTER (WHERE p.moderation_status = 'approved'), 0) AS votes,
                   COALESCE(sum(p.vote_count) FILTER (WHERE p.moderation_status = 'approved'
                                                      AND dc.challenge_date BETWEEN ?::date AND ?::date), 0) AS votes_week,
                   string_agg(DISTINCT dc.theme, ',') FILTER (WHERE p.moderation_status = 'approved') AS themes,
                   (SELECT string_agg(t.tag, ', ' ORDER BY t.created_at) FROM place_tags t WHERE t.place_id = pl.id) AS tags
            FROM places pl
            LEFT JOIN channels ch          ON ch.id = pl.city_id
            LEFT JOIN users u              ON u.id = pl.created_by
            LEFT JOIN daily_proofs p       ON p.place_id = pl.id
            LEFT JOIN daily_challenges dc  ON dc.id = p.challenge_id
            WHERE " . implode(' AND ', $where) . "
            GROUP BY pl.id, ch.name, u.username
            {$having}
            ORDER BY pl.created_at DESC
            LIMIT 2000
        ");
        $stmt->execute($args);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $q    = trim((string) ($f['q'] ?? ''));
        if ($q !== '') {
            $rows = array_values(array_filter($rows, static fn(array $r): bool =>
                Spots::matches(['name' => $r['name'], 'tags' => Spots::parseTags($r['tags'])], $q)));
        }
        return array_slice($rows, 0, self::LIST_LIMIT);
    }

    /** One place with its city and creator, or null. */
    public static function find(string $id): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT pl.*, ch.name AS city_name, u.username AS creator
            FROM places pl
            LEFT JOIN channels ch ON ch.id = pl.city_id
            LEFT JOIN users u     ON u.id = pl.created_by
            WHERE pl.id = ?
        ");
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /** Every proof of a place (any status), newest first. */
    public static function proofs(string $placeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT p.id, p.photo_url, p.caption, p.price_amount, p.price_currency, p.moderation_status, p.is_seed,
                   p.vote_count, p.distance_m, p.created_at, p.user_id, dc.challenge_date, dc.theme, u.username, u.display_name
            FROM daily_proofs p
            JOIN daily_challenges dc ON dc.id = p.challenge_id
            JOIN users u             ON u.id = p.user_id
            WHERE p.place_id = ?
            ORDER BY p.created_at DESC
        ");
        $stmt->execute([$placeId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** Other places (not merged, not rejected) within NEARBY_M, nearest first, with distanceM. */
    public static function nearby(array $place): array
    {
        [$minLat, $maxLat, $minLng, $maxLng] = Places::boundingBox((float) $place['lat'], (float) $place['lng'], self::NEARBY_M);
        $stmt = Database::pdo()->prepare("
            SELECT pl.id, pl.name, pl.lat, pl.lng, pl.status, pl.hidden,
                   (SELECT count(*) FROM daily_proofs p WHERE p.place_id = pl.id AND p.moderation_status = 'approved') AS approved
            FROM places pl
            WHERE pl.id <> ? AND pl.merged_into IS NULL AND pl.status <> 'rejected'
              AND pl.lat BETWEEN ? AND ? AND pl.lng BETWEEN ? AND ?
        ");
        $stmt->execute([$place['id'], $minLat, $maxLat, $minLng, $maxLng]);
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $r['distanceM'] = Places::distanceM((float) $place['lat'], (float) $place['lng'], (float) $r['lat'], (float) $r['lng']);
            if ($r['distanceM'] <= self::NEARBY_M) {
                $out[] = $r;
            }
        }
        usort($out, static fn(array $a, array $b): int => $a['distanceM'] <=> $b['distanceM']);
        return $out;
    }

    /** ['admin' => [tags], 'twists' => [tags]] of a place. */
    public static function tags(string $placeId): array
    {
        $pdo   = Database::pdo();
        $admin = $pdo->prepare("SELECT tag FROM place_tags WHERE place_id = ? ORDER BY created_at");
        $admin->execute([$placeId]);
        $twist = $pdo->prepare("
            SELECT DISTINCT t.dish_tags FROM daily_proofs p
            JOIN daily_twists t ON t.challenge_id = p.challenge_id AND t.city_id = p.city_id
                               AND t.status = 'selected' AND t.moderation_status = 'approved'
            WHERE p.place_id = ? AND p.moderation_status = 'approved' AND t.dish_tags IS NOT NULL
        ");
        $twist->execute([$placeId]);
        $fromTwists = [];
        foreach ($twist->fetchAll(PDO::FETCH_COLUMN) as $raw) {
            $fromTwists = array_merge($fromTwists, Spots::parseTags($raw));
        }
        return ['admin' => $admin->fetchAll(PDO::FETCH_COLUMN), 'twists' => Spots::mergeTags($fromTwists)];
    }

    /** New places in review, oldest first, each with its latest proof and the spots within NEARBY_M. */
    public static function reviewQueue(): array
    {
        $rows = Database::pdo()->query("
            SELECT pl.*, ch.name AS city_name, u.username AS creator,
                   lp.photo_url, lp.caption, lp.moderation_status AS proof_status, lp.challenge_date,
                   (SELECT count(*) FROM daily_proofs p WHERE p.place_id = pl.id) AS proof_count
            FROM places pl
            LEFT JOIN channels ch ON ch.id = pl.city_id
            LEFT JOIN users u     ON u.id = pl.created_by
            LEFT JOIN LATERAL (
                SELECT p.photo_url, p.caption, p.moderation_status, dc.challenge_date
                FROM daily_proofs p JOIN daily_challenges dc ON dc.id = p.challenge_id
                WHERE p.place_id = pl.id ORDER BY p.created_at DESC LIMIT 1
            ) lp ON true
            WHERE pl.status = 'pending' AND pl.merged_into IS NULL
            ORDER BY pl.created_at ASC
            LIMIT 100
        ")->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$r) {
            $r['nearby'] = self::nearby($r);
        }
        unset($r);
        return $rows;
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    /** Rename a place; the copy on its proofs (read by 1.7.1) follows. */
    public static function rename(string $id, string $name): void
    {
        $before = self::mustFind($id);
        $name   = trim((string) preg_replace('/\s+/u', ' ', $name));
        if ($name === '' || mb_strlen($name) > Places::NAME_MAX) {
            throw new InvalidArgumentException('The name must be 1 to ' . Places::NAME_MAX . ' characters.');
        }
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare("UPDATE places SET name = ?, updated_at = now() WHERE id = ?")->execute([$name, $id]);
            $pdo->prepare("UPDATE daily_proofs SET place_name = ? WHERE place_id = ?")->execute([$name, $id]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        DailyAdminService::audit('place.rename', 'place', $id, $before, self::find($id));
    }

    /** Replace the admin dish tags of a place ("cơm tấm, sườn", at most 5). */
    public static function setTags(string $id, string $raw): void
    {
        self::mustFind($id);
        $tags = Spots::parseTags($raw);
        $pdo  = Database::pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare("DELETE FROM place_tags WHERE place_id = ?")->execute([$id]);
            $ins = $pdo->prepare("INSERT INTO place_tags (place_id, tag, source) VALUES (?, ?, 'admin') ON CONFLICT DO NOTHING");
            foreach ($tags as $t) {
                $ins->execute([$id, $t]);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        DailyAdminService::audit('place.tags', 'place', $id, null, ['tags' => $tags]);
    }

    public static function setHidden(string $id, bool $hidden): void
    {
        $before = self::mustFind($id);
        Database::pdo()->prepare("UPDATE places SET hidden = ?, updated_at = now() WHERE id = ?")
            ->execute([$hidden ? 'true' : 'false', $id]);
        DailyAdminService::audit($hidden ? 'place.hide' : 'place.show', 'place', $id, $before, self::find($id));
    }

    /** Approve or reject a place (its proofs keep their own moderation). */
    public static function setStatus(string $id, string $status): void
    {
        $before = self::mustFind($id);
        if (!in_array($status, ['approved', 'rejected'], true)) {
            throw new InvalidArgumentException('Unknown status.');
        }
        if ($before['merged_into'] !== null) {
            throw new InvalidArgumentException('This spot was merged.');
        }
        Database::pdo()->prepare("UPDATE places SET status = ?, updated_at = now() WHERE id = ?")->execute([$status, $id]);
        DailyAdminService::audit('place.' . $status, 'place', $id, $before, self::find($id));
    }

    /**
     * Merge $dropId into $keepId: its proofs (with their votes, so the stats
     * follow), its admin tags and the places already merged into it move to
     * the kept spot; it keeps merged_into so old links resolve.
     */
    public static function merge(string $dropId, string $keepId): void
    {
        $drop  = self::mustFind($dropId);
        $keep  = self::find($keepId);
        $error = self::mergeError($drop, $keep);
        if ($error !== null) {
            throw new InvalidArgumentException($error);
        }
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare("
                UPDATE daily_proofs SET place_id = ?, place_lat = ?, place_lng = ?, place_name = ?
                WHERE place_id = ?
            ")->execute([$keepId, $keep['lat'], $keep['lng'], $keep['name'], $dropId]);
            $pdo->prepare("
                INSERT INTO place_tags (place_id, tag, source, created_at)
                SELECT ?, tag, source, created_at FROM place_tags WHERE place_id = ?
                ON CONFLICT DO NOTHING
            ")->execute([$keepId, $dropId]);
            $pdo->prepare("DELETE FROM place_tags WHERE place_id = ?")->execute([$dropId]);
            $pdo->prepare("UPDATE places SET merged_into = ?, updated_at = now() WHERE id = ? OR merged_into = ?")
                ->execute([$keepId, $dropId, $dropId]);
            if ($keep['status'] === 'pending' && $drop['status'] === 'approved') {
                $pdo->prepare("UPDATE places SET status = 'approved', updated_at = now() WHERE id = ?")->execute([$keepId]);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        DailyAdminService::audit('place.merge', 'place', $dropId, $drop, ['merged_into' => $keepId]);
    }

    /**
     * Seed a spot with an approved seed proof. $in: spot_id (existing) or
     * name + position (new), theme, caption, price_amount, price_currency,
     * username (default @hilads). $file: the uploaded photo ($_FILES entry).
     * Returns the place id. Checks everything before uploading the photo.
     */
    public static function seed(array $in, ?array $file): string
    {
        $plan = self::seedPlan($in);
        return self::seedCommit($plan, self::storePhoto($file));
    }

    /** Validated seed input (no write): theme, user, caption, price, and the spot or the new place. */
    public static function seedPlan(array $in): array
    {
        $theme = DailyThemes::normalize($in['theme'] ?? null);
        if ($theme === null || !Places::isPlaceTheme($theme)) {
            throw new InvalidArgumentException('Pick a place theme (Ask a local has no place).');
        }
        $username = ltrim(trim((string) ($in['username'] ?? '')), '@') ?: self::SEED_USERNAME;
        $userId   = DailyAdminService::userIdForUsername($username);
        if ($userId === null) {
            throw new InvalidArgumentException("No user @{$username}.");
        }
        $caption = trim((string) preg_replace('/\s+/u', ' ', (string) ($in['caption'] ?? '')));
        if (mb_strlen($caption) > DailyProofRepository::CAPTION_MAX) {
            throw new InvalidArgumentException('The caption is longer than ' . DailyProofRepository::CAPTION_MAX . ' characters.');
        }
        [$amount, $currency] = [null, null];
        if (trim((string) ($in['price_amount'] ?? '')) !== '') {
            $amount   = $in['price_amount'];
            $currency = strtoupper(trim((string) ($in['price_currency'] ?? '')));
            if (!is_numeric($amount) || (float) $amount < 0 || !preg_match('/^[A-Z]{3}$/', $currency)) {
                throw new InvalidArgumentException('The price needs an amount and a 3-letter currency.');
            }
            $amount = round((float) $amount, 2);
        }

        // The place: an existing spot, or a new one at the given position.
        if (!empty($in['spot_id'])) {
            $place = self::find((string) $in['spot_id']);
            while ($place !== null && $place['merged_into'] !== null) {
                $place = self::find((string) $place['merged_into']);
            }
            if ($place === null || $place['status'] === 'rejected') {
                throw new InvalidArgumentException('That spot is not available.');
            }
        } else {
            $name = trim((string) preg_replace('/\s+/u', ' ', (string) ($in['name'] ?? '')));
            if ($name === '' || mb_strlen($name) > Places::NAME_MAX) {
                throw new InvalidArgumentException('Give the new place a name (1 to ' . Places::NAME_MAX . ' characters).');
            }
            $pos = self::parsePosition((string) ($in['position'] ?? ''));
            if ($pos === null) {
                throw new InvalidArgumentException('Paste a position like "10.7769, 106.7009" or a map link with the coordinates.');
            }
            $place = null;
        }
        return ['theme' => $theme, 'username' => $username, 'userId' => $userId, 'caption' => $caption,
                'amount' => $amount, 'currency' => $currency, 'place' => $place,
                'name' => $name ?? null, 'pos' => $pos ?? null];
    }

    /**
     * Write a planned seed with its uploaded photo URL: the place if new, then
     * the approved seed proof. $pick: a Hilads pick's photo (is_pick) with its credit.
     */
    public static function seedCommit(array $plan, string $photoUrl, bool $pick = false, ?string $credit = null): string
    {
        ['theme' => $theme, 'username' => $username, 'userId' => $userId, 'caption' => $caption,
         'amount' => $amount, 'currency' => $currency, 'place' => $place, 'name' => $name, 'pos' => $pos] = $plan;
        if ($place === null) {
            $city   = CityRepository::nearest($pos[0], $pos[1]);
            $cityId = $city !== null ? 'city_' . $city['id'] : null;
            $twin   = Places::findTwin($name, $pos[0], $pos[1], $userId);
            $place  = $twin ?? Places::create($name, $pos[0], $pos[1], $cityId, $userId);
            $place  = self::find($place['id']);
        }

        $stmt = Database::pdo()->prepare("SELECT mode, home_city FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $user     = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $cityName = $place['city_name'];
        $proofId  = bin2hex(random_bytes(8));
        $pdo      = Database::pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare("
                INSERT INTO daily_proofs (id, challenge_id, user_id, city_id, photo_url, caption, price_amount, price_currency,
                                          place_id, place_lat, place_lng, place_name, is_local, is_seed,
                                          moderation_status, approved_at, moderated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, 'approved', now(), now())
            ")->execute([
                $proofId, self::seedChallenge($theme), $userId, $place['city_id'], $photoUrl, $caption === '' ? null : $caption,
                $amount, $currency, $place['id'], $place['lat'], $place['lng'], $place['name'],
                DailyRules::isLocalFor($user['mode'] ?? null, $user['home_city'] ?? null, $cityName) ? 'true' : 'false',
            ]);
            if ($pick) {
                $pdo->prepare("UPDATE daily_proofs SET is_pick = true, photo_credit = ? WHERE id = ?")->execute([$credit, $proofId]);
            }
            $pdo->prepare("UPDATE places SET status = 'approved', updated_at = now() WHERE id = ? AND status = 'pending'")
                ->execute([$place['id']]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        DailyAdminService::audit('place.seed', 'place', $place['id'], null, ['proof' => $proofId, 'theme' => $theme, 'user' => $username]);
        return $place['id'];
    }

    // ── Hilads picks (editorial spots) ───────────────────────────────────────

    public const PICK_STATUSES   = ['draft', 'published', 'hidden'];
    public const PICK_NOTE_MAX   = 280;
    public const PICK_CREDIT_MAX = 120;

    /** The back office's picks, newest first: place, status, note, the pick photo and credit, players' answers there. */
    public static function picks(): array
    {
        return Database::pdo()->query("
            SELECT pl.id, pl.name, pl.lat, pl.lng, pl.status, pl.hidden, pl.pick_status, pl.pick_note_i18n, ch.name AS city_name,
                   pp.id AS pick_proof_id, pp.photo_url, pp.photo_credit, pp.caption, dc.theme,
                   (SELECT count(*) FROM daily_proofs x WHERE x.place_id = pl.id AND x.moderation_status = 'approved'
                                                         AND NOT x.is_seed AND NOT x.is_demo) AS answers
            FROM places pl
            LEFT JOIN channels ch ON ch.id = pl.city_id
            LEFT JOIN LATERAL (SELECT * FROM daily_proofs p WHERE p.place_id = pl.id AND p.is_pick
                               ORDER BY p.created_at DESC LIMIT 1) pp ON true
            LEFT JOIN daily_challenges dc ON dc.id = pp.challenge_id
            WHERE pl.pick_status IS NOT NULL
            ORDER BY pl.updated_at DESC
        ")->fetchAll(PDO::FETCH_ASSOC);
    }

    /** One pick (or null): picks()'s row for a place. */
    public static function pick(string $placeId): ?array
    {
        foreach (self::picks() as $p) {
            if ($p['id'] === $placeId) {
                return $p;
            }
        }
        return null;
    }

    /**
     * The "Good to know" text: en (required) plus any app locale from a JSON
     * object of translations. Returns the stored JSON. Throws on bad input.
     */
    public static function pickNote(string $en, string $translationsJson): string
    {
        $en = trim((string) preg_replace('/\s+/u', ' ', $en));
        if ($en === '' || mb_strlen($en) > self::PICK_NOTE_MAX) {
            throw new InvalidArgumentException('Write the "Good to know" text in English (1 to ' . self::PICK_NOTE_MAX . ' characters).');
        }
        $all = ['en' => $en];
        if (trim($translationsJson) !== '') {
            $tr = json_decode($translationsJson, true);
            if (!is_array($tr)) {
                throw new InvalidArgumentException('Translations must be a JSON object: {"fr": "...", "vi": "..."}.');
            }
            foreach ($tr as $loc => $text) {
                $loc  = DailyI18n::normalize((string) $loc);
                $text = trim((string) preg_replace('/\s+/u', ' ', (string) $text));
                if ($loc === 'en' || $text === '' || !in_array($loc, DailyI18n::LOCALES, true)) {
                    continue;
                }
                if (mb_strlen($text) > self::PICK_NOTE_MAX) {
                    throw new InvalidArgumentException("The {$loc} text is longer than " . self::PICK_NOTE_MAX . ' characters.');
                }
                $all[$loc] = $text;
            }
        }
        return json_encode($all, JSON_UNESCAPED_UNICODE);
    }

    private static function pickCredit(mixed $v): string
    {
        $credit = trim((string) preg_replace('/\s+/u', ' ', (string) $v));
        if ($credit === '' || mb_strlen($credit) > self::PICK_CREDIT_MAX) {
            throw new InvalidArgumentException('Credit the photo (1 to ' . self::PICK_CREDIT_MAX . ' characters), e.g. "Jane Doe / Unsplash" or "Hilads".');
        }
        return $credit;
    }

    private static function pickStatus(mixed $v): string
    {
        $status = (string) $v;
        if (!in_array($status, self::PICK_STATUSES, true)) {
            throw new InvalidArgumentException('Pick status is draft, published or hidden.');
        }
        return $status;
    }

    /**
     * Create a Hilads pick: the place (existing spot or new), its photo as an
     * approved pick proof by the official account with its credit, and the
     * "Good to know" text. $in: seedPlan's fields + credit, note_en,
     * note_translations, pick_status. Returns the place id.
     */
    public static function pickCreate(array $in, ?array $file): string
    {
        $plan   = self::seedPlan($in);
        $credit = self::pickCredit($in['credit'] ?? '');
        $note   = self::pickNote((string) ($in['note_en'] ?? ''), (string) ($in['note_translations'] ?? ''));
        $status = self::pickStatus($in['pick_status'] ?? 'draft');
        $placeId = self::seedCommit($plan, self::storePhoto($file), true, $credit);
        Database::pdo()->prepare("UPDATE places SET pick_note_i18n = ?::jsonb, pick_status = ?, updated_at = now() WHERE id = ?")
            ->execute([$note, $status, $placeId]);
        DailyAdminService::audit('place.pick', 'place', $placeId, null, ['status' => $status, 'credit' => $credit]);
        self::forgetSpots();
        return $placeId;
    }

    /**
     * A pick from an import entry with an already hosted photo: {name, lat, lng,
     * theme, caption, credit, note: {en, fr, ...}, photoUrl, status (default
     * draft)}. Skipped (null) when the place already has a pick photo, so a
     * re-run never duplicates. $dry: validate only. Returns the place id.
     */
    public static function pickImport(array $e, bool $dry = false): ?string
    {
        $in = ['name' => $e['name'] ?? '', 'position' => ($e['lat'] ?? '') . ', ' . ($e['lng'] ?? ''), 'theme' => $e['theme'] ?? '',
               'caption' => $e['caption'] ?? '', 'username' => $e['username'] ?? self::SEED_USERNAME];
        $plan   = self::seedPlan($in);
        $credit = self::pickCredit($e['credit'] ?? '');
        $note   = is_array($e['note'] ?? null) ? $e['note'] : [];
        $noteJs = self::pickNote((string) ($note['en'] ?? ''), json_encode(array_diff_key($note, ['en' => true]), JSON_UNESCAPED_UNICODE));
        $status = self::pickStatus($e['status'] ?? 'draft');
        $photo  = (string) ($e['photoUrl'] ?? '');
        if (!str_starts_with($photo, 'https://')) {
            throw new InvalidArgumentException("{$in['name']}: photoUrl must be an https URL.");
        }
        $twin = Places::findTwin($plan['name'], $plan['pos'][0], $plan['pos'][1], $plan['userId']);
        if ($twin !== null) {
            $stmt = Database::pdo()->prepare("SELECT 1 FROM daily_proofs WHERE place_id = ? AND is_pick LIMIT 1");
            $stmt->execute([$twin['id']]);
            if ($stmt->fetchColumn() !== false) {
                return null;
            }
        }
        if ($dry) {
            return $twin['id'] ?? 'new';
        }
        $placeId = self::seedCommit($plan, $photo, true, $credit);
        Database::pdo()->prepare("UPDATE places SET pick_note_i18n = ?::jsonb, pick_status = ?, updated_at = now() WHERE id = ?")
            ->execute([$noteJs, $status, $placeId]);
        DailyAdminService::audit('place.pick', 'place', $placeId, null, ['status' => $status, 'credit' => $credit, 'import' => true]);
        return $placeId;
    }

    /** Edit a pick: note, status, caption, credit, and optionally a new photo. */
    public static function pickUpdate(string $placeId, array $in, ?array $file): void
    {
        $pick = self::pick($placeId) ?? throw new InvalidArgumentException('That pick does not exist.');
        $note    = self::pickNote((string) ($in['note_en'] ?? ''), (string) ($in['note_translations'] ?? ''));
        $status  = self::pickStatus($in['pick_status'] ?? 'draft');
        $credit  = self::pickCredit($in['credit'] ?? '');
        $caption = trim((string) preg_replace('/\s+/u', ' ', (string) ($in['caption'] ?? '')));
        if (mb_strlen($caption) > DailyProofRepository::CAPTION_MAX) {
            throw new InvalidArgumentException('The caption is longer than ' . DailyProofRepository::CAPTION_MAX . ' characters.');
        }
        $photo = $file !== null && ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE ? self::storePhoto($file) : null;
        $pdo   = Database::pdo();
        $pdo->prepare("UPDATE places SET pick_note_i18n = ?::jsonb, pick_status = ?, updated_at = now() WHERE id = ?")
            ->execute([$note, $status, $placeId]);
        if ($pick['pick_proof_id'] !== null) {
            $pdo->prepare("UPDATE daily_proofs SET photo_credit = ?, caption = ?, photo_url = COALESCE(?, photo_url), updated_at = now() WHERE id = ?")
                ->execute([$credit, $caption === '' ? null : $caption, $photo, $pick['pick_proof_id']]);
        }
        DailyAdminService::audit('place.pick', 'place', $placeId, ['status' => $pick['pick_status']], ['status' => $status, 'credit' => $credit]);
        self::forgetSpots();
    }

    /**
     * Attach a pick to a dated challenge (the Compare tab's "Meanwhile, from our
     * picks"), with an optional answer to its question in the question's type
     * ("1886", "18:30", a word or a short text). Re-attaching replaces the answer.
     */
    public static function pickAttach(string $placeId, string $date, string $answerRaw): void
    {
        self::pick($placeId) ?? throw new InvalidArgumentException('That pick does not exist.');
        $challenge = null;
        if (DailyClock::isValidDate($date)) {
            $stmt = Database::pdo()->prepare("SELECT id, compare_type FROM daily_challenges WHERE challenge_date = ?");
            $stmt->execute([$date]);
            $challenge = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
        }
        if ($challenge === null) {
            throw new InvalidArgumentException("No challenge on {$date}.");
        }
        [$text, $number, $minutes] = [null, null, null];
        if (trim($answerRaw) !== '') {
            $type = $challenge['compare_type'] ?? null;
            if ($type === null) {
                throw new InvalidArgumentException("The {$date} challenge has no comparison question: leave the answer empty.");
            }
            $clean = DailyCompare::cleanAnswer((string) $type, trim($answerRaw));
            if ($clean === null) {
                throw new InvalidArgumentException("That answer doesn't fit the question's type ({$type}).");
            }
            [$text, $number, $minutes] = $clean;
        }
        Database::pdo()->prepare("
            INSERT INTO daily_pick_answers (challenge_id, place_id, answer_text, answer_number, answer_minutes) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (challenge_id, place_id) DO UPDATE
            SET answer_text = EXCLUDED.answer_text, answer_number = EXCLUDED.answer_number, answer_minutes = EXCLUDED.answer_minutes
        ")->execute([$challenge['id'], $placeId, $text, $number, $minutes]);
        DailyAdminService::audit('place.pick_attach', 'place', $placeId, null, ['date' => $date, 'answer' => $text ?? $number ?? $minutes]);
    }

    public static function pickDetach(string $placeId, string $challengeId): void
    {
        Database::pdo()->prepare("DELETE FROM daily_pick_answers WHERE place_id = ? AND challenge_id = ?")->execute([$placeId, $challengeId]);
        DailyAdminService::audit('place.pick_detach', 'place', $placeId, ['challenge' => $challengeId], null);
    }

    /** A pick's challenges: [{challenge_id, date, question, type, answer_text, answer_number, answer_minutes}], newest first. */
    public static function pickAttachments(string $placeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT a.challenge_id, dc.challenge_date::text AS date, dc.compare_question_i18n->>'en' AS question, dc.compare_type AS type,
                   a.answer_text, a.answer_number, a.answer_minutes
            FROM daily_pick_answers a JOIN daily_challenges dc ON dc.id = a.challenge_id
            WHERE a.place_id = ?
            ORDER BY dc.challenge_date DESC NULLS LAST
        ");
        $stmt->execute([$placeId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** Map caches are short (Spots::CACHE_TTL); the back office's own process forgets what it can. */
    private static function forgetSpots(): void
    {
        Cache::forget('spots_cities_v1_all');
    }

    /** The hidden 'seed' challenge of a theme (created on first use). */
    public static function seedChallenge(string $theme): string
    {
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("SELECT id FROM daily_challenges WHERE status = 'seed' AND theme = ? LIMIT 1");
        $stmt->execute([$theme]);
        $id = $stmt->fetchColumn();
        if ($id !== false) {
            return (string) $id;
        }
        $id = bin2hex(random_bytes(8));
        $pdo->prepare("
            INSERT INTO daily_challenges (id, challenge_date, is_reserve, text_i18n, status, theme, created_by)
            VALUES (?, NULL, false, ?::jsonb, 'seed', ?, 'seed')
        ")->execute([$id, json_encode(['en' => 'Seed spots: ' . DailyThemes::name($theme)]), $theme]);
        return $id;
    }

    /** Upload a seed photo like POST /uploads: type and size checks, metadata stripped, thumbnail. */
    private static function storePhoto(?array $file): string
    {
        if ($file === null || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            throw new InvalidArgumentException('Add a photo.');
        }
        if ($file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
            throw new InvalidArgumentException('The photo upload failed. Try again.');
        }
        if ($file['size'] > self::PHOTO_MAX_BYTES) {
            throw new InvalidArgumentException('The photo must be under 10 MB.');
        }
        $mime    = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
        $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
        $info    = @getimagesize($file['tmp_name']);
        if (!isset($allowed[$mime]) || $info === false || $info[0] > 6000 || $info[1] > 6000) {
            throw new InvalidArgumentException('The photo must be a JPEG, PNG or WebP image (max 6000 px).');
        }
        $clean = ImageProcessor::stripMetadata($file['tmp_name'], $mime);
        if ($clean === null) {
            throw new InvalidArgumentException('That photo could not be processed. Try another one.');
        }
        $filename = bin2hex(random_bytes(16)) . '.' . $allowed[$mime];
        try {
            $url = R2Uploader::put($clean, $filename, $mime);
        } catch (RuntimeException $e) {
            @unlink($clean);
            throw new InvalidArgumentException('The photo upload failed: ' . $e->getMessage());
        }
        $thumb = ImageProcessor::generateAvatarThumbnail($clean, $mime);
        @unlink($clean);
        if ($thumb !== null) {
            try {
                R2Uploader::put($thumb, 'thumb_' . pathinfo($filename, PATHINFO_FILENAME) . '.jpg', 'image/jpeg');
            } catch (RuntimeException) {
                // Not fatal: the app falls back to the full photo.
            } finally {
                @unlink($thumb);
            }
        }
        return $url;
    }

    private static function mustFind(string $id): array
    {
        $place = self::find($id);
        if ($place === null) {
            throw new InvalidArgumentException('Spot not found.');
        }
        return $place;
    }
}
