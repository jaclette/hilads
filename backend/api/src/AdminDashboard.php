<?php

declare(strict_types=1);

/**
 * The back office dashboard's numbers (admin/dashboard.php). Every block is computed here,
 * cached briefly (the dashboard is opened often, the numbers move slowly), and fails soft:
 * a block that can't be computed returns ['error' => …] and the page says so in that tile.
 *
 * users.created_at is a unix timestamp (integer); the other tables use timestamptz.
 * Days: Daily numbers follow the challenge date (DailyClock); sign-ups and the "came back"
 * numbers follow the Saigon day (the ops timezone of the back office).
 * Test and fake accounts (is_fake, is_demo, is_review) and seeded / demo / suggestion photos are
 * left out everywhere.
 */
final class AdminDashboard
{
    private const TZ = 'Asia/Ho_Chi_Minh';
    private const REAL_PHOTO = "NOT p.is_seed AND NOT p.is_demo AND NOT p.is_suggestion AND p.moderation_status NOT IN ('rejected', 'removed')";
    private const REAL_USER  = "NOT coalesce(u.is_fake, false) AND NOT coalesce(u.is_demo, false) AND NOT coalesce(u.is_review, false)";

    /** Run a block, turning a failure into an error the page can show. */
    private static function safe(string $name, callable $f): array
    {
        try {
            return $f();
        } catch (\Throwable $e) {
            error_log("[admin-dashboard] {$name}: " . $e->getMessage());
            return ['error' => 'Could not load this right now.'];
        }
    }

    private static function pdo(): PDO
    {
        return Database::pdo();
    }

    private static function shift(string $date, int $days): string
    {
        return (new DateTimeImmutable($date, new DateTimeZone('UTC')))->modify(($days >= 0 ? '+' : '') . $days . ' days')->format('Y-m-d');
    }

    // ── Today vs yesterday ───────────────────────────────────────────────────

