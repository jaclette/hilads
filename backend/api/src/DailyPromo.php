<?php

declare(strict_types=1);

/**
 * Daily promo (SPEC 10.13): the video, carousel and captions made every
 * morning from yesterday's world tour by tools/promo (rendered on a Mac, not
 * here). This class gives the generator its data and keeps what it uploads.
 *
 * Photo rights: a photo is used only when its author allows it.
 * - The terms' promo clause covers photos posted from TERMS_SINCE.
 * - Earlier photos need an explicit yes (the one-time ask, or the setting
 *   turned on): users.promo_consent = 'yes'.
 * - promo_consent = 'no' (the setting turned off) leaves every photo out.
 * - The back office can leave one photo out (daily_proofs.promo_excluded).
 * The author is always credited (@username).
 *
 * Order: one city per country first (the tour's order: podium cities, then
 * most photos), then the second cities of each country, so the first seconds
 * show as many countries as possible. Each city shows its best allowed photo.
 */
final class DailyPromo
{
    /** When the terms' promo clause went live: photos posted from then are covered. */
    public const TERMS_SINCE = '2026-10-30T00:00:00+00:00';

    /** Asset kinds the generator uploads: files (url) and captions (content). */
    public const KINDS = ['video_en', 'video_fr', 'carousel_en', 'carousel_fr', 'caption_en', 'caption_fr'];

    private const LOCALES = ['en', 'fr'];

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /** May this photo be used? $consent: the author's users.promo_consent ('yes'|'no'|null). Pure. */
    public static function allowed(?string $consent, string $createdAt, bool $excluded): bool
    {
        if ($excluded || $consent === 'no') {
            return false;
        }
        return $consent === 'yes' || new DateTimeImmutable($createdAt) >= new DateTimeImmutable(self::TERMS_SINCE);
    }

    /** Why a photo is left out ('excluded'|'opted_out'|'before_terms'), or null when it is used. Pure. */
    public static function reason(?string $consent, string $createdAt, bool $excluded): ?string
    {
        return match (true) {
            $excluded           => 'excluded',
            $consent === 'no'   => 'opted_out',
            !self::allowed($consent, $createdAt, false) => 'before_terms',
            default             => null,
        };
    }

    /** Cities ([{country, ...}], in tour order): one per country first, then the next ones, round by round. Pure. */
    public static function byCountry(array $cities): array
    {
        $rounds = [];
        $seen   = [];
        foreach ($cities as $c) {
            $country = (string) ($c['country'] ?? '');
            $round   = $country === '' ? 0 : ($seen[$country] ?? 0);
            $seen[$country] = $round + 1;
            $rounds[$round][] = $c;
        }
        ksort($rounds);
        return array_merge([], ...array_values($rounds));
    }

    /** Should this user get the one-time ask? A yes or no never asks again, nor does an earlier ask. Pure. */
    public static function shouldAsk(?string $consent, ?string $askedAt, bool $hasEarlierPhotos): bool
    {
        return $consent === null && $askedAt === null && $hasEarlierPhotos;
    }

    // ── Data for the generator ────────────────────────────────────────────────

    /**
     * GET /internal/promo/{date}: the promo of $date (the day it is posted):
     * yesterday's tour ({date, theme, question, text}), today's challenge, and
     * the cities, best allowed photo each, in promo order. Null when $date or
     * yesterday has no published challenge.
     */
    public static function data(string $date): ?array
    {
        $tourDate  = (new DateTimeImmutable($date))->modify('-1 day')->format('Y-m-d');
        $yesterday = DailyChallengeRepository::findPublishedByDate($tourDate);
        $today     = DailyChallengeRepository::findPublishedByDate($date);
        if ($yesterday === null || $today === null) {
            return null;
        }
        $candidates = self::candidates($yesterday);
        $cities = [];
        foreach ($candidates as $cityId => $list) {
            foreach ($list as $c) {
                if ($c['reason'] === null) {
                    $cities[] = $c['city'] + ['podium' => $c['podium']];
                    break;
                }
            }
        }
        return [
            'date'      => $date,
            'yesterday' => self::challengePayload($yesterday),
            'today'     => self::challengePayload($today),
            'cities'    => self::byCountry($cities),
        ];
    }

