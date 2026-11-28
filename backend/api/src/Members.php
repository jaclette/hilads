<?php

declare(strict_types=1);

/**
 * The Members screen (docs/mockups/hilads_members_mockup.html): who lives in a
 * city (a city's crew) or in the whole World, who is here now, the week's
 * spotlight, and the cities strip of the World.
 *
 * A member is an account whose current city is the city (World: any city).
 * Never listed: deleted, banned (their guest id), test / seed / review
 * accounts, the house account, people who turned off "Show me in member
 * lists", and anyone on either side of a block with the viewer. Presence is
 * only ever "here now" (online in the last 5 minutes), never a last-seen time.
 */
final class Members
{
    public const PAGE    = 30;
    public const FILTERS = ['all', 'here', 'locals', 'travelers', 'friends', 'new'];
    /** "New": arrived in the city (World: joined Hilads) in the last NEW_DAYS days. */
    public const NEW_DAYS = 7;
    private const PRESENCE_TTL = 300; // PresenceRepository::TTL
    private const HERE_MAX = 30;

    /** Who can be listed at all (u = users). */
    public const VISIBLE = "u.deleted_at IS NULL
        AND coalesce(u.show_in_members, true)
        AND NOT coalesce(u.is_fake, false) AND NOT coalesce(u.is_demo, false) AND NOT coalesce(u.is_review, false)
        AND u.username IS DISTINCT FROM 'hilads'
        AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.guest_id = u.guest_id AND (b.expires_at IS NULL OR b.expires_at > now()))";

    /** The city a member last opened when they have no current city (World rows: "last in", else "No city yet"). */
    private const LAST_CITY = "(SELECT m.channel_id FROM messages m WHERE m.user_id = u.id AND m.type = 'system' AND m.event = 'join'
                                ORDER BY m.created_at DESC LIMIT 1) AS last_city_id";

    /** Local: says local, and the city is home (or no home set), the Daily rule without the name match. */
    private const LOCAL = "(u.mode = 'local' AND (u.home_city_id IS NULL OR u.home_city_id = u.current_city_id))";

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    public static function filter(?string $f): string
    {
        return in_array($f, self::FILTERS, true) ? $f : 'all';
    }

    /** 'local' | 'traveler' | null (no mode set: no tag). */
    public static function mode(?string $mode, ?string $homeCityId, ?string $currentCityId): ?string
    {
        if ($mode === null || $mode === '') return null;
        return $mode === 'local' && ($homeCityId === null || $homeCityId === $currentCityId) ? 'local' : 'traveler';
    }

    /** Whole days between $then and $now (0 = today), in UTC. */
    public static function daysAgo(?string $then, ?DateTimeImmutable $now = null): ?int
    {
        if ($then === null || $then === '') return null;
        $utc  = new DateTimeZone('UTC');
        $a    = (new DateTimeImmutable($then))->setTimezone($utc)->setTime(0, 0);
        $b    = ($now ?? new DateTimeImmutable('now', $utc))->setTimezone($utc)->setTime(0, 0);
        return max(0, (int) $a->diff($b)->days);
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    /** The account ids online now (in a city, or in any city): presence rows matched by user or guest id. */
    public static function onlineIds(?string $cityId): array
    {
        $sql = "SELECT DISTINCT coalesce(p.user_id, u.id) FROM presence p
                LEFT JOIN users u ON p.user_id IS NULL AND u.guest_id = p.guest_id
                WHERE p.last_seen_at > now() - interval '" . self::PRESENCE_TTL . " seconds' AND p.guest_id <> 'bot'
                  AND coalesce(p.user_id, u.id) IS NOT NULL" . ($cityId !== null ? ' AND p.channel_id = ?' : " AND p.channel_id LIKE 'city\\_%'");
        $stmt = Database::pdo()->prepare($sql);
        $stmt->execute($cityId !== null ? [$cityId] : []);
        return array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN));
    }

    /** [sql, args]: the visible members of the scope the viewer may see (no block either way). */
    private static function base(?string $cityId, ?string $viewerId, ?string $viewerGuestId): array
    {
        $where = [self::VISIBLE];
        $args  = [];
        if ($cityId !== null) {
            $where[] = 'u.current_city_id = ?';
            $args[]  = $cityId;
        }
        $blocks = BlockRepository::getBidirectional($viewerId, $viewerGuestId);
        if ($blocks['user_ids'] !== []) {
            $where[] = 'u.id NOT IN (' . implode(',', array_fill(0, count($blocks['user_ids']), '?')) . ')';
            array_push($args, ...$blocks['user_ids']);
        }
        if ($blocks['guest_ids'] !== []) {
            $where[] = '(u.guest_id IS NULL OR u.guest_id NOT IN (' . implode(',', array_fill(0, count($blocks['guest_ids']), '?')) . '))';
            array_push($args, ...$blocks['guest_ids']);
        }
        return [implode(' AND ', $where), $args];
    }

    /**
     * A page of members: {members: [row], nextOffset}. Here now first, then
     * friends, then the most recently active; the viewer is not in the list.
     */
    public static function page(?string $cityId, ?string $viewerId, ?string $viewerGuestId, string $filter = 'all',
                                string $q = '', int $offset = 0, int $limit = self::PAGE): array
    {
        $pdo    = Database::pdo();
        $online = self::onlineIds($cityId);
        [$where, $args] = self::base($cityId, $viewerId, $viewerGuestId);
        if ($viewerId !== null) {
            $where .= ' AND u.id <> ?';
            $args[] = $viewerId;
        }
        $hereSql = $online === [] ? 'false' : 'u.id IN (' . implode(',', array_fill(0, count($online), '?')) . ')';
        $friendSql = $viewerId !== null ? 'EXISTS (SELECT 1 FROM user_friends f WHERE f.user_id = ? AND f.friend_id = u.id)' : 'false';

        switch (self::filter($filter)) {
            case 'here':      $where .= " AND {$hereSql}"; array_push($args, ...$online); break;
            case 'locals':    $where .= ' AND ' . self::LOCAL; break;
            case 'travelers': $where .= ' AND u.mode IS NOT NULL AND NOT ' . self::LOCAL; break;
            case 'friends':   $where .= " AND {$friendSql}"; if ($viewerId !== null) $args[] = $viewerId; break;
            case 'new':
                // New = joined Hilads in the last NEW_DAYS days (the NEW tag and "Joined yesterday" say the same).
                $where .= " AND to_timestamp(u.created_at) > now() - interval '" . self::NEW_DAYS . " days'";
                break;
        }
        $q = trim(mb_substr($q, 0, 60));
        if ($q !== '') {
            $like  = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], ltrim($q, '@')) . '%';
            // World: a city matches by any of its names ("Saigon" finds Ho Chi Minh City).
            $cityIds = $cityId === null ? self::citiesNamed($q) : [];
            $where .= ' AND (u.username ILIKE ? OR u.display_name ILIKE ?'
                    . ($cityIds !== [] ? ' OR u.current_city_id IN (' . implode(',', array_fill(0, count($cityIds), '?')) . ')' : '') . ')';
            array_push($args, $like, $like, ...$cityIds);
        }

        $limit  = max(1, min(60, $limit));
        $offset = max(0, $offset);
        $sql = "
            SELECT u.id, u.username, u.display_name, coalesce(u.profile_thumb_photo_url, u.profile_photo_url) AS photo,
                   u.mode, u.home_city_id, u.current_city_id, ch.name AS city_name, " . self::LAST_CITY . ",
                   to_timestamp(u.created_at) AS created_at, coalesce(u.current_city_set_at, to_timestamp(u.created_at)) AS arrived_at,
                   coalesce(u.allow_waves, true) AS allow_waves,
                   ({$hereSql}) AS here, ({$friendSql}) AS friend
            FROM users u
            LEFT JOIN channels ch ON ch.id = u.current_city_id
            WHERE {$where}
            ORDER BY here DESC, friend DESC,
                     greatest(u.current_city_last_confirmed_at, u.current_city_set_at, to_timestamp(u.updated_at), to_timestamp(u.created_at)) DESC NULLS LAST, u.id
            LIMIT " . ($limit + 1) . " OFFSET {$offset}";
        // The SELECT's here/friend come before WHERE's placeholders.
        $selectArgs = $online;
        if ($viewerId !== null) $selectArgs[] = $viewerId;
        $stmt = $pdo->prepare($sql);
        $stmt->execute(array_merge($selectArgs, $args));
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $more = count($rows) > $limit;
        $rows = array_slice($rows, 0, $limit);
        return ['members' => self::decorate($rows, $viewerId, $cityId === null), 'nextOffset' => $more ? $offset + $limit : null];
    }


    /** Ids ('city_N') of the active cities whose name or short name (English or the UI language) contains $q. */
    public static function citiesNamed(string $q): array
    {
        $fold = static fn(string $v): string => mb_strtolower(trim((string) (iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $v) ?: $v)));
        $want = $fold(ltrim($q, '@'));
        if ($want === '') return [];
        $out = [];
        foreach (WorldCities::active() as $c) {
            foreach ([$c['name'], CityNames::short($c['name']), CityNames::short($c['name'], DailyI18n::current())] as $name) {
                if (str_contains($fold((string) $name), $want)) { $out[] = 'city_' . $c['channelId']; break; }
            }
        }
        return $out;
    }

    /** Rows → the API shape, with streaks, photos, duels with the viewer and the wave state. */
    private static function decorate(array $rows, ?string $viewerId, bool $world): array
    {
        if ($rows === []) return [];
        $ids     = array_column($rows, 'id');
        $streaks = self::streaks($ids);
        $photos  = self::photoCounts($ids);
        $duels   = $viewerId !== null ? self::duelCounts($viewerId, $ids) : [];
        $waves   = $viewerId !== null ? Waves::states($viewerId, $ids) : [];
        $out = [];
        foreach ($rows as $r) {
            $id = (string) $r['id'];
            // No current city: the city they last opened (World rows say "last in"), else none ("No city yet").
            $shown   = $r['current_city_id'] ?: ($r['last_city_id'] ?? null);
            $cityNum = preg_match('/^city_(\d+)$/', (string) $shown, $m) ? (int) $m[1] : null;
            $cityRow = $cityNum !== null && !$r['current_city_id'] ? CityRepository::findById($cityNum) : null;
            $out[] = [
                'id'          => $id,
                'username'    => $r['username'],
                'displayName' => $r['username'] ?: $r['display_name'],
                'photo'       => $r['photo'],
                'mode'        => self::mode($r['mode'], $r['home_city_id'], $r['current_city_id']),
                'here'        => DailyProofRepository::bool($r['here']),
                'friend'      => DailyProofRepository::bool($r['friend']),
                'streak'      => $streaks[$id] ?? 0,
                'photos'      => $photos[$id] ?? 0,
                'duels'       => $duels[$id] ?? 0,
                'joinedDays'  => self::daysAgo($r['created_at']),
                'isNew'       => self::daysAgo($r['created_at']) !== null && self::daysAgo($r['created_at']) < self::NEW_DAYS,
                'city'        => $world && $cityNum !== null ? [
                    'id'      => $cityNum,
                    'name'    => CityNames::short($r['current_city_id'] ? $r['city_name'] : ($cityRow['name'] ?? null), DailyI18n::current()),
                    'country' => CityRepository::countryOf($cityNum),
                    'last'    => !$r['current_city_id'],
                ] : null,
                'noCity'      => $world && $cityNum === null,
                'canWave'     => $r['id'] !== $viewerId && DailyProofRepository::bool($r['allow_waves']),
                'wave'        => $waves[$id] ?? 'none',
            ];
        }
        return $out;
    }

    /** Current Daily streaks of these users: [id => days] (the DailyResults rule, in two queries). */
    public static function streaks(array $userIds): array
    {
        if ($userIds === []) return [];
        $pdo   = Database::pdo();
        $today = DailyClock::currentDate();
        $dates = Cache::remember('members_dates_' . $today, 300, static function () use ($pdo, $today): array {
            $stmt = $pdo->prepare("SELECT challenge_date::text FROM daily_challenges WHERE status = 'published'
                                   AND challenge_date <= ?::date AND challenge_date > ?::date - 120 ORDER BY challenge_date");
            $stmt->execute([$today, $today]);
            return $stmt->fetchAll(PDO::FETCH_COLUMN);
        }) ?? [];
        if ($dates === []) return [];
        $done = [];
        foreach (array_chunk($userIds, 500) as $chunk) {
            $stmt = $pdo->prepare("
                SELECT DISTINCT p.user_id, dc.challenge_date::text AS d
                FROM daily_proofs p JOIN daily_challenges dc ON dc.id = p.challenge_id
                WHERE p.user_id IN (" . implode(',', array_fill(0, count($chunk), '?')) . ")
                  AND p.moderation_status = 'approved' AND NOT p.is_demo AND dc.challenge_date >= ?::date
            ");
            $stmt->execute([...$chunk, $dates[0]]);
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $done[(string) $r['user_id']][$r['d']] = true;
            }
        }
        $out = [];
        foreach ($done as $id => $set) {
            $out[$id] = DailyResults::countStreaks($dates, $set, $today)[0];
        }
        return $out;
    }

    /** Approved real Daily photos per user. */
    private static function photoCounts(array $ids): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT p.user_id, count(*) FROM daily_proofs p
            WHERE p.user_id IN (" . implode(',', array_fill(0, count($ids), '?')) . ")
              AND p.moderation_status = 'approved' AND NOT p.is_demo AND NOT p.is_seed AND NOT p.is_suggestion
            GROUP BY p.user_id
        ");
        $stmt->execute($ids);
        return array_map('intval', $stmt->fetchAll(PDO::FETCH_KEY_PAIR));
    }

    /** Challenges the viewer and each user both played (ProfileCard::duels' set). */
    private static function duelCounts(string $viewerId, array $ids): array
    {
        $real = static fn(string $t): string => "{$t}.moderation_status = 'approved' AND NOT {$t}.is_demo AND NOT {$t}.is_seed AND NOT {$t}.is_suggestion";
        $stmt = Database::pdo()->prepare("
            SELECT b.user_id, count(DISTINCT b.challenge_id)
            FROM daily_proofs a JOIN daily_proofs b ON b.challenge_id = a.challenge_id
            WHERE a.user_id = ? AND {$real('a')}
              AND b.user_id IN (" . implode(',', array_fill(0, count($ids), '?')) . ") AND {$real('b')}
            GROUP BY b.user_id
        ");
        $stmt->execute([$viewerId, ...$ids]);
        return array_map('intval', $stmt->fetchAll(PDO::FETCH_KEY_PAIR));
    }

    /**
     * Everything above the list: {counts: {here, members, cities?}, hereNow: [row],
     * spotlight: [card], cities?: [{id, name, country, members}]}.
     */
    public static function summary(?string $cityId, ?string $viewerId, ?string $viewerGuestId): array
    {
        $pdo    = Database::pdo();
        $online = self::onlineIds($cityId);
        [$where, $args] = self::base($cityId, $viewerId, $viewerGuestId);

        $stmt = $pdo->prepare("SELECT count(*), count(DISTINCT u.current_city_id) FROM users u WHERE {$where}");
        $stmt->execute($args);
        [$members, $cities] = $stmt->fetch(PDO::FETCH_NUM);

        // Here now: me first (when I am one of them), then the others online, most recently active first.
        $here = [];
        if ($online !== []) {
            $stmt = $pdo->prepare("
                SELECT u.id, u.username, u.display_name, coalesce(u.profile_thumb_photo_url, u.profile_photo_url) AS photo,
                       u.mode, u.home_city_id, u.current_city_id, ch.name AS city_name, " . self::LAST_CITY . ", to_timestamp(u.created_at) AS created_at,
                       coalesce(u.current_city_set_at, to_timestamp(u.created_at)) AS arrived_at, coalesce(u.allow_waves, true) AS allow_waves,
                       true AS here, false AS friend
                FROM users u LEFT JOIN channels ch ON ch.id = u.current_city_id
                WHERE {$where} AND u.id IN (" . implode(',', array_fill(0, count($online), '?')) . ")
                ORDER BY (u.id = ?) DESC, greatest(u.current_city_last_confirmed_at, to_timestamp(u.updated_at)) DESC NULLS LAST, u.id
                LIMIT " . self::HERE_MAX);
            $stmt->execute([...$args, ...$online, $viewerId ?? '']);
            $here = self::decorate($stmt->fetchAll(PDO::FETCH_ASSOC), $viewerId, $cityId === null);
        }

        // Just landed: members who joined Hilads in the last NEW_DAYS days, newest first, with how many welcomed them.
        $stmt = $pdo->prepare("
            SELECT u.id, u.username, u.display_name, coalesce(u.profile_thumb_photo_url, u.profile_photo_url) AS photo,
                   u.mode, u.home_city_id, u.current_city_id, ch.name AS city_name, " . self::LAST_CITY . ",
                   to_timestamp(u.created_at) AS created_at, coalesce(u.current_city_set_at, to_timestamp(u.created_at)) AS arrived_at,
                   coalesce(u.allow_waves, true) AS allow_waves, false AS here, false AS friend
            FROM users u LEFT JOIN channels ch ON ch.id = u.current_city_id
            WHERE {$where} AND to_timestamp(u.created_at) > now() - interval '" . self::NEW_DAYS . " days'
            ORDER BY u.created_at DESC, u.id LIMIT 20");
        $stmt->execute($args);
        $landed = self::decorate($stmt->fetchAll(PDO::FETCH_ASSOC), $viewerId, $cityId === null);
        $welcomes = self::welcomeCounts(array_column($landed, 'id'));
        foreach ($landed as &$l) $l['welcomes'] = $welcomes[$l['id']] ?? 0;
        unset($l);

        // The viewer: a newcomer (first NEW_DAYS days) gets a friendly line; no current city → pick one.
        $me = null;
        if ($viewerId !== null) {
            $stmt = $pdo->prepare("SELECT to_timestamp(created_at) AS created_at, current_city_id FROM users WHERE id = ?");
            $stmt->execute([$viewerId]);
            if ($u = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $me = ['isNew' => (self::daysAgo($u['created_at']) ?? 99) < self::NEW_DAYS, 'hasCity' => $u['current_city_id'] !== null];
            }
        }

        $out = [
            'counts'    => ['here' => count($here), 'members' => (int) $members] + ($cityId === null ? ['cities' => (int) $cities] : []),
            'hereNow'   => $here,
            'justLanded' => $landed,
            'me'        => $me,
            'spotlight' => $cityId !== null ? self::citySpotlight($cityId, $where, $args, $viewerId) : self::worldSpotlight($where, $args),
        ];
        if ($cityId === null) {
            $out['cities'] = self::cities($where, $args);
        }
        return $out;
    }

    /** How many different people welcomed each of these members (waves with source 'welcome'). */
    private static function welcomeCounts(array $ids): array
    {
        if ($ids === []) return [];
        try {
            $stmt = Database::pdo()->prepare("SELECT to_user_id, count(DISTINCT from_user_id) FROM waves
                                              WHERE source = 'welcome' AND to_user_id IN (" . implode(',', array_fill(0, count($ids), '?')) . ")
                                              GROUP BY to_user_id");
            $stmt->execute($ids);
            return array_map('intval', $stmt->fetchAll(PDO::FETCH_KEY_PAIR));
        } catch (\Throwable) {
            return [];
        }
    }

    /** Members per city, most first. */
    private static function cities(string $where, array $args): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT u.current_city_id, count(*) AS n FROM users u WHERE {$where}
            GROUP BY u.current_city_id ORDER BY n DESC, u.current_city_id
        ");
        $stmt->execute($args);
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if (!preg_match('/^city_(\d+)$/', (string) $r['current_city_id'], $m)) continue;
            $city = CityRepository::findById((int) $m[1]);
            if ($city === null) continue;
            $out[] = ['id' => (int) $m[1], 'name' => CityNames::short($city['name'], DailyI18n::current()),
                      'country' => $city['country'] ?? CityRepository::countryOf((int) $m[1]), 'members' => (int) $r['n']];
        }
        return $out;
    }

    private static function person(array $r): array
    {
        return ['id' => (string) $r['id'], 'displayName' => $r['username'] ?: $r['display_name'],
                'photo' => $r['photo'] ?? $r['thumb'] ?? null];
    }

    /** A city's week: its top player, its longest current streak, the newest arrival. Cards without data are left out. */
    private static function citySpotlight(string $cityId, string $where, array $args, ?string $viewerId): array
    {
        $pdo   = Database::pdo();
        $today = DailyClock::currentDate();
        $cards = [];

        // Ids the viewer may see in this city (the base set), to filter the cached rankings.
        $stmt = $pdo->prepare("SELECT u.id, u.username, u.display_name, coalesce(u.profile_thumb_photo_url, u.profile_photo_url) AS photo,
                                      coalesce(u.current_city_set_at, to_timestamp(u.created_at)) AS arrived_at
                               FROM users u WHERE {$where}");
        $stmt->execute($args);
        $visible = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) $visible[(string) $r['id']] = $r;

        foreach (Ranks::playerRows('week', $cityId, $today) as $r) {
            if (isset($visible[(string) $r['id']]) && (int) $r['points'] > 0) {
                $cards[] = ['kind' => 'top_local', 'user' => self::person($visible[(string) $r['id']]), 'value' => (int) $r['points']];
                break;
            }
        }

        $best = null;
        foreach (self::streaks(array_keys($visible)) as $id => $days) {
            if ($days >= 2 && ($best === null || $days > $best[1])) $best = [$id, $days];
        }
        if ($best !== null) {
            $cards[] = ['kind' => 'streak', 'user' => self::person($visible[$best[0]]), 'value' => $best[1]];
        }

        $newest = null;
        foreach ($visible as $id => $r) {
            if ($id === $viewerId || strtotime((string) $r['arrived_at']) < time() - 14 * 86400) continue;
            if ($newest === null || strtotime((string) $r['arrived_at']) > strtotime((string) $newest['arrived_at'])) $newest = $r;
        }
        if ($newest !== null) {
            $cards[] = ['kind' => 'newest', 'user' => self::person($newest), 'value' => self::daysAgo($newest['arrived_at'])];
        }
        return $cards;
    }

    /** The World's week: the top player, the city with the most photos, the newest city (its crew started last). */
    private static function worldSpotlight(string $where, array $args): array
    {
        $pdo   = Database::pdo();
        $today = DailyClock::currentDate();
        $cards = [];
        $city  = static function (string $cityId): ?array {
            if (!preg_match('/^city_(\d+)$/', $cityId, $m)) return null;
            $c = CityRepository::findById((int) $m[1]);
            return $c === null ? null : ['id' => (int) $m[1], 'name' => CityNames::short($c['name'], DailyI18n::current()),
                                         'country' => $c['country'] ?? CityRepository::countryOf((int) $m[1])];
        };

        $rows = Ranks::playerRows('week', null, $today);
        if ($rows !== []) {
            $ids  = array_slice(array_column($rows, 'id'), 0, 20);
            $stmt = $pdo->prepare("SELECT u.id FROM users u WHERE {$where} AND u.id IN (" . implode(',', array_fill(0, count($ids), '?')) . ')');
            $stmt->execute([...$args, ...$ids]);
            $ok = array_flip(array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN)));
            foreach ($rows as $r) {
                if (isset($ok[(string) $r['id']]) && (int) $r['points'] > 0) {
                    $c = isset($r['current_city_id']) ? $city((string) $r['current_city_id']) : null;
                    $cards[] = ['kind' => 'top_player', 'user' => self::person($r), 'value' => (int) $r['points'], 'city' => $c];
                    break;
                }
            }
        }

        $data = Cache::remember('members_world_week_' . $today, 300, static function () use ($pdo, $today): array {
            $real = "p.moderation_status = 'approved' AND NOT p.is_demo AND NOT p.is_seed AND NOT p.is_suggestion AND p.city_id IS NOT NULL";
            [$from, $to] = Spots::week($today);
            $stmt = $pdo->prepare("SELECT p.city_id, count(*) AS n FROM daily_proofs p JOIN daily_challenges dc ON dc.id = p.challenge_id
                                   WHERE {$real} AND dc.challenge_date BETWEEN ?::date AND ?::date
                                   GROUP BY p.city_id ORDER BY n DESC, p.city_id LIMIT 1");
            $stmt->execute([$from, $to]);
            $week = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
            return ['week' => $week];
        }) ?? [];
        if (!empty($data['week']) && ($c = $city((string) $data['week']['city_id'])) !== null) {
            $cards[] = ['kind' => 'city_week', 'city' => $c, 'value' => (int) $data['week']['n']];
        }
        // The newest city: the one whose crew started most recently (its earliest member still there arrived
        // in the last 30 days), among the members the viewer can see.
        $stmt = $pdo->prepare("SELECT u.current_city_id, min(coalesce(u.current_city_set_at, to_timestamp(u.created_at))) AS first
                               FROM users u WHERE {$where} GROUP BY u.current_city_id
                               HAVING min(coalesce(u.current_city_set_at, to_timestamp(u.created_at))) > now() - interval '30 days'
                               ORDER BY first DESC LIMIT 1");
        $stmt->execute($args);
        $newest = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
        if ($newest !== null && ($c = $city((string) $newest['current_city_id'])) !== null) {
            $cards[] = ['kind' => 'new_city', 'city' => $c, 'value' => self::daysAgo((string) $newest['first'])];
        }
        return $cards;
    }

    /**
     * The Hi header's members line (no viewer): visible members of a city and up
     * to 3 avatars (here now first, then the latest arrivals with a photo). Cached 60 s.
     */
    public static function headerLine(int $cityChannel): array
    {
        return Cache::remember('members_line_' . $cityChannel, 60, static function () use ($cityChannel): array {
            $cityId = 'city_' . $cityChannel;
            $online = self::onlineIds($cityId);
            $here   = $online === [] ? 'false' : 'u.id IN (' . implode(',', array_fill(0, count($online), '?')) . ')';
            $stmt = Database::pdo()->prepare("
                SELECT count(*) OVER () AS n, coalesce(u.profile_thumb_photo_url, u.profile_photo_url) AS photo,
                       coalesce(u.username, u.display_name) AS name
                FROM users u WHERE " . self::VISIBLE . " AND u.current_city_id = ?
                ORDER BY ({$here}) DESC, (coalesce(u.profile_thumb_photo_url, u.profile_photo_url) IS NOT NULL) DESC,
                         coalesce(u.current_city_set_at, to_timestamp(u.created_at)) DESC
                LIMIT 3");
            $stmt->execute([$cityId, ...$online]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            return ['members' => (int) ($rows[0]['n'] ?? 0),
                    'avatars' => array_map(static fn(array $r): array => ['photo' => $r['photo'], 'name' => (string) $r['name']], $rows)];
        }) ?? ['members' => 0, 'avatars' => []];
    }

    /** The World's header line: 3 avatars of people online anywhere (else the latest members). Cached 60 s. */
    public static function worldHeaderLine(): array
    {
        return Cache::remember('members_line_world', 60, static function (): array {
            $online = self::onlineIds(null);
            $here   = $online === [] ? 'false' : 'u.id IN (' . implode(',', array_fill(0, count($online), '?')) . ')';
            $stmt = Database::pdo()->prepare("
                SELECT count(*) OVER () AS n, coalesce(u.profile_thumb_photo_url, u.profile_photo_url) AS photo,
                       coalesce(u.username, u.display_name) AS name
                FROM users u WHERE " . self::VISIBLE . "
                ORDER BY ({$here}) DESC, (coalesce(u.profile_thumb_photo_url, u.profile_photo_url) IS NOT NULL) DESC, u.created_at DESC
                LIMIT 3");
            $stmt->execute($online);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            return ['members' => (int) ($rows[0]['n'] ?? 0),
                    'avatars' => array_map(static fn(array $r): array => ['photo' => $r['photo'], 'name' => (string) $r['name']], $rows)];
        }) ?? ['members' => 0, 'avatars' => []];
    }
}