    /** Photos, players and cities on today's and yesterday's challenges, plus sign-ups. */
    public static function kpis(): array
    {
        return self::safe('kpis', fn () => Cache::remember('admin_dash_kpis', 60, function (): array {
            $today = DailyClock::currentDate();
            $yest  = self::shift($today, -1);
            $st = self::pdo()->prepare("
                SELECT dc.challenge_date::text AS d, count(p.id) AS photos, count(DISTINCT p.user_id) AS players,
                       count(DISTINCT p.city_id) AS cities
                FROM daily_challenges dc
                LEFT JOIN daily_proofs p ON p.challenge_id = dc.id AND " . self::REAL_PHOTO . "
                WHERE dc.challenge_date IN (?, ?) AND NOT dc.is_reserve
                GROUP BY dc.challenge_date
            ");
            $st->execute([$today, $yest]);
            $by = [];
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $by[$r['d']] = $r;
            $sign = self::pdo()->prepare("
                SELECT count(*) FILTER (WHERE (to_timestamp(u.created_at) AT TIME ZONE '" . self::TZ . "')::date = (now() AT TIME ZONE '" . self::TZ . "')::date) AS today,
                       count(*) FILTER (WHERE (to_timestamp(u.created_at) AT TIME ZONE '" . self::TZ . "')::date = (now() AT TIME ZONE '" . self::TZ . "')::date - 1) AS yesterday,
                       count(*) FILTER (WHERE u.created_at > extract(epoch FROM now() - interval '7 days')) AS week
                FROM users u
                WHERE u.created_at > extract(epoch FROM now() - interval '8 days') AND " . self::REAL_USER . "
            ");
            $sign->execute();
            $s = $sign->fetch(PDO::FETCH_ASSOC);
            $pick = fn (string $d, string $k): int => (int) ($by[$d][$k] ?? 0);
            return [
                'date' => $today,
                'photos'  => ['today' => $pick($today, 'photos'),  'yesterday' => $pick($yest, 'photos')],
                'players' => ['today' => $pick($today, 'players'), 'yesterday' => $pick($yest, 'players')],
                'cities'  => ['today' => $pick($today, 'cities'),  'yesterday' => $pick($yest, 'cities')],
                'signups' => ['today' => (int) $s['today'], 'yesterday' => (int) $s['yesterday'], 'week' => (int) $s['week']],
            ];
        }) ?? []);
    }

    /** Photos per challenge day, the last $days days (today last). */
    public static function photosByDay(int $days = 14): array
    {
        return self::safe('photosByDay', fn () => Cache::remember("admin_dash_photos_{$days}", 120, function () use ($days): array {
            $today = DailyClock::currentDate();
            $from  = self::shift($today, -($days - 1));
            $st = self::pdo()->prepare("
                SELECT dc.challenge_date::text AS d, count(p.id) AS n
                FROM daily_challenges dc
                LEFT JOIN daily_proofs p ON p.challenge_id = dc.id AND " . self::REAL_PHOTO . "
                WHERE dc.challenge_date BETWEEN ? AND ? AND NOT dc.is_reserve
                GROUP BY dc.challenge_date
            ");
            $st->execute([$from, $today]);
            $by = $st->fetchAll(PDO::FETCH_KEY_PAIR);
            $out = [];
            for ($i = $days - 1; $i >= 0; $i--) {
                $d = self::shift($today, -$i);
                $out[] = ['date' => $d, 'photos' => (int) ($by[$d] ?? 0)];
            }
            return ['days' => $out];
        }) ?? []);
    }

    // ── Came back (our own data) ─────────────────────────────────────────────

    /**
     * "Active players who came back": of the accounts created on a day, the share that did
     * something (a photo, a like, a comment, a chat message) the next day (D1) or 7 days later (D7).
     * Averaged over the last 7 complete sign-up days. Our own data can't see app opens.
     */
    public static function cameBack(): array
    {
        return self::safe('cameBack', fn () => Cache::remember('admin_dash_cameback', 600, function (): array {
            $tz = self::TZ;
            $st = self::pdo()->query("
                WITH today AS (SELECT (now() AT TIME ZONE '{$tz}')::date AS d),
                cohort AS (
                    SELECT u.id, (to_timestamp(u.created_at) AT TIME ZONE '{$tz}')::date AS d0
                    FROM users u, today
                    WHERE u.created_at > extract(epoch FROM now() - interval '16 days') AND u.deleted_at IS NULL AND " . self::REAL_USER . "
                      AND (to_timestamp(u.created_at) AT TIME ZONE '{$tz}')::date BETWEEN today.d - 14 AND today.d - 2
                ),
                act AS (
                    SELECT user_id AS id, (created_at AT TIME ZONE '{$tz}')::date AS d FROM daily_proofs
                        WHERE created_at > now() - interval '16 days' AND user_id IS NOT NULL AND NOT is_seed AND NOT is_demo
                    UNION SELECT voter_user_id, (created_at AT TIME ZONE '{$tz}')::date FROM daily_votes
                        WHERE created_at > now() - interval '16 days' AND voter_user_id IS NOT NULL
                    UNION SELECT user_id, (created_at AT TIME ZONE '{$tz}')::date FROM photo_comments
                        WHERE created_at > now() - interval '16 days' AND user_id IS NOT NULL
                    UNION SELECT user_id, (created_at AT TIME ZONE '{$tz}')::date FROM messages
                        WHERE created_at > now() - interval '16 days' AND user_id IS NOT NULL AND type = 'text'
                )
                SELECT
                    count(*) FILTER (WHERE c.d0 BETWEEN t.d - 8 AND t.d - 2) AS d1_base,
                    count(*) FILTER (WHERE c.d0 BETWEEN t.d - 8 AND t.d - 2
                                       AND EXISTS (SELECT 1 FROM act a WHERE a.id = c.id AND a.d = c.d0 + 1)) AS d1_back,
                    count(*) FILTER (WHERE c.d0 BETWEEN t.d - 14 AND t.d - 8) AS d7_base,
                    count(*) FILTER (WHERE c.d0 BETWEEN t.d - 14 AND t.d - 8
                                       AND EXISTS (SELECT 1 FROM act a WHERE a.id = c.id AND a.d = c.d0 + 7)) AS d7_back
                FROM cohort c, today t
            ");
            $r = $st->fetch(PDO::FETCH_ASSOC);
            $pct = fn (int $back, int $base): ?int => $base > 0 ? (int) round(100 * $back / $base) : null;
            return [
                'source' => 'own',
                'd1' => $pct((int) $r['d1_back'], (int) $r['d1_base']), 'd1Base' => (int) $r['d1_base'],
                'd7' => $pct((int) $r['d7_back'], (int) $r['d7_base']), 'd7Base' => (int) $r['d7_base'],
            ];
        }) ?? []);
    }

    // ── Retention (PostHog, when configured) ─────────────────────────────────

    public static function posthogConfigured(): bool
    {
        return (getenv('POSTHOG_PERSONAL_API_KEY') ?: '') !== '' && (getenv('POSTHOG_PROJECT_ID') ?: '') !== '';
    }

    /**
     * D1 / D7 retention from PostHog: people first seen on a day who came back (any event) the next
     * day / 7 days later, averaged over the same cohort days as cameBack(). Needs a personal API key
     * with only the "Query: Read" scope (POSTHOG_PERSONAL_API_KEY), POSTHOG_PROJECT_ID and
     * POSTHOG_API_HOST (the app host, https://us.posthog.com or https://eu.posthog.com).
     * Null when not configured; ['error' => …] when PostHog didn't answer.
     */
    public static function retention(): ?array
    {
        if (!self::posthogConfigured()) return null;
        $cached = Cache::get('admin_dash_retention');
        if ($cached !== null) return $cached;
        $hogql = "
            SELECT
                uniqExactIf(pid, d0 >= today() - 8 AND d0 <= today() - 2) AS d1_base,
                uniqExactIf(pid, d0 >= today() - 8 AND d0 <= today() - 2 AND d = d0 + 1) AS d1_back,
                uniqExactIf(pid, d0 >= today() - 14 AND d0 <= today() - 8) AS d7_base,
                uniqExactIf(pid, d0 >= today() - 14 AND d0 <= today() - 8 AND d = d0 + 7) AS d7_back
            FROM (
                SELECT person_id AS pid, toDate(person.created_at) AS d0, toDate(timestamp) AS d
                FROM events
                WHERE timestamp >= now() - INTERVAL 16 DAY
                  AND person.created_at >= now() - INTERVAL 16 DAY
            )";
        try {
            $host = rtrim((string) (getenv('POSTHOG_API_HOST') ?: 'https://us.posthog.com'), '/');
            $res = self::http('POST', $host . '/api/projects/' . rawurlencode((string) getenv('POSTHOG_PROJECT_ID')) . '/query/',
                ['Authorization: Bearer ' . getenv('POSTHOG_PERSONAL_API_KEY'), 'Content-Type: application/json'],
                json_encode(['query' => ['kind' => 'HogQLQuery', 'query' => $hogql], 'name' => 'admin dashboard retention']), 12);
            if ($res['code'] !== 200 || !isset($res['json']['results'][0])) {
                throw new \RuntimeException('PostHog answered ' . $res['code'] . ' ' . mb_substr((string) ($res['json']['detail'] ?? $res['raw']), 0, 160));
            }
            [$d1Base, $d1Back, $d7Base, $d7Back] = array_map('intval', $res['json']['results'][0]);
            $pct = fn (int $back, int $base): ?int => $base > 0 ? (int) round(100 * $back / $base) : null;
            $out = ['source' => 'posthog', 'd1' => $pct($d1Back, $d1Base), 'd1Base' => $d1Base, 'd7' => $pct($d7Back, $d7Base), 'd7Base' => $d7Base];
            Cache::set('admin_dash_retention', $out, 3600);
            return $out;
        } catch (\Throwable $e) {
            error_log('[admin-dashboard] posthog: ' . $e->getMessage());
            $out = ['error' => 'PostHog: ' . $e->getMessage()];
            Cache::set('admin_dash_retention', $out, 300);
            return $out;
        }
    }

    // ── Needs attention ──────────────────────────────────────────────────────

    public static function attention(): array
    {
        return self::safe('attention', function (): array {
            $pdo = self::pdo();
            $oldest = $pdo->query("SELECT min(created_at) FROM photo_watch WHERE seen_at IS NULL")->fetchColumn();
            $reports = (int) $pdo->query("SELECT count(*) FROM user_reports WHERE status = 'open'")->fetchColumn();
            $commentReports = 0;
            try {
                $commentReports = (int) $pdo->query("SELECT count(DISTINCT r.comment_id) FROM photo_comment_reports r JOIN photo_comments c ON c.id = r.comment_id
                                                     WHERE r.status = 'open' AND c.deleted_at IS NULL AND c.hidden_at IS NULL")->fetchColumn();
            } catch (\Throwable) { /* older schema */ }
            $messageReports = 0;
            try {
                $messageReports = (int) $pdo->query("SELECT count(DISTINCT r.message_id) FROM message_reports r JOIN messages m ON m.id = r.message_id AND m.type = 'text'
                                                     WHERE r.status = 'open'")->fetchColumn();
            } catch (\Throwable) { /* older schema */ }
            return [
                'messageReports' => $messageReports,
                'photos'    => PhotoWatch::unseenCount(),
                'photosOldest' => $oldest ?: null,
                'reports'   => $reports,
                'commentReports' => $commentReports,
                'proposals' => DailyProposals::pendingCount(),
                'cities'    => CityAdmin::newAutoCount(),
            ];
        });
    }

    // ── Today's challenge and the week ahead ─────────────────────────────────

    /** What a day needs to be ready: published/scheduled, 19 languages, a cover, a question. */
    private static function readiness(?array $c): array
    {
        if ($c === null) return ['exists' => false, 'langs' => 0, 'cover' => null, 'question' => false];
        $tr = DailyI18n::translated(json_decode((string) $c['text_i18n'], true) ?: []);
        $cover = null;
        if (!empty($c['cover_url'])) {
            $cover = 'own';
        } elseif (!empty($c['special_id']) && (DailySpecials::payload($c['special_id'], 'en')['coverUrl'] ?? null)) {
            $cover = 'special day';
        } elseif ((DailyThemes::covers()[$c['theme'] ?? ''] ?? null) !== null) {
            $cover = 'theme';
        }
        return [
            'exists'   => true,
            'langs'    => min(19, count($tr) + 1),     // English + the translated ones
            'cover'    => $cover,
            'question' => ($c['compare_type'] ?? null) !== null,
        ];
    }

    public static function today(): array
    {
        return self::safe('today', function (): array {
            $today = DailyClock::currentDate();
            $day = DailyAdminService::calendar($today, $today)[0];
            $c = $day['challenge'];
            $st = self::pdo()->prepare("SELECT status, error, finished_at FROM daily_drop_runs WHERE challenge_date = ? ORDER BY started_at DESC LIMIT 1");
            $st->execute([$today]);
            $run = $st->fetch(PDO::FETCH_ASSOC) ?: null;
            $st = self::pdo()->prepare("
                SELECT count(*) AS total, count(*) FILTER (WHERE status = 'sent') AS sent,
                       count(*) FILTER (WHERE status IN ('queued', 'sending')) AS waiting
                FROM daily_push_log WHERE challenge_date = ? AND type = 'morning'
            ");
            $st->execute([$today]);
            $push = $st->fetch(PDO::FETCH_ASSOC);
            return [
                'date' => $today,
                'state' => $day['state'],
                'id' => $c['id'] ?? null,
                'text' => $c ? self::text($c) : null,
                'theme' => $c['theme'] ?? null, 'specialId' => $c['special_id'] ?? null,
                'publishedAt' => $c['published_at'] ?? null,
                'run' => $run,
                'push' => ['total' => (int) $push['total'], 'sent' => (int) $push['sent'], 'waiting' => (int) $push['waiting']],
            ] + self::readiness($c);
        });
    }

    /** The next $n drops (tomorrow first): what each has, and whether it is a gap. */
    public static function week(int $n = 7): array
    {
        return self::safe('week', function () use ($n): array {
            $today = DailyClock::currentDate();
            $days = DailyAdminService::calendar(self::shift($today, 1), self::shift($today, $n));
            $out = [];
            foreach ($days as $day) {
                $c = $day['challenge'];
                $ready = self::readiness($c);
                $out[] = [
                    'date' => $day['date'],
                    'state' => $day['state'],
                    'id' => $c['id'] ?? null,
                    'text' => $c ? self::text($c) : null,
                    'theme' => $c['theme'] ?? null, 'specialId' => $c['special_id'] ?? null,
                    'gap' => !in_array($day['state'], ['scheduled', 'published', 'reserve_used'], true),
                ] + $ready;
            }
            $reserve = (int) self::pdo()->query("SELECT count(*) FROM daily_challenges WHERE is_reserve AND challenge_date IS NULL AND status = 'scheduled'")->fetchColumn();
            return ['days' => $out, 'reserve' => $reserve];
        });
    }

    private static function text(array $c): string
    {
        $t = json_decode((string) $c['text_i18n'], true) ?: [];
        return (string) ($t['en'] ?? (is_array($t) ? reset($t) : '') ?: '');
    }

    // ── Season top 5 ─────────────────────────────────────────────────────────

    /** The running Launch Season's top 5 when there is one, else this month's season. */
    public static function seasonTop(int $n = 5): array
    {
        return self::safe('seasonTop', function () use ($n): array {
            $season = Contest::visibleFor(null);
            if ($season !== null && in_array(Contest::phase($season), ['season', 'final', 'over'], true)) {
                $phase = Contest::phase($season) === 'final' ? 'final' : 'season';
                $st = Contest::standings($season);
                $rows = [];
                foreach (array_slice($st[$phase] ?? [], 0, $n) as $id) {
                    $r = Contest::rowPayload($st['rows'][$id], $phase);
                    $rows[] = ['rank' => $r['rank'], 'name' => $r['displayName'], 'username' => $r['username'], 'points' => $r['points'], 'userId' => $r['userId']];
                }
                return ['title' => $season['name'] . ($phase === 'final' ? ' · final week' : ''), 'link' => '/admin/launch-season?id=' . $season['id'], 'rows' => $rows];
            }
            $today = DailyClock::currentDate();
            $res = Ranks::players('season', null, null, $today, $n);
            $rows = array_map(fn ($e) => ['rank' => $e['rank'], 'name' => $e['user']['displayName'], 'username' => $e['user']['username'],
                                          'points' => $e['points'], 'userId' => $e['user']['id']], $res['entries']);
            return ['title' => 'Season ' . date('F', strtotime($today)), 'link' => '/admin/scoring', 'rows' => $rows];
        });
    }

    // ── Recent errors (Sentry, when configured) ──────────────────────────────

    public static function sentryConfigured(): bool
    {
        return (getenv('SENTRY_API_TOKEN') ?: '') !== '' && (getenv('SENTRY_ORG') ?: '') !== '';
    }

    /**
     * Unresolved Sentry issues seen in the last 24 h, most recent first. Needs a token with only
     * the event:read scope (SENTRY_API_TOKEN), SENTRY_ORG (slug), optional SENTRY_PROJECT_ID
     * (numeric; all projects when empty) and SENTRY_API_HOST (default https://sentry.io; EU: https://de.sentry.io).
     */
    public static function errors(int $n = 5): ?array
    {
        if (!self::sentryConfigured()) return null;
        $cached = Cache::get('admin_dash_errors');
        if ($cached !== null) return $cached;
        try {
            $host = rtrim((string) (getenv('SENTRY_API_HOST') ?: 'https://sentry.io'), '/');
            $q = ['statsPeriod' => '24h', 'query' => 'is:unresolved', 'sort' => 'date', 'limit' => $n];
            if (($p = (string) (getenv('SENTRY_PROJECT_ID') ?: '')) !== '') $q['project'] = $p;
            $res = self::http('GET', $host . '/api/0/organizations/' . rawurlencode((string) getenv('SENTRY_ORG')) . '/issues/?' . http_build_query($q),
                ['Authorization: Bearer ' . getenv('SENTRY_API_TOKEN')], null, 8);
            if ($res['code'] !== 200 || !is_array($res['json'])) {
                throw new \RuntimeException('Sentry answered ' . $res['code']);
            }
            $issues = array_map(fn ($i) => [
                'title' => (string) ($i['title'] ?? ''), 'culprit' => (string) ($i['culprit'] ?? ''),
                'count' => (int) ($i['count'] ?? 0), 'users' => (int) ($i['userCount'] ?? 0),
                'lastSeen' => (string) ($i['lastSeen'] ?? ''), 'link' => (string) ($i['permalink'] ?? ''),
                'project' => (string) ($i['project']['slug'] ?? ''), 'level' => (string) ($i['level'] ?? 'error'),
            ], array_slice($res['json'], 0, $n));
            $out = ['issues' => $issues];
            Cache::set('admin_dash_errors', $out, 300);
            return $out;
        } catch (\Throwable $e) {
            error_log('[admin-dashboard] sentry: ' . $e->getMessage());
            $out = ['error' => $e->getMessage()];
            Cache::set('admin_dash_errors', $out, 120);
            return $out;
        }
    }

    /** A small HTTP call (curl): ['code', 'json', 'raw']. */
    private static function http(string $method, string $url, array $headers, ?string $body, int $timeout): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 4,
        ]);
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        $raw = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false) throw new \RuntimeException($err ?: 'no answer');
        return ['code' => $code, 'json' => json_decode((string) $raw, true), 'raw' => (string) $raw];
    }
}