    /**
     * Every photo of a challenge's tour, grouped by city id in tour order,
     * each city's best first: [{proofId, photoUrl, thumbUrl, username, reason,
     * podium, city: {...the generator's city}}]. For the generator and the
     * back office (which shows why a photo is left out).
     */
    public static function candidates(array $challenge): array
    {
        $slides = DailyTour::order(DailyTour::stored($challenge), null);
        $rows   = DailyProofRepository::rowsByIds(array_column($slides, 'proofId'));
        $users  = self::consents(array_values(array_unique(array_column($rows, 'user_id'))));
        $out    = [];
        foreach ($slides as $s) {
            $row  = $rows[$s['proofId']] ?? null;
            $user = $row !== null ? ($users[$row['user_id']] ?? null) : null;
            if ($row === null || $user === null || $row['moderation_status'] !== 'approved') {
                continue;   // gone, a deleted account or no longer approved
            }
            $excluded = DailyProofRepository::bool($row['promo_excluded'] ?? false);
            $out[$s['cityId']][] = [
                'proofId'  => $row['id'],
                'photoUrl' => $row['photo_url'],
                'thumbUrl' => R2Uploader::thumbProxy($row['photo_url']),
                'username' => $row['username'] ?: $row['display_name'],
                'excluded' => $excluded,
                'reason'   => self::reason($user['promo_consent'], (string) $row['created_at'], $excluded),
                'podium'   => $s['podium'],
                'city'     => self::cityPayload($row),
            ];
        }
        return $out;
    }

