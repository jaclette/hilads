<?php

declare(strict_types=1);

/**
 * The public web pages of past Daily Challenges (hilads.live SEO): the
 * /challenges archive, one /challenge/{date}-{slug} page per closed challenge
 * and the recent photos of a city page, read by the web's Vercel functions
 * (prerender, sitemap, og).
 *
 * Players' photos only: approved, never a Hilads suggestion, a seed or a demo
 * (nor any photo of a demo account). Public data only: the photo, its
 * username, its city and its answer. Closed challenges only (a challenge
 * date before today's), so a page never changes while people play.
 *
 * Cached 10 minutes; the web caches the pages a day at the CDN.
 */
final class DailyWeb
{
    private const CACHE_TTL = 600;
    /** A city page lists its photos of the last challenges it played. */
    public const CITY_RECENT = 12;

    private const REAL = "p.moderation_status = 'approved' AND NOT p.is_seed AND NOT p.is_demo AND NOT u.is_demo AND NOT p.is_suggestion";

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /**
     * The URL slug of a challenge, from its English question, else its English
     * text: "How do locals say cheers?" → "how-do-locals-say-cheers". At most
     * 60 characters, cut at a word. Pure.
     */
    public static function slug(?string $question, ?string $text): string
    {
        $src = trim((string) ($question ?: $text));
        // Accents off ("café" → "cafe"): intl when the server has it, else the common Latin letters.
        $ascii = class_exists('Normalizer')
            ? (string) preg_replace('/\p{Mn}+/u', '', (string) Normalizer::normalize($src, Normalizer::FORM_D))
            : strtr($src, ['à' => 'a', 'á' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a', 'å' => 'a', 'ç' => 'c', 'è' => 'e', 'é' => 'e',
                           'ê' => 'e', 'ë' => 'e', 'ì' => 'i', 'í' => 'i', 'î' => 'i', 'ï' => 'i', 'ñ' => 'n', 'ò' => 'o', 'ó' => 'o',
                           'ô' => 'o', 'õ' => 'o', 'ö' => 'o', 'ù' => 'u', 'ú' => 'u', 'û' => 'u', 'ü' => 'u', 'ý' => 'y', 'ÿ' => 'y']);
        // "Where's" → "wheres", not "where-s".
        $s = trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower(str_replace(["'", '’'], '', $ascii))), '-');
        if (strlen($s) > 60) {
            $cut = substr($s, 0, 61);
            $s = rtrim(str_contains($cut, '-') ? substr($cut, 0, (int) strrpos($cut, '-')) : substr($s, 0, 60), '-');
        }
        return $s !== '' ? $s : 'challenge';
    }

    /**
     * Proof rows (city_id, city_name, country, vote_count, created_at, id,
     * answer_*) grouped by country, most photos first: {country, rows (ranked,
     * DailyResults::rankProofs), best (the top photo), answered (the best photo
     * with an answer, else the best), cities [{name, count}]}. Pure.
     */
    public static function byCountry(array $rows): array
    {
        $groups = [];
        foreach ($rows as $r) {
            $groups[(string) ($r['country'] ?? '') ?: 'city:' . $r['city_id']][] = $r;
        }
        $out = [];
        foreach ($groups as $list) {
            $ranked = DailyResults::rankProofs($list);
            $cities = [];
            foreach ($ranked as $r) {
                $cities[$r['city_name']] = ($cities[$r['city_name']] ?? 0) + 1;
            }
            arsort($cities);
            $answered = null;
            foreach ($ranked as $r) {
                if (DailyBoard::hasAnswer($r)) {
                    $answered = $r;
                    break;
                }
            }
            $out[] = [
                'country'  => ($ranked[0]['country'] ?? null) ?: null,
                'rows'     => $ranked,
                'best'     => $ranked[0],
                'answered' => $answered ?? $ranked[0],
                'cities'   => array_map(static fn($n, $c) => ['name' => (string) $n, 'count' => $c], array_keys($cities), $cities),
            ];
        }
        usort($out, static fn(array $a, array $b) =>
            [count($b['rows']), (int) $b['best']['vote_count'], $a['cities'][0]['name']]
            <=> [count($a['rows']), (int) $a['best']['vote_count'], $b['cities'][0]['name']]);
        return $out;
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    /**
     * GET /daily/web/challenges: every closed challenge, newest first, {date,
     * slug, text, question, theme, photo (the top photo's thumb), photos,
     * cities, countries}, and the cities that played one {name, country,
     * photos, lastDate}, most photos first.
     */
    public static function challenges(string $locale): array
    {
        $today = DailyClock::currentDate();
        return Cache::remember("daily_web_list_v1_{$today}_{$locale}", self::CACHE_TTL, static function () use ($today, $locale): array {
            $pdo  = Database::pdo();
            $stmt = $pdo->prepare("
                SELECT dc.*, s.photos, s.cities, s.countries, top.photo_url AS top_photo
                FROM daily_challenges dc
                LEFT JOIN LATERAL (
                    SELECT count(*) AS photos, count(DISTINCT p.city_id) AS cities, count(DISTINCT cc.country) AS countries
                    FROM daily_proofs p
                    JOIN users u        ON u.id = p.user_id
                    LEFT JOIN cities cc ON cc.channel_id = p.city_id
                    WHERE p.challenge_id = dc.id AND " . self::REAL . "
                ) s ON true
                LEFT JOIN LATERAL (
                    SELECT p.photo_url
                    FROM daily_proofs p
                    JOIN users u ON u.id = p.user_id
                    WHERE p.challenge_id = dc.id AND " . self::REAL . "
                    ORDER BY p.vote_count DESC, p.created_at ASC, p.id
                    LIMIT 1
                ) top ON true
                WHERE dc.status = 'published' AND dc.challenge_date < ?
                ORDER BY dc.challenge_date DESC
                LIMIT 1000
            ");
            $stmt->execute([$today]);
            $items = array_map(static fn(array $r) => self::item($r, $locale) + [
                'photo'     => R2Uploader::thumbProxy($r['top_photo']),
                'photos'    => (int) $r['photos'],
                'cities'    => (int) $r['cities'],
                'countries' => (int) $r['countries'],
            ], $stmt->fetchAll(PDO::FETCH_ASSOC));

            $stmt = $pdo->prepare("
                SELECT ch.name, cc.country, count(*) AS photos, max(dc.challenge_date) AS last_date
                FROM daily_proofs p
                JOIN daily_challenges dc ON dc.id = p.challenge_id AND dc.status = 'published' AND dc.challenge_date < ?
                JOIN channels ch         ON ch.id = p.city_id
                JOIN users u             ON u.id = p.user_id
                LEFT JOIN cities cc      ON cc.channel_id = p.city_id
                WHERE " . self::REAL . "
                GROUP BY ch.name, cc.country
                ORDER BY count(*) DESC, ch.name
            ");
            $stmt->execute([$today]);
            $cities = array_map(static fn(array $r) => [
                'name'     => $r['name'],
                'country'  => $r['country'] !== null ? trim((string) $r['country']) : null,
                'photos'   => (int) $r['photos'],
                'lastDate' => (string) $r['last_date'],
            ], $stmt->fetchAll(PDO::FETCH_ASSOC));

            return ['items' => $items, 'cities' => $cities];
        }) ?? ['items' => [], 'cities' => []];
    }

    /**
     * GET /daily/web/challenges/{date}: a closed challenge's page, or null:
     * {challenge (+slug), countries: [{country, cities, photos, answer, photo:
     * {url, thumbUrl, username, city}}], totals {photos, cities, countries},
     * prev, next ({date, slug, text} or null)}.
     */
    public static function challenge(string $date, string $locale): ?array
    {
        $today = DailyClock::currentDate();
        if (!DailyClock::isValidDate($date) || $date >= $today) {
            return null;
        }
        $row = DailyChallengeRepository::findPublishedByDate($date);
        if ($row === null) {
            return null;
        }
        return Cache::remember("daily_web_page_v1_{$date}_{$locale}", self::CACHE_TTL, static function () use ($row, $date, $today, $locale): array {
            $pdo  = Database::pdo();
            $stmt = $pdo->prepare("
                SELECT p.id, p.city_id, ch.name AS city_name, cc.country, p.vote_count, p.approved_at, p.created_at,
                       p.answer_text, p.answer_number, p.answer_minutes, p.photo_url, u.username
                FROM daily_proofs p
                JOIN channels ch    ON ch.id = p.city_id
                JOIN users u        ON u.id = p.user_id
                LEFT JOIN cities cc ON cc.channel_id = p.city_id
                WHERE p.challenge_id = ? AND " . self::REAL . "
            ");
            $stmt->execute([$row['id']]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            $countries = array_map(static fn(array $g) => [
                'country' => $g['country'] !== null ? trim($g['country']) : null,
                'cities'  => $g['cities'],
                'photos'  => count($g['rows']),
                'answer'  => self::answerText($g['answered'], $row, $locale),
                'photo'   => self::photo($g['best']),
            ], self::byCountry($rows));

            // The challenges around it (closed ones), for previous / next links.
            $near = static function (string $op, string $dir) use ($pdo, $date, $today, $locale): ?array {
                $stmt = $pdo->prepare("SELECT * FROM daily_challenges WHERE status = 'published' AND challenge_date {$op} ? AND challenge_date < ?
                                       ORDER BY challenge_date {$dir} LIMIT 1");
                $stmt->execute([$date, $today]);
                $r = $stmt->fetch(PDO::FETCH_ASSOC);
                return $r ? self::item($r, $locale) : null;
            };

            return [
                'challenge' => self::item($row, $locale) + ['context' => DailyChallengeRepository::formatChallenge($row, null, $locale)['context']],
                'countries' => $countries,
                'totals'    => [
                    'photos'    => count($rows),
                    'cities'    => count(array_unique(array_column($rows, 'city_id'))),
                    'countries' => count($countries),
                ],
                'prev' => $near('<', 'DESC'),
                'next' => $near('>', 'ASC'),
            ];
        });
    }

    /**
     * GET /daily/web/cities/{id}: a city's photos of the last challenges it
     * played (closed ones, newest first): [{date, slug, text, question, photos,
     * answer, photo}] and its photo count.
     */
    public static function city(string $cityId, string $locale): array
    {
        $today = DailyClock::currentDate();
        return Cache::remember("daily_web_city_v1_{$cityId}_{$today}_{$locale}", self::CACHE_TTL, static function () use ($cityId, $today, $locale): array {
            $pdo  = Database::pdo();
            $stmt = $pdo->prepare("
                SELECT p.id, p.challenge_id, p.city_id, ch.name AS city_name, cc.country, p.vote_count, p.approved_at, p.created_at,
                       p.answer_text, p.answer_number, p.answer_minutes, p.photo_url, u.username
                FROM daily_proofs p
                JOIN daily_challenges dc ON dc.id = p.challenge_id AND dc.status = 'published' AND dc.challenge_date < ?
                JOIN channels ch         ON ch.id = p.city_id
                JOIN users u             ON u.id = p.user_id
                LEFT JOIN cities cc      ON cc.channel_id = p.city_id
                WHERE p.city_id = ? AND " . self::REAL . "
            ");
            $stmt->execute([$today, $cityId]);
            $byChallenge = [];
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $byChallenge[$r['challenge_id']][] = $r;
            }
            if ($byChallenge === []) {
                return ['recent' => [], 'photos' => 0];
            }

            $stmt = $pdo->prepare("SELECT * FROM daily_challenges WHERE id = ANY (string_to_array(?, ',')) ORDER BY challenge_date DESC LIMIT " . self::CITY_RECENT);
            $stmt->execute([implode(',', array_keys($byChallenge))]);
            $recent = [];
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $c) {
                $group = self::byCountry($byChallenge[$c['id']])[0];
                $recent[] = self::item($c, $locale) + [
                    'photos' => count($byChallenge[$c['id']]),
                    'answer' => self::answerText($group['answered'], $c, $locale),
                    'photo'  => self::photo($group['best']),
                ];
            }
            return ['recent' => $recent, 'photos' => array_sum(array_map('count', $byChallenge))];
        }) ?? ['recent' => [], 'photos' => 0];
    }

    // ── Formatting ───────────────────────────────────────────────────────────

    /** A challenge row's web fields: {date, slug (English), text, question, theme, special}. */
    private static function item(array $row, string $locale): array
    {
        $c  = DailyChallengeRepository::formatChallenge($row, null, $locale);
        $en = DailyChallengeRepository::formatChallenge($row, null, 'en');
        return [
            'date'     => $c['date'],
            'slug'     => self::slug($en['compare']['question'] ?? null, $en['text']),
            'text'     => $c['text'],
            'question' => $c['compare']['question'] ?? null,
            'theme'    => DailyThemes::effective($row['theme'] ?? null, $c['date']),
            'special'  => $c['special']['name'] ?? null,
        ];
    }

    /** A photo's public fields: its image, username and city. */
    private static function photo(array $r): array
    {
        return [
            'url'      => $r['photo_url'],
            'thumbUrl' => R2Uploader::thumbProxy($r['photo_url']),
            'username' => $r['username'],
            'city'     => $r['city_name'],
        ];
    }

    /** A proof's answer as one line ("Prost!", "12 km", "18:30"), or null. */
    private static function answerText(array $r, array $challenge, string $locale): ?string
    {
        $a = DailyCompare::answerPayload($challenge['compare_type'] ?? null, $r['answer_text'] ?? null, $r['answer_number'] ?? null,
                                         $r['answer_minutes'] ?? null, $challenge['compare_unit_i18n'] ?? null, $locale);
        return $a === null ? null : trim($a['value'] . ($a['unit'] ? ' ' . $a['unit'] : ''));
    }
}