    /** user id => {promo_consent} for live accounts (a deleted account is left out). */
    private static function consents(array $userIds): array
    {
        if ($userIds === []) {
            return [];
        }
        $stmt = Database::pdo()->prepare("
            SELECT id, promo_consent FROM users WHERE id = ANY (string_to_array(?, ',')) AND deleted_at IS NULL
        ");
        $stmt->execute([implode(',', $userIds)]);
        return array_column($stmt->fetchAll(PDO::FETCH_ASSOC), null, 'id');
    }

    /** A city slide for the generator: names, flag, the photo, its author and its answer in English and French. */
    private static function cityPayload(array $row): array
    {
        $name = (string) ($row['city_name'] ?? '');
        $out  = [
            'proofId'  => $row['id'],
            'name'     => [],
            'country'  => $row['city_country'] !== null ? strtolower(trim((string) $row['city_country'])) : null,
            'photoUrl' => $row['photo_url'],
            'username' => $row['username'] ?: $row['display_name'],
            'answer'   => [],
            'price'    => $row['price_amount'] !== null
                ? ['amount' => (float) $row['price_amount'], 'currency' => trim((string) $row['price_currency'])]
                : null,
            'caption'  => $row['caption'] !== null && trim((string) $row['caption']) !== '' ? (string) $row['caption'] : null,
        ];
        foreach (self::LOCALES as $l) {
            $out['name'][$l] = CityNames::short($name, $l);
            $a = DailyCompare::answerPayload($row['compare_type'] ?? null, $row['answer_text'] ?? null, $row['answer_number'] ?? null,
                                             $row['answer_minutes'] ?? null, $row['compare_unit_i18n'] ?? null, $l);
            $out['answer'][$l] = $a === null ? null : trim($a['value'] . ($a['unit'] !== null ? ' ' . $a['unit'] : ''));
        }
        return $out;
    }

    /** {date, theme, special, question {en, fr}, text {en, fr}}: the question when it has one, else the challenge text. */
    private static function challengePayload(array $row): array
    {
        $date = (string) $row['challenge_date'];
        $key  = DailyThemes::effective($row['theme'] ?? null, $date);
        $text = json_decode((string) $row['text_i18n'], true) ?: [];
        $out  = ['date' => $date, 'theme' => $key, 'themeName' => [], 'question' => [], 'text' => []];
        foreach (self::LOCALES as $l) {
            $out['text'][$l]     = DailyI18n::pick($text, $l) ?? (string) ($text['en'] ?? '');
            $out['question'][$l] = DailyCompare::payload($row, $l)['question'] ?? $out['text'][$l];
            $special = $key === DailyThemes::SPECIAL ? DailySpecials::payload($row['special_id'] ?? null, $l) : null;
            $out['themeName'][$l] = $special['name'] ?? ($key !== null ? self::themeName($key, $l) : null);
        }
        return $out;
    }

    /** A theme's name in English or French (the apps' labels). */
    private static function themeName(string $key, string $locale): string
    {
        $fr = ['hidden_gem' => 'Pépite', 'taste' => 'Saveur', 'get_around' => 'En route', 'local_find' => 'Trouvaille',
               'night_out' => 'Soirée', 'sip' => 'Boissons', 'only_here' => 'Seulement ici'];
        return $locale === 'fr' && isset($fr[$key]) ? $fr[$key] : DailyThemes::name($key);
    }

    // ── Assets ─────────────────────────────────────────────────────────────────

    /** A presigned upload for one generated file: {key, putUrl, url}. The name gets a random part (public bucket). */
    public static function uploadUrl(string $date, string $name, string $contentType): array
    {
        $safe = preg_replace('/[^a-z0-9._-]+/', '-', strtolower($name));
        $key  = 'promo/' . $date . '/' . bin2hex(random_bytes(6)) . '-' . $safe;
        return ['key' => $key, 'putUrl' => R2Uploader::presignPut($key, $contentType), 'url' => R2Uploader::publicUrl($key)];
    }

    /** Save a render's assets ([{kind, url?, content?}]), replacing the date's earlier ones of the same kind. */
    public static function saveAssets(string $date, array $assets): int
    {
        $stmt = Database::pdo()->prepare("
            INSERT INTO daily_promo_assets (promo_date, kind, url, content, rendered_at) VALUES (?, ?, ?, ?, now())
            ON CONFLICT (promo_date, kind) DO UPDATE SET url = EXCLUDED.url, content = EXCLUDED.content, rendered_at = now()
        ");
        $n = 0;
        foreach ($assets as $a) {
            $kind = (string) ($a['kind'] ?? '');
            if (!in_array($kind, self::KINDS, true)) {
                throw new InvalidArgumentException('Unknown asset kind: ' . $kind);
            }
            $url = isset($a['url']) ? (string) $a['url'] : null;
            if ($url !== null && !str_starts_with($url, rtrim((string) getenv('R2_PUBLIC_URL'), '/') . '/promo/' . $date . '/')) {
                throw new InvalidArgumentException('Not a promo upload of ' . $date . ': ' . $url);
            }
            $stmt->execute([$date, $kind, $url, isset($a['content']) ? (string) $a['content'] : null]);
            $n++;
        }
        return $n;
    }

    /** kind => {url, content, rendered_at} of a date. */
    public static function assets(string $date): array
    {
        $stmt = Database::pdo()->prepare("SELECT kind, url, content, rendered_at FROM daily_promo_assets WHERE promo_date = ?");
        $stmt->execute([$date]);
        return array_column($stmt->fetchAll(PDO::FETCH_ASSOC), null, 'kind');
    }

    /** Leave one photo out of the promo, or put it back. */
    public static function setExcluded(string $proofId, bool $excluded): void
    {
        $stmt = Database::pdo()->prepare("UPDATE daily_proofs SET promo_excluded = ? WHERE id = ?");
        $stmt->execute([$excluded ? 'true' : 'false', $proofId]);
        if ($stmt->rowCount() === 0) {
            throw new InvalidArgumentException('Unknown photo.');
        }
    }

    // ── The author's consent ──────────────────────────────────────────────────

    /** Does this user get the one-time ask (an approved Daily photo posted before the clause, never asked)? */
    public static function asks(array $user): bool
    {
        if (!array_key_exists('promo_asked_at', $user)) {
            return false;   // before the migration
        }
        if (($user['promo_consent'] ?? null) !== null || $user['promo_asked_at'] !== null) {
            return false;   // no query for the answered
        }
        $stmt = Database::pdo()->prepare("
            SELECT EXISTS (SELECT 1 FROM daily_proofs
                           WHERE user_id = ? AND moderation_status = 'approved' AND NOT is_seed AND NOT is_demo AND NOT is_suggestion
                             AND created_at < ?)
        ");
        $stmt->execute([$user['id'], self::TERMS_SINCE]);
        return self::shouldAsk(null, null, (bool) $stmt->fetchColumn());
    }

    /** POST /me/promo: 'yes' / 'no' (the ask or the setting), 'later' (the ask dismissed: asked, nothing decided). */
    public static function answer(string $userId, string $answer): void
    {
        if ($answer === 'later') {
            Database::pdo()->prepare("UPDATE users SET promo_asked_at = coalesce(promo_asked_at, now()) WHERE id = ?")->execute([$userId]);
            return;
        }
        if ($answer !== 'yes' && $answer !== 'no') {
            throw new InvalidArgumentException('answer must be yes, no or later');
        }
        Database::pdo()->prepare("UPDATE users SET promo_consent = ?, promo_asked_at = coalesce(promo_asked_at, now()) WHERE id = ?")
            ->execute([$answer, $userId]);
    }
}
