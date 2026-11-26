<?php

declare(strict_types=1);

/**
 * Launch Season: a time-limited campaign on top of the game (Admin › Launch Season).
 *
 * A SEPARATE LAYER that READS the game and writes only the contest_* tables: never the
 * permanent score (it only reads score_events), never users.score_*, never a push or a
 * notification (ContestIsolationTest checks this file for it). Playing is the game's own,
 * unchanged: a participant's points count for the campaign automatically.
 *
 * Scoring (since 2026-11-26, the owner's option B: one number everywhere): the campaign adds up
 * the REGULAR Hilads points (config/scoring.php season_kinds: play, podium, perfect week, friends,
 * crew bonus) earned on challenges dated inside the campaign, from the challenge day the player
 * joined. The regular invite rule applies as it is (the friend's first approved photo).
 * - Before the final week: points on challenges dated start_date … final_week_start - 1.
 * - At the final week the top headstart_top_n are frozen (N points for #1 … 1 for #N).
 *   Final = points on final-week challenges + head-start.
 * - Ties: most likes received on the phase's photos, then the first to reach the score.
 * - Only players with points are ranked ("Play to enter the race", never "#1" with 0).
 * - The prize goal: prize_threshold_players participants with prize_threshold_photos approved
 *   photos each; not reached = the fallback prize (Admin › Launch Season › Prize).
 * - Everything is computed on read (cached CACHE_TTL s); only the head-start is stored.
 * - Invalidating a photo for the campaign removes its points and its likes here (the game keeps them).
 * - Test seasons (is_test): only contest_testers see and join them; testers never join a
 *   real season; a dev build (X-App-Build: dev) joins only a test season.
 */
final class Contest
{
    public const CACHE_TTL = 30;

    /** An ended campaign keeps its tab (the winner screen) this many days after its end date, then it goes. */
    public const ENDED_VISIBLE_DAYS = 7;

    /** The campaign's tab in the apps (Admin › Launch Season › Prize): an Ionicons name and a label per language. */
    public const DEFAULT_TAB = ['icon' => 'airplane', 'label' => [
        'en' => 'Trip', 'fr' => 'Voyage', 'vi' => 'Chuyến đi', 'es' => 'Viaje', 'it' => 'Viaggio', 'pt-br' => 'Viagem', 'pt-pt' => 'Viagem',
        'de' => 'Reise', 'nl' => 'Reis', 'zh-hans' => '旅行', 'zh-hant' => '旅行', 'ja' => '旅行', 'ko' => '여행', 'fil' => 'Biyahe',
        'th' => 'ทริป', 'id' => 'Trip', 'hi' => 'ट्रिप', 'ru' => 'Поездка', 'ar' => 'الرحلة',
    ]];

    /**
     * What the winner wins if the players' goal isn't reached (Admin › Launch Season › Prize), a noun phrase
     * ("the winner still wins {prize}"). PLACEHOLDER until the owner sets the real one: the admin flags it.
     */
    public const DEFAULT_FALLBACK = [
        'en' => 'a prize to be announced', 'fr' => 'un lot annoncé prochainement', 'vi' => 'một giải thưởng sẽ được công bố',
        'es' => 'un premio por anunciar', 'it' => 'un premio che sarà annunciato', 'pt-br' => 'um prêmio a ser anunciado',
        'pt-pt' => 'um prémio a anunciar', 'de' => 'ein Preis, der noch bekannt gegeben wird', 'nl' => 'een prijs die nog bekend wordt gemaakt',
        'zh-hans' => '一份即将公布的奖品', 'zh-hant' => '一份即將公布的獎品', 'ja' => '後日発表の賞品', 'ko' => '추후 공개될 상품',
        'fil' => 'isang premyong iaanunsyo pa', 'th' => 'ของรางวัลที่จะประกาศภายหลัง', 'id' => 'hadiah yang akan diumumkan',
        'hi' => 'एक इनाम जिसकी घोषणा जल्द होगी', 'ru' => 'приз, который объявим позже', 'ar' => 'جائزة سيُعلن عنها لاحقًا',
    ];

    /** The Trip header's button to the prize details (Admin › Launch Season › Prize: tab.prize_cta per language). */
    public const DEFAULT_PRIZE_CTA = [
        'en' => 'See the prize 🎁', 'fr' => 'Voir le lot 🎁', 'vi' => 'Xem giải thưởng 🎁', 'es' => 'Ver el premio 🎁', 'it' => 'Vedi il premio 🎁',
        'pt-br' => 'Ver o prêmio 🎁', 'pt-pt' => 'Ver o prémio 🎁', 'de' => 'Zum Preis 🎁', 'nl' => 'Bekijk de prijs 🎁', 'zh-hans' => '查看奖品 🎁',
        'zh-hant' => '查看獎品 🎁', 'ja' => '賞品を見る 🎁', 'ko' => '상품 보기 🎁', 'fil' => 'Tingnan ang premyo 🎁', 'th' => 'ดูของรางวัล 🎁',
        'id' => 'Lihat hadiahnya 🎁', 'hi' => 'इनाम देखें 🎁', 'ru' => 'Смотреть приз 🎁', 'ar' => 'شاهد الجائزة 🎁',
    ];

    /** The Ionicons a campaign tab may use (Admin). */
    public const TAB_ICONS = ['airplane', 'trophy', 'gift', 'star', 'flag', 'rocket', 'sparkles', 'globe', 'ribbon', 'medal'];
    public const SETTINGS = ['vote_cap_per_photo', 'referral_points', 'referral_min_photos', 'referral_cap',
                             'headstart_top_n', 'prize_threshold_players', 'prize_threshold_photos', 'seats_show_from'];

    /** The locales the prize text can be written in (the apps' 19). */
    public const LOCALES = ['en', 'fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant', 'ja', 'ko', 'fil', 'th', 'id', 'hi', 'ru', 'ar'];

    /**
     * The launch prize, prefilled on a new season and on seasons saved before the prize
     * setting (Admin › Launch Season edits it per season and locale: title + one line).
     */
    public const DEFAULT_PRIZE = [
        'en'      => ['title' => 'Win a week in Vietnam', 'subtitle' => 'Seven days, return flights included.', 'description' => 'Limestone islands in Ha Long Bay, lantern-lit evenings in Hoi An, street food in Saigon: your next photos are waiting.'],
        'fr'      => ['title' => 'Gagne une semaine au Vietnam', 'subtitle' => 'Sept jours, vols aller-retour compris.', 'description' => 'Les îles de calcaire de la baie d\'Ha Long, les soirées aux lanternes de Hoi An, la street food de Saigon : tes prochaines photos t\'attendent.'],
        'vi'      => ['title' => 'Thắng một tuần du lịch Việt Nam', 'subtitle' => 'Bảy ngày, bao gồm vé máy bay khứ hồi.', 'description' => 'Những đảo đá vôi ở vịnh Hạ Long, buổi tối lung linh đèn lồng ở Hội An, ẩm thực đường phố Sài Gòn: những bức ảnh tiếp theo của bạn đang chờ.'],
        'es'      => ['title' => 'Gana una semana en Vietnam', 'subtitle' => 'Siete días, vuelos de ida y vuelta incluidos.', 'description' => 'Las islas de piedra caliza de la bahía de Ha Long, las noches de farolillos en Hoi An, la comida callejera de Saigón: tus próximas fotos te esperan.'],
        'it'      => ['title' => 'Vinci una settimana in Vietnam', 'subtitle' => 'Sette giorni, voli di andata e ritorno inclusi.', 'description' => 'Le isole calcaree della baia di Ha Long, le sere tra le lanterne di Hoi An, lo street food di Saigon: le tue prossime foto ti aspettano.'],
        'pt-br'   => ['title' => 'Ganhe uma semana no Vietnã', 'subtitle' => 'Sete dias, passagens de ida e volta incluídas.', 'description' => 'As ilhas de calcário da baía de Ha Long, as noites de lanternas em Hoi An, a comida de rua de Saigon: suas próximas fotos estão esperando.'],
        'pt-pt'   => ['title' => 'Ganha uma semana no Vietname', 'subtitle' => 'Sete dias, voos de ida e volta incluídos.', 'description' => 'As ilhas de calcário da baía de Ha Long, as noites de lanternas em Hoi An, a comida de rua de Saigão: as tuas próximas fotos estão à espera.'],
        'de'      => ['title' => 'Gewinne eine Woche in Vietnam', 'subtitle' => 'Sieben Tage, Hin- und Rückflug inklusive.', 'description' => 'Kalksteininseln in der Halong-Bucht, Laternenabende in Hoi An, Streetfood in Saigon: Deine nächsten Fotos warten schon.'],
        'nl'      => ['title' => 'Win een week in Vietnam', 'subtitle' => 'Zeven dagen, retourvluchten inbegrepen.', 'description' => 'Kalksteeneilanden in de Ha Long-baai, avonden vol lantaarns in Hoi An, streetfood in Saigon: je volgende foto\'s wachten al.'],
        'zh-hans' => ['title' => '赢取越南一周之旅', 'subtitle' => '七天行程，含往返机票。', 'description' => '下龙湾的石灰岩群岛、会安灯笼点亮的夜晚、西贡的街头美食：你的下一组照片正在等你。'],
        'zh-hant' => ['title' => '贏取越南一週之旅', 'subtitle' => '七天行程，含來回機票。', 'description' => '下龍灣的石灰岩群島、會安燈籠點亮的夜晚、西貢的街頭美食：你的下一組照片正在等你。'],
        'ja'      => ['title' => 'ベトナム1週間の旅をゲット', 'subtitle' => '7日間、往復航空券込み。', 'description' => 'ハロン湾の石灰岩の島々、ランタンが灯るホイアンの夜、サイゴンの屋台グルメ。次の一枚があなたを待っています。'],
        'ko'      => ['title' => '베트남 일주일 여행에 당첨되세요', 'subtitle' => '7일 여행, 왕복 항공권 포함.', 'description' => '하롱베이의 석회암 섬들, 등불이 밝히는 호이안의 밤, 사이공의 길거리 음식: 다음 사진이 당신을 기다려요.'],
        'fil'     => ['title' => 'Manalo ng isang linggo sa Vietnam', 'subtitle' => 'Pitong araw, kasama ang round-trip flights.', 'description' => 'Mga limestone island sa Ha Long Bay, mga gabing puno ng parol sa Hoi An, street food sa Saigon: naghihintay ang mga susunod mong photo.'],
        'th'      => ['title' => 'ลุ้นเที่ยวเวียดนาม 1 สัปดาห์', 'subtitle' => '7 วัน รวมตั๋วเครื่องบินไป-กลับ', 'description' => 'เกาะหินปูนในอ่าวฮาลอง ค่ำคืนแสงโคมในฮอยอัน สตรีทฟู้ดในไซง่อน ภาพถัดไปของคุณรออยู่'],
        'id'      => ['title' => 'Menangkan seminggu di Vietnam', 'subtitle' => 'Tujuh hari, termasuk tiket pesawat pulang-pergi.', 'description' => 'Pulau-pulau batu kapur di Teluk Ha Long, malam berhias lampion di Hoi An, jajanan kaki lima di Saigon: foto-foto berikutnya menantimu.'],
        'hi'      => ['title' => 'वियतनाम में एक हफ़्ता जीतें', 'subtitle' => 'सात दिन, आने-जाने की फ़्लाइट्स शामिल।', 'description' => 'हा लॉन्ग बे के चूना-पत्थर के द्वीप, होई आन की लालटेनों वाली शामें, साइगॉन का स्ट्रीट फ़ूड: आपकी अगली फ़ोटो इंतज़ार कर रही हैं।'],
        'ru'      => ['title' => 'Выиграй неделю во Вьетнаме', 'subtitle' => 'Семь дней, перелёт туда и обратно включён.', 'description' => 'Известняковые острова бухты Халонг, вечера с фонариками в Хойане, уличная еда Сайгона — твои следующие фото уже ждут.'],
        'ar'      => ['title' => 'اربح أسبوعًا في فيتنام', 'subtitle' => 'سبعة أيام، تشمل تذاكر الطيران ذهابًا وإيابًا.', 'description' => 'جزر الحجر الجيري في خليج ها لونغ، وأمسيات الفوانيس في هوي آن، وطعام الشارع في سايغون: صورك القادمة بانتظارك.'],
    ];

    // ── Seasons ─────────────────────────────────────────────────────────────

    public static function season(int $id): ?array
    {
        $stmt = Database::pdo()->prepare("SELECT * FROM contest_seasons WHERE id = ?");
        $stmt->execute([$id]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        return $r ? self::normalizeSeason($r) : null;
    }

    /** @return list<array> newest first */
    public static function seasons(): array
    {
        $rows = Database::pdo()->query("SELECT * FROM contest_seasons ORDER BY id DESC")->fetchAll(PDO::FETCH_ASSOC);
        return array_map([self::class, 'normalizeSeason'], $rows);
    }

    private static function normalizeSeason(array $r): array
    {
        $r['id'] = (int) $r['id'];
        foreach (self::SETTINGS as $k) $r[$k] = (int) ($r[$k] ?? 0);
        // The players' goal (the trip "unlocks" at N players): null = no goal, the prize is unconditional.
        $r['prize_threshold_players'] = ($r['prize_threshold_players'] ?? null) !== null && (int) $r['prize_threshold_players'] > 0
            ? (int) $r['prize_threshold_players'] : null;
        $r['is_test'] = DailyProofRepository::bool($r['is_test']);
        $r['paused']  = DailyProofRepository::bool($r['paused']);
        $prize = json_decode((string) ($r['prize_i18n'] ?? ''), true);
        $r['prize_i18n'] = is_array($prize) && $prize !== [] ? $prize : self::DEFAULT_PRIZE;
        $fb = json_decode((string) ($r['fallback_prize_i18n'] ?? ''), true);
        $r['fallback_prize_i18n'] = is_array($fb) ? array_filter($fb, static fn($v): bool => is_string($v) && trim($v) !== '') : [];
        $tab = json_decode((string) ($r['tab'] ?? ''), true);
        $r['tab'] = is_array($tab) ? $tab : [];
        return $r;
    }

    /**
     * Where a season stands today: draft, upcoming (before its start), season (weeks 1…),
     * final (the final week), over (past its end, results final, not ended yet), ended.
     */
    public static function phase(array $season, ?string $today = null): string
    {
        $today ??= DailyClock::currentDate();
        if ($season['status'] === 'draft') return 'draft';
        if ($season['status'] === 'ended') return 'ended';
        if ($today < $season['start_date']) return 'upcoming';
        if ($today < $season['final_week_start']) return 'season';
        if ($today <= $season['end_date']) return 'final';
        return 'over';
    }

    public static function isTester(int $seasonId, string $userId): bool
    {
        $stmt = Database::pdo()->prepare("SELECT 1 FROM contest_testers WHERE season_id = ? AND user_id = ?");
        $stmt->execute([$seasonId, $userId]);
        return $stmt->fetchColumn() !== false;
    }

    /**
     * The season this user sees: a running test season they test first, else the running
     * real season. A paused season is hidden. Null = none.
     */
    public static function visibleFor(?string $userId): ?array
    {
        $pdo = Database::pdo();
        // Running (not paused), or ended less than ENDED_VISIBLE_DAYS after its end date (the winner screen).
        $live = "((s.status = 'running' AND NOT s.paused) OR (s.status = 'ended' AND s.end_date >= ?::date - " . self::ENDED_VISIBLE_DAYS . "))";
        $today = DailyClock::currentDate();
        if ($userId !== null) {
            $stmt = $pdo->prepare("
                SELECT s.* FROM contest_seasons s JOIN contest_testers t ON t.season_id = s.id AND t.user_id = ?
                WHERE s.is_test AND {$live} ORDER BY (s.status = 'running') DESC, s.id DESC LIMIT 1
            ");
            $stmt->execute([$userId, $today]);
            if ($r = $stmt->fetch(PDO::FETCH_ASSOC)) return self::normalizeSeason($r);
        }
        $stmt = $pdo->prepare("SELECT s.* FROM contest_seasons s WHERE NOT s.is_test AND {$live} ORDER BY (s.status = 'running') DESC, s.id DESC LIMIT 1");
        $stmt->execute([$today]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        return $r ? self::normalizeSeason($r) : null;
    }

    /** A dev build of the app (it sends X-App-Build: dev). */
    public static function isDevBuild(): bool
    {
        return strtolower(trim((string) ($_SERVER['HTTP_X_APP_BUILD'] ?? ''))) === 'dev';
    }

    /**
     * Why this user cannot join this season (null = they can): closed, excluded (review,
     * demo, fake, hidden from rankings, deleted), tester (testers never join a real season),
     * not_tester (a test season), dev_build (a dev build joins only a test season), not_started
     * (the Upcoming phase: nothing is playable for the contest yet, the apps offer "Notify me").
     */
    public static function joinBlock(array $season, string $userId, bool $devBuild): ?string
    {
        if ($season['status'] !== 'running' || $season['paused'] || DailyClock::currentDate() > $season['end_date']) return 'closed';
        $stmt = Database::pdo()->prepare("
            SELECT (deleted_at IS NOT NULL OR is_review OR is_demo OR is_fake OR (hidden_from_rankings AND NOT ?::boolean)) AS excluded,
                   EXISTS (SELECT 1 FROM contest_testers t WHERE t.user_id = users.id) AS tester
            FROM users WHERE id = ?
        ");
        $stmt->execute([$season['is_test'] ? 'true' : 'false', $userId]);
        $u = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$u || DailyProofRepository::bool($u['excluded'])) return 'excluded';
        $notStarted = DailyClock::currentDate() < $season['start_date'] ? 'not_started' : null;
        if ($season['is_test']) {
            return self::isTester($season['id'], $userId) ? $notStarted : 'not_tester';
        }
        if (DailyProofRepository::bool($u['tester'])) return 'tester';
        if ($devBuild) return 'dev_build';
        return $notStarted;
    }

    public static function participant(int $seasonId, string $userId): ?array
    {
        $stmt = Database::pdo()->prepare("SELECT * FROM contest_participants WHERE season_id = ? AND user_id = ?");
        $stmt->execute([$seasonId, $userId]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    /**
     * Join (once): 18+, a country, the rules accepted. Returns 'joined' or 'already';
     * throws InvalidArgumentException with the block reason or invalid_* code.
     */
    public static function join(array $season, string $userId, array $body, bool $devBuild): string
    {
        if (self::participant($season['id'], $userId) !== null) return 'already';
        if (($why = self::joinBlock($season, $userId, $devBuild)) !== null) throw new InvalidArgumentException($why);
        if (($body['ageConfirmed'] ?? null) !== true) throw new InvalidArgumentException('invalid_age');
        if (($body['rulesAccepted'] ?? null) !== true) throw new InvalidArgumentException('invalid_rules');
        $country = strtoupper(trim((string) ($body['country'] ?? '')));
        if (!preg_match('/^[A-Z]{2}$/', $country)) throw new InvalidArgumentException('invalid_country');

        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("SELECT invited_by_user_id FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $ref  = $stmt->fetchColumn() ?: null;
        $ins  = $pdo->prepare("
            INSERT INTO contest_participants (season_id, user_id, age_confirmed, country, rules_accepted_at, rules_version, referred_by, install_id)
            VALUES (?, ?, true, ?, now(), ?, ?, ?)
            ON CONFLICT (season_id, user_id) DO NOTHING
        ");
        $ins->execute([$season['id'], $userId, $country, self::rulesVersion($season['id']), $ref, Invites::installId()]);
        self::forget($season['id']);
        return $ins->rowCount() === 1 ? 'joined' : 'already';
    }

    // ── Standings ───────────────────────────────────────────────────────────

    /** The regular points a campaign adds up, by group (config/scoring.php season_kinds). */
    public const KIND_GROUPS = ['daily_proof' => 'play', 'daily_top1' => 'podium', 'daily_top2' => 'podium', 'daily_top3' => 'podium',
                                'perfect_week' => 'week', 'friend_joined' => 'friends', 'crew_bonus' => 'friends'];

    /** The standings of a season (cached), the head-start frozen first when it is due. */
    public static function standings(array $season): array
    {
        if ($season['headstart_frozen_at'] === null && in_array(self::phase($season), ['final', 'over', 'ended'], true)) {
            self::freezeHeadstart($season);
            $season = self::season($season['id']) ?? $season;
        }
        return Cache::remember(self::cacheKey($season['id']), self::CACHE_TTL, static function () use ($season): array {
            [$participants, $events, $photos, $headstart] = self::load($season);
            return self::compute($season, $participants, $events, $photos, $headstart, DailyClock::currentDate());
        }) ?? [];
    }

    public static function forget(int $seasonId): void
    {
        Cache::forget(self::cacheKey($seasonId));
    }

    private static function cacheKey(int $seasonId): string
    {
        return "contest_standings_v2_{$seasonId}";
    }

    /** SQL shared by the standings and the admin: the accounts that never count. */
    private static function excludedSql(string $alias, bool $test): string
    {
        $x = "{$alias}.is_review OR {$alias}.is_demo OR {$alias}.is_fake";
        return $test ? $x : "{$x} OR {$alias}.hidden_from_rankings";
    }

    /**
     * The raw rows: participants (+ the challenge day they joined), their regular points on the
     * season's challenges (read only), their approved photos with valid likes, the frozen head-start.
     */
    private static function load(array $season): array
    {
        $pdo  = Database::pdo();
        $sid  = $season['id'];
        $test = $season['is_test'];
        $stmt = $pdo->prepare("
            SELECT cp.user_id, cp.joined_at, cp.disqualified, cp.dq_reason, cp.country,
                   u.username, u.display_name, u.profile_thumb_photo_url AS thumb
            FROM contest_participants cp JOIN users u ON u.id = cp.user_id
            WHERE cp.season_id = ? AND u.deleted_at IS NULL AND NOT (" . self::excludedSql('u', $test) . ")
            " . ($test ? '' : "AND NOT EXISTS (SELECT 1 FROM contest_testers t WHERE t.user_id = cp.user_id)") . "
        ");
        $stmt->execute([$sid]);
        $participants = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($participants as &$p) {
            try {
                $p['join_date'] = DailyClock::currentDate(new DateTimeImmutable((string) $p['joined_at']));
            } catch (\Throwable) {
                $p['join_date'] = $season['start_date'];
            }
        }
        unset($p);

        $kinds = array_keys(self::KIND_GROUPS);
        $in    = implode(',', array_fill(0, count($kinds), '?'));
        $stmt  = $pdo->prepare("
            SELECT se.user_id, se.kind, se.points, extract(epoch FROM se.created_at)::bigint AS at, dc.challenge_date::text AS date
            FROM contest_participants cp
            JOIN score_events se     ON se.user_id = cp.user_id
            JOIN daily_challenges dc ON dc.id = se.daily_challenge_id
            WHERE cp.season_id = ? AND se.kind IN ({$in}) AND dc.challenge_date BETWEEN ? AND ?
              AND (se.daily_proof_id IS NULL OR NOT EXISTS (SELECT 1 FROM contest_invalidations ci WHERE ci.season_id = cp.season_id
                   AND ci.kind = 'photo' AND ci.target_id = se.daily_proof_id AND ci.undone_at IS NULL))
        ");
        $stmt->execute(array_merge([$sid], $kinds, [$season['start_date'], $season['end_date']]));
        $events = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $stmt = $pdo->prepare("
            SELECT dp.id, dp.user_id, dc.challenge_date::text AS date,
                   (SELECT count(*) FROM daily_votes v JOIN users vu ON vu.id = v.voter_user_id
                    WHERE v.proof_id = dp.id AND NOT (" . self::excludedSql('vu', false) . ")
                      AND NOT EXISTS (SELECT 1 FROM contest_invalidations ci WHERE ci.season_id = cp.season_id AND ci.kind = 'vote'
                                      AND ci.target_id = v.id::text AND ci.undone_at IS NULL)) AS votes
            FROM contest_participants cp
            JOIN daily_proofs dp     ON dp.user_id = cp.user_id
            JOIN daily_challenges dc ON dc.id = dp.challenge_id
            WHERE cp.season_id = ? AND dc.challenge_date BETWEEN ? AND ?
              AND dp.moderation_status = 'approved' AND NOT dp.is_demo AND NOT dp.is_seed AND NOT dp.is_suggestion
              AND NOT EXISTS (SELECT 1 FROM contest_invalidations ci WHERE ci.season_id = cp.season_id AND ci.kind = 'photo'
                              AND ci.target_id = dp.id AND ci.undone_at IS NULL)
        ");
        $stmt->execute([$sid, $season['start_date'], $season['end_date']]);
        $photos = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $stmt = $pdo->prepare("SELECT user_id, points FROM contest_headstart WHERE season_id = ?");
        $stmt->execute([$sid]);
        $headstart = array_map('intval', $stmt->fetchAll(PDO::FETCH_KEY_PAIR));

        return [$participants, $events, $photos, $headstart];
    }

    /**
     * The standings from raw rows (pure: ContestTest drives it).
     *
     * @param list<array>        $participants user_id, joined_at, join_date (Y-m-d), disqualified (+ display fields)
     * @param list<array>        $events       user_id, kind, points, at (unix), date (the challenge's Y-m-d)
     * @param list<array>        $photos       id, user_id, date (Y-m-d), votes (valid likes)
     * @param array<string,int>  $headstart    user_id => points (frozen)
     * @param string|null        $today        the current challenge date: points of today's challenge and later
     *                                         are left out of the "previous" ranks (the movement arrows)
     * @return array{rows: array<string,array>, season: list<string>, final: list<string>, counter: array, totals: array}
     */
    public static function compute(array $season, array $participants, array $events, array $photos, array $headstart, ?string $today = null): array
    {
        $fws  = (string) $season['final_week_start'];
        $zero = ['play' => 0, 'podium' => 0, 'week' => 0, 'friends' => 0];
        $rows = [];
        foreach ($participants as $p) {
            $id = (string) $p['user_id'];
            $rows[$id] = [
                'userId' => $id, 'username' => $p['username'] ?? null, 'displayName' => $p['display_name'] ?? null,
                'thumb' => $p['thumb'] ?? null, 'country' => $p['country'] ?? null,
                'joinedAt' => (string) $p['joined_at'], 'joinDate' => (string) ($p['join_date'] ?? $season['start_date']),
                'disqualified' => DailyProofRepository::bool($p['disqualified'] ?? false), 'dqReason' => $p['dq_reason'] ?? null,
                'photos' => 0, 'dates' => [], 'seasonLikes' => 0, 'finalLikes' => 0, 'allLikes' => 0,
                'seasonBy' => $zero, 'finalBy' => $zero, 'seasonPoints' => 0, 'finalPoints' => 0,
                'prevSeasonPoints' => 0, 'prevFinalPoints' => 0, 'seasonReached' => 0, 'finalReached' => 0,
                'headstart' => (int) ($headstart[$id] ?? 0),
            ];
        }
        foreach ($photos as $ph) {
            $id = (string) $ph['user_id'];
            if (!isset($rows[$id]) || (string) $ph['date'] < $rows[$id]['joinDate']) continue;
            $likes = (int) $ph['votes'];
            $rows[$id][(string) $ph['date'] < $fws ? 'seasonLikes' : 'finalLikes'] += $likes;
            $rows[$id]['allLikes'] += $likes;
            $rows[$id]['photos']++;
            $rows[$id]['dates'][(string) $ph['date']] = true;
        }
        foreach ($events as $e) {
            $id = (string) $e['user_id'];
            $group = self::KIND_GROUPS[(string) $e['kind']] ?? null;
            if ($group === null || !isset($rows[$id]) || (string) $e['date'] < $rows[$id]['joinDate']) continue;
            $part = (string) $e['date'] < $fws ? 'season' : 'final';
            $pts  = (int) $e['points'];
            $rows[$id][$part . 'By'][$group] += $pts;
            $rows[$id][$part . 'Points'] += $pts;
            $rows[$id][$part . 'Reached'] = max($rows[$id][$part . 'Reached'], (int) $e['at']);
            if ($today === null || (string) $e['date'] < $today) $rows[$id]['prev' . ucfirst($part) . 'Points'] += $pts;
        }

        $threshold = (int) $season['prize_threshold_photos'];
        $qualified = 0;
        foreach ($rows as &$r) {
            $r['days'] = count($r['dates']);
            unset($r['dates']);
            $r['finalPoints']     += $r['headstart'];
            $r['prevFinalPoints'] += $r['headstart'];
            if (!$r['disqualified'] && $r['photos'] >= $threshold) $qualified++;
        }
        unset($r);

        // Only players with points are ranked. Ties: most likes on the phase's photos, then the first to the score.
        $order = static function (string $points, string $likes, string $reached) use ($rows): array {
            $ids = array_keys(array_filter($rows, static fn(array $r): bool => !$r['disqualified'] && $r[$points] > 0));
            usort($ids, static function ($x, $y) use ($rows, $points, $likes, $reached): int {
                $a = $rows[$x]; $b = $rows[$y];
                return [$b[$points], $b[$likes], $a[$reached] ?: PHP_INT_MAX, (string) $x] <=> [$a[$points], $a[$likes], $b[$reached] ?: PHP_INT_MAX, (string) $y];
            });
            return array_map('strval', $ids);
        };
        $seasonOrder = $order('seasonPoints', 'seasonLikes', 'seasonReached');
        $finalOrder  = $order('finalPoints', 'finalLikes', 'finalReached');
        $prevSeason  = $order('prevSeasonPoints', 'seasonLikes', 'seasonReached');
        $prevFinal   = $order('prevFinalPoints', 'finalLikes', 'finalReached');
        foreach ($rows as &$r) { $r['seasonRank'] = $r['finalRank'] = $r['prevSeasonRank'] = $r['prevFinalRank'] = null; }
        unset($r);
        foreach ($seasonOrder as $i => $id) $rows[$id]['seasonRank'] = $i + 1;
        foreach ($finalOrder as $i => $id)  $rows[$id]['finalRank']  = $i + 1;
        foreach ($prevSeason as $i => $id)  $rows[$id]['prevSeasonRank'] = $i + 1;
        foreach ($prevFinal as $i => $id)   $rows[$id]['prevFinalRank']  = $i + 1;

        // The players' goal: with one, "on board" = players with their boarding pass (the photos); without
        // one (null), everyone in the race is on board and the prize is unconditional (reached).
        $goal = ($season['prize_threshold_players'] ?? null) !== null && (int) $season['prize_threshold_players'] > 0 ? (int) $season['prize_threshold_players'] : null;
        $inRace = array_filter($rows, static fn(array $r): bool => !$r['disqualified']);
        $onBoard = $goal === null ? count($inRace) : $qualified;
        // The latest players on board (the stacked avatars): photos only, newest first.
        $recent = array_filter($inRace, static fn(array $r): bool => !empty($r['thumb']) && ($goal === null || $r['photos'] >= $threshold));
        usort($recent, static fn(array $a, array $b): int => strcmp($b['joinedAt'], $a['joinedAt']));
        $recent = array_map(static fn(array $r): array => ['userId' => $r['userId'], 'name' => $r['username'] ?? $r['displayName'],
            'photoUrl' => class_exists('R2Uploader') ? R2Uploader::thumbProxy($r['thumb']) : $r['thumb']], array_slice($recent, 0, 5));
        return [
            'rows'    => $rows,
            'season'  => $seasonOrder,
            'final'   => $finalOrder,
            // threshold: 0 when there's no goal (older apps read it as reached).
            'counter' => ['players' => $onBoard, 'threshold' => $goal ?? 0, 'goal' => $goal, 'photos' => $threshold,
                          'reached' => $goal === null || $qualified >= $goal, 'showFrom' => (int) ($season['seats_show_from'] ?? 0),
                          'recent' => $recent],
            'totals'  => ['participants' => count($rows), 'photos' => array_sum(array_column($rows, 'photos'))],
        ];
    }

    /** Head-start of a season rank: N for #1 … 1 for #N (0 outside the top N). */
    public static function headstartPoints(int $rank, int $topN): int
    {
        return $rank >= 1 && $rank <= $topN ? $topN - $rank + 1 : 0;
    }

    /**
     * Freeze the head-start (the season top N with points, at the final week). Lazy and
     * once; $force re-takes it (admin, after an invalidation or a settings change).
     * Returns how many players got one.
     */
    public static function freezeHeadstart(array $season, bool $force = false): int
    {
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $lock = $pdo->prepare("UPDATE contest_seasons SET headstart_frozen_at = now() WHERE id = ?" . ($force ? '' : ' AND headstart_frozen_at IS NULL'));
            $lock->execute([$season['id']]);
            if ($lock->rowCount() !== 1) { $pdo->rollBack(); return 0; }
            $pdo->prepare("DELETE FROM contest_headstart WHERE season_id = ?")->execute([$season['id']]);
            [$participants, $events, $photos] = self::load($season);
            $s   = self::compute($season, $participants, $events, $photos, []);
            $ins = $pdo->prepare("INSERT INTO contest_headstart (season_id, user_id, rank, points) VALUES (?, ?, ?, ?)");
            $n   = 0;
            foreach ($s['season'] as $i => $id) {
                $pts = self::headstartPoints($i + 1, (int) $season['headstart_top_n']);
                if ($pts <= 0 || $s['rows'][$id]['seasonPoints'] <= 0) break;
                $ins->execute([$season['id'], $id, $i + 1, $pts]);
                $n++;
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        self::forget($season['id']);
        return $n;
    }

    // ── API payloads ────────────────────────────────────────────────────────

    /** The prize text in a locale (else English): {title, subtitle}. */
    public static function prize(array $s, ?string $locale): array
    {
        $all = $s['prize_i18n'] ?? self::DEFAULT_PRIZE;
        $p   = ($locale !== null && !empty($all[$locale]['title'])) ? $all[$locale] : ($all['en'] ?? self::DEFAULT_PRIZE['en']);
        return ['title' => (string) ($p['title'] ?? ''), 'subtitle' => (string) ($p['subtitle'] ?? ''), 'description' => (string) ($p['description'] ?? '')];
    }

    /** What the winner wins if the goal isn't reached, in a locale (else English, else the placeholder). */
    public static function fallbackPrize(array $s, ?string $locale): string
    {
        $all = $s['fallback_prize_i18n'] ?? [];
        if ($all === []) return self::DEFAULT_FALLBACK[$locale ?? 'en'] ?? self::DEFAULT_FALLBACK['en'];
        return trim((string) (($locale !== null ? ($all[$locale] ?? '') : '') ?: ($all['en'] ?? self::DEFAULT_FALLBACK['en'])));
    }

    /** The campaign's tab: {label, icon} in a locale (Admin; default "Trip" and a plane). */
    public static function tab(array $s, ?string $locale): array
    {
        $tab    = $s['tab'] ?? [];
        $labels = is_array($tab['label'] ?? null) ? array_filter($tab['label'], static fn($v): bool => is_string($v) && trim($v) !== '') : [];
        $label  = ($locale !== null ? ($labels[$locale] ?? null) : null) ?? ($labels['en'] ?? null)
            ?? (self::DEFAULT_TAB['label'][$locale ?? 'en'] ?? self::DEFAULT_TAB['label']['en']);
        $icon   = in_array($tab['icon'] ?? null, self::TAB_ICONS, true) ? $tab['icon'] : self::DEFAULT_TAB['icon'];
        $ctas   = is_array($tab['prize_cta'] ?? null) ? array_filter($tab['prize_cta'], static fn($v): bool => is_string($v) && trim($v) !== '') : [];
        $cta    = ($locale !== null ? ($ctas[$locale] ?? null) : null) ?? ($ctas['en'] ?? null)
            ?? (self::DEFAULT_PRIZE_CTA[$locale ?? 'en'] ?? self::DEFAULT_PRIZE_CTA['en']);
        return ['label' => trim((string) $label), 'icon' => $icon, 'prizeCta' => trim((string) $cta)];
    }

    /**
     * The secondary prizes (Admin › Launch Season › Souvenir prizes): ranks 2 to N of the final week
     * each get a souvenir pack. Off by default (parcels to ship worldwide), a season setting; null when
     * off. text = the admin's line in that language (else English), null = the apps' own wording.
     */
    public static function souvenir(array $s, ?string $locale): ?array
    {
        $raw = $s['souvenir'] ?? [];
        if (is_string($raw)) $raw = json_decode($raw, true);
        if (!is_array($raw) || empty($raw['enabled'])) return null;
        $to   = max(2, min(50, (int) ($raw['to'] ?? 10)));
        $i18n = is_array($raw['i18n'] ?? null) ? $raw['i18n'] : [];
        $text = trim((string) (($locale !== null ? ($i18n[$locale] ?? '') : '') ?: ($i18n['en'] ?? '')));
        return ['from' => 2, 'to' => $to, 'text' => $text !== '' ? $text : null];
    }

    /** The regular points the campaign counts (config/scoring.php), for the apps' rules and explainers. */
    public static function pointsTable(): array
    {
        $cfg = Scoring::config();
        $pt  = static fn(string $k): int => (int) ($cfg['points'][$k] ?? 0);
        return ['play' => $pt('daily_proof'), 'podium' => [$pt('daily_top1'), $pt('daily_top2'), $pt('daily_top3')], 'week' => $pt('perfect_week'),
                'friend' => $pt('friend_joined'), 'crew' => $pt('crew_bonus'), 'crewSize' => (int) ($cfg['crew_size'] ?? 5),
                'friendsPerMonth' => (int) ($cfg['invites_per_season'] ?? 5)];
    }

    public static function seasonPayload(array $s, ?string $locale = null): array
    {
        return [
            'prize' => self::prize($s, $locale),
            'fallbackPrize' => self::fallbackPrize($s, $locale),
            'tab' => self::tab($s, $locale),
            'souvenir' => self::souvenir($s, $locale),
            'photos' => class_exists('ContestPhotos') ? ContestPhotos::payload($s) : [],
        ] + (class_exists('ContestTrip') ? ContestTrip::payload($s, $locale) : []) + [
            'id' => $s['id'], 'name' => $s['name'], 'isTest' => $s['is_test'], 'phase' => self::phase($s),
            'startDate' => $s['start_date'], 'endDate' => $s['end_date'], 'finalWeekStart' => $s['final_week_start'],
            // The current challenge date (the timeline's "day 2 of 2").
            'today' => DailyClock::currentDate(),
            // The real moments (the daily drop, ISO UTC) for the countdowns: the season starts at its first
            // challenge's drop, the final week at its first day's, and it ends at the drop after its last day.
            'startsAt' => self::dropIso($s['start_date']), 'finalAt' => self::dropIso($s['final_week_start']),
            'endsAt' => self::dropIso((new DateTimeImmutable($s['end_date'] . ' 12:00:00', new DateTimeZone('UTC')))->modify('+1 day')->format('Y-m-d')),
            'points' => self::pointsTable(),
            'rules' => [
                'headstartTopN' => $s['headstart_top_n'],
                // Older apps (likes + referral scoring) read these; the campaign no longer uses them.
                'voteCap' => $s['vote_cap_per_photo'], 'referralPoints' => $s['referral_points'],
                'referralMinPhotos' => $s['referral_min_photos'], 'referralCap' => $s['referral_cap'],
            ],
            'winner' => self::winner($s),
            'rulesUrl' => 'https://hilads.live/launch-season/rules' . ($s['is_test'] ? '?season=' . $s['id'] : ''),
        ];
    }

    /** The winner, once the admin confirmed them (Winner & export): {username, displayName, photoUrl}, else null. */
    private static function winner(array $s): ?array
    {
        if (empty($s['winner_user_id']) || empty($s['winner_confirmed_at'])) return null;
        $stmt = Database::pdo()->prepare("SELECT username, display_name, profile_thumb_photo_url AS thumb FROM users WHERE id = ? AND deleted_at IS NULL");
        $stmt->execute([$s['winner_user_id']]);
        $u = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$u) return null;
        return ['userId' => (string) $s['winner_user_id'], 'username' => $u['username'], 'displayName' => $u['display_name'],
                'photoUrl' => class_exists('R2Uploader') ? R2Uploader::thumbProxy($u['thumb']) : $u['thumb']];
    }

    private static function dropIso(string $date): ?string
    {
        try {
            return DailyClock::dropAt($date)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
        } catch (\Throwable) {
            return null;
        }
    }

    /** Which ranking a phase shows: the final week's from the final week on, else the one before it. */
    public static function racePart(string $phase): string
    {
        return in_array($phase, ['final', 'over', 'ended'], true) ? 'final' : 'season';
    }

    /** One standings row for the app / web. */
    public static function rowPayload(array $r, string $part): array
    {
        $final = $part === 'final';
        $likes = $final ? $r['finalLikes'] : $r['seasonLikes'];
        return [
            'rank' => $final ? $r['finalRank'] : $r['seasonRank'],
            'prevRank' => $final ? $r['prevFinalRank'] : $r['prevSeasonRank'],
            'userId' => $r['userId'], 'username' => $r['username'], 'displayName' => $r['displayName'],
            'photoUrl' => class_exists('R2Uploader') ? R2Uploader::thumbProxy($r['thumb']) : $r['thumb'],
            'points' => $final ? $r['finalPoints'] : $r['seasonPoints'],
            'by' => $final ? $r['finalBy'] : $r['seasonBy'],
            'likes' => $likes, 'votes' => $likes, 'referral' => 0,
            'headstart' => $final ? $r['headstart'] : 0,
            'days' => $r['days'], 'photos' => $r['photos'],
        ];
    }

    /** GET /contest: the season I see, the counter, and me. */
    public static function overview(?string $userId, ?string $locale = null): array
    {
        $season = self::visibleFor($userId);
        if ($season === null) return ['season' => null];
        $st    = self::standings($season);
        $phase = self::phase($season);
        $part  = self::racePart($phase);
        $me    = null;
        if ($userId !== null) {
            if (isset($st['rows'][$userId])) {
                $r     = $st['rows'][$userId];
                $order = $st[$part] ?? [];
                $rank  = $part === 'final' ? $r['finalRank'] : $r['seasonRank'];
                $pts   = $part === 'final' ? $r['finalPoints'] : $r['seasonPoints'];
                $above = $rank !== null && $rank > 1 ? $st['rows'][$order[$rank - 2]] : null;
                $me = [
                    'joined' => true, 'disqualified' => $r['disqualified'],
                    'seasonRank' => $r['seasonRank'], 'finalRank' => $r['finalRank'],
                    'race' => [
                        'part' => $part, 'rank' => $rank, 'prevRank' => $part === 'final' ? $r['prevFinalRank'] : $r['prevSeasonRank'],
                        'points' => $pts, 'by' => $part === 'final' ? $r['finalBy'] : $r['seasonBy'], 'headstart' => $part === 'final' ? $r['headstart'] : 0,
                        'likes' => $part === 'final' ? $r['finalLikes'] : $r['seasonLikes'],
                        // Points behind the player just above (ties are broken by likes, so 0 is possible).
                        'gap' => $above !== null ? max(0, ($part === 'final' ? $above['finalPoints'] : $above['seasonPoints']) - $pts) : null,
                        'ranked' => count($order),
                    ],
                    // Older apps read this shape.
                    'points' => ['votes' => $r['seasonLikes'], 'finalVotes' => $r['finalLikes'], 'referral' => 0,
                                 'headstart' => $r['headstart'], 'season' => $r['seasonPoints'], 'final' => $r['finalPoints']],
                    'photos' => $r['photos'], 'days' => $r['days'],
                ];
            } elseif (self::participant($season['id'], $userId) !== null) {
                $me = ['joined' => true, 'disqualified' => false, 'excluded' => true];
            } else {
                $block = self::joinBlock($season, $userId, self::isDevBuild());
                $stmt  = Database::pdo()->prepare("SELECT home_country FROM users WHERE id = ?");
                $stmt->execute([$userId]);
                $cc    = $stmt->fetchColumn() ?: (class_exists('Request') ? Request::country() : null);
                $me = ['joined' => false, 'canJoin' => $block === null, 'reason' => $block, 'suggestedCountry' => $cc ? strtoupper((string) $cc) : null,
                       // The Upcoming phase's "Notify me" (ContestNotify): already tapped?
                       'notified' => class_exists('ContestNotify') && ContestNotify::isRegistered($season['id'], $userId)];
            }
        }
        return [
            'season'  => self::seasonPayload($season, $locale),
            'counter' => $st['counter'] ?? null,
            'participants' => $st['totals']['participants'] ?? 0,
            'me'      => $me,
        ];
    }

    /** GET /contest/ranking: the ranking before the final week ('season') or the final week's, top $limit + me. */
    public static function ranking(?string $userId, string $part, int $limit = 100): ?array
    {
        $season = self::visibleFor($userId);
        if ($season === null) return null;
        $st    = self::standings($season);
        $part  = $part === 'final' ? 'final' : 'season';
        $order = $st[$part] ?? [];
        $rows  = [];
        foreach (array_slice($order, 0, $limit) as $id) $rows[] = self::rowPayload($st['rows'][$id], $part);
        $me = $userId !== null && isset($st['rows'][$userId]) && !$st['rows'][$userId]['disqualified']
            ? self::rowPayload($st['rows'][$userId], $part) : null;
        return ['phase' => $part, 'frozen' => $season['headstart_frozen_at'] !== null, 'rows' => $rows, 'me' => $me, 'total' => count($order)];
    }

    // ── Rules ───────────────────────────────────────────────────────────────

    /** The rules version a joiner accepts (the English text's). */
    public static function rulesVersion(int $seasonId): int
    {
        $stmt = Database::pdo()->prepare("SELECT version FROM contest_rules WHERE season_id = ? AND locale = 'en'");
        $stmt->execute([$seasonId]);
        return (int) ($stmt->fetchColumn() ?: 1);
    }

    /**
     * The public rules: the season asked for, else the latest real season (else the latest
     * test one). The locale's text, else English, else the placeholder. {season, locale, body, isFinal, version, updatedAt}.
     */
    public static function rules(?int $seasonId, string $locale): array
    {
        $pdo = Database::pdo();
        $season = $seasonId !== null ? self::season($seasonId) : null;
        if ($season === null) {
            $r = $pdo->query("SELECT * FROM contest_seasons ORDER BY is_test, (status = 'draft'), id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
            $season = $r ? self::normalizeSeason($r) : null;
        }
        if ($season === null) {
            return ['season' => null, 'locale' => 'en', 'body' => self::fillRules(self::placeholderRules(null), null), 'isFinal' => false, 'version' => 0, 'updatedAt' => null];
        }
        $stmt = $pdo->prepare("SELECT locale, body, is_final, version, updated_at FROM contest_rules WHERE season_id = ? AND locale IN (?, 'en')
                               ORDER BY (locale = ?) DESC LIMIT 1");
        $stmt->execute([$season['id'], $locale, $locale]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        return [
            'season'    => ['id' => $season['id'], 'name' => $season['name'], 'startDate' => $season['start_date'], 'endDate' => $season['end_date']],
            'locale'    => $r['locale'] ?? 'en',
            'body'      => self::fillRules($r['body'] ?? self::placeholderRules($season), $season, (string) ($r['locale'] ?? $locale)),
            'isFinal'   => $r ? DailyProofRepository::bool($r['is_final']) : false,
            'version'   => (int) ($r['version'] ?? 0),
            'updatedAt' => $r['updated_at'] ?? null,
        ];
    }

    /**
     * The rules template (markdown, English): what a new season's rules start from (Admin › Rules).
     * {{tokens}} are filled from the season's dates and settings when the page shows it (fillRules),
     * so the text and its translations never go stale when a date or a number changes. The page
     * itself shows the DRAFT banner until the admin ticks Final. [TBD: …] = for the owner / lawyer.
     */
    public const RULES_TOKENS = ['season', 'start', 'final_start', 'end', 'weeks', 'season_weeks', 'play', 'top1', 'top2', 'top3', 'week',
                                 'friend', 'crew', 'crew_size', 'friends_month', 'hs_top', 'hs_top_place', 'players', 'photos', 'fallback', 'souvenir_to'];

    public static function placeholderRules(?array $s = null): string
    {
        return <<<'MD'
# {{season}}: official rules

## 1. Organiser
The {{season}} (the "Contest") is organised by [TBD: organiser's legal name, legal form, registered address and company number] ("Hilads", "we"), the publisher of the Hilads app and website.

## 2. Dates
The Contest runs from {{start}} to {{end}} ({{weeks}} weeks): a first part of {{season_weeks}} weeks, then a final week from {{final_start}} to {{end}}. Days follow the Hilads daily challenge: each day starts at the daily drop.

Before {{start}}, the app may show a preview of the Contest. Points earned before {{start}} don't count for the Contest.

## 3. Who can enter
- Entry is free. No purchase is needed.
- You must be 18 or older when you join.
- One person, one account, one entry. Using several accounts leads to disqualification.
- Residents of [TBD: excluded countries] and of any country where this kind of contest is not allowed cannot enter.
- [TBD: confirm] Hilads employees and their households cannot win.
- To enter, tap "Join" in the app during the Contest, confirm you are 18 or older, choose your country and accept these rules.

## 4. Points
The Contest uses the regular Hilads points, the same ones as in the app's rankings. They count for the Contest from the day you join, on the daily challenges dated during the Contest:
- **Play:** +{{play}} points for each daily challenge you play (one approved photo, once a day).
- **Podium:** +{{top1}}, +{{top2}} or +{{top3}} points when your photo is 1st, 2nd or 3rd of the day worldwide (most likes; a tie goes to the photo posted first).
- **Perfect week:** +{{week}} points when you play every published challenge of a Monday-to-Sunday week. It counts on the Sunday the week ends.
- **Friends:** +{{friend}} points when a friend who signed up with your invite link has their first photo approved, for up to {{friends_month}} friends a calendar month, and +{{crew}} more points for your {{crew_size}}th friend of the month. A friend who already had an account, or who uses the same phone as you, doesn't count.

Points earned before you join, or on challenges dated outside the Contest, don't count. Photos and points removed by moderation are removed from the Contest too.

## 5. Final week and winner
- The final week has its own ranking. Points start from zero on {{final_start}}: only points from the final week's challenges count in it.
- **Head start:** the top {{hs_top}} of the ranking before the final week start it with a bonus: {{hs_top}} points for first place, down to 1 point for {{hs_top_place}} place.
- **Ties:** the player whose photos got the most likes during the final week is ahead; if still tied, the first to reach the score.
- The winner is the player who finishes first in the final-week ranking when the Contest ends on {{end}}, after the checks in section 9. Hilads announces the result in the app within [TBD] days and contacts the winner in the app and by email. If the winner doesn't answer within [TBD] days, or isn't eligible, the next eligible participant in the final-week ranking wins.

## 6. Boarding: the players' goal
The flight has {{players}} seats. A participant takes a seat (gets their boarding pass) once they have posted {{photos}} or more approved photos during the Contest. The trip is unlocked when every seat is taken, that is when at least {{players}} different participants have their boarding pass. The app shows the seats taken at all times.

If the flight isn't full when the Contest ends, the winner of the final week still wins: they receive {{fallback}} instead of the trip.

## 7. Prize
If every seat is taken (section 6), a one-week trip to Vietnam for the winner:
- A round-trip international economy flight from the airport nearest the winner's home, up to USD 2,000. If the flight costs more than USD 2,000, the winner pays the difference or picks cheaper dates.
- Lodging and transport in Vietnam are included.
- Not included: visa, travel insurance, meals and personal expenses.
- The travel dates are agreed between the winner and Hilads, [TBD: within which period].

**Souvenir prizes:** [TBD: keep only if souvenir prizes are on for this Contest] ranks 2 to {{souvenir_to}} of the final-week ranking each receive a Vietnam souvenir pack, shipped to them.

Prizes are personal and non-transferable, and cannot be exchanged for cash. If a prize cannot be delivered, Hilads may replace it with a prize of similar value.

## 8. Your game doesn't change
Joining doesn't change how you play or how your Hilads points are counted: the Contest only reads them. Leaving the Contest or being disqualified never removes your Hilads points.

## 9. Fair play and moderation
Hilads moderates photos and may invalidate photos, likes or referred friends for the Contest, and disqualify an entry, in case of fraud or rule breaking: fake or multiple accounts, bought or exchanged likes, automated activity, photos that aren't yours, or anything against the Hilads community rules. Before awarding a prize, Hilads may ask the winner to prove their identity, age and country.

## 10. Your photos
You keep the rights to your photos. By posting during the Contest, you allow Hilads to show your photos, credited with your username, in the app, on the website and in Hilads communications about the Contest, worldwide, for free, [TBD: for how long]. Only post photos you took yourself; if a person can be recognised, make sure they agree.

## 11. Personal data
Hilads uses your account data, your country, your age confirmation and your Contest activity to run the Contest, check eligibility and deliver the prizes, as described in the [Hilads privacy policy](https://hilads.live/privacy). The winner's details are shared with travel providers only to deliver the prize. [TBD: data controller and contact for your rights].

## 12. Taxes, visas and travel
The winner is responsible for any taxes on the prize and for their passport, visa, vaccinations, insurance and any other travel requirement.

## 13. Changes
Hilads may change, suspend, shorten or cancel the Contest, or replace a prize with one of similar value, in case of force majeure or events beyond its control (for example large-scale fraud, a technical failure or travel restrictions). Any change is published on this page with a new version number.

## 14. Applicable law and contact
[TBD: applicable law and competent courts.] Questions about the Contest: [TBD: contact email].
MD;
    }

    /** The rules text with its {{tokens}} filled from the season (dates in English words, else ISO). */
    public static function fillRules(string $body, ?array $s, string $locale = 'en'): string
    {
        $s ??= ['name' => 'Launch Trip', 'start_date' => null, 'end_date' => null, 'final_week_start' => null,
                'headstart_top_n' => 10, 'prize_threshold_players' => 500, 'prize_threshold_photos' => 10];
        $date = static function (?string $d) use ($locale): string {
            if (!$d) return '…';
            $t = strtotime($d . ' 12:00:00 UTC');
            return $locale === 'en' ? gmdate('j F Y', $t) : gmdate('Y-m-d', $t);
        };
        $days = static fn(?string $a, ?string $b): int => $a && $b ? (int) round((strtotime($b) - strtotime($a)) / 86400) + 1 : 0;
        $weeks = (int) round($days($s['start_date'], $s['end_date']) / 7);
        $sv = $s['souvenir'] ?? [];
        if (is_string($sv)) $sv = json_decode($sv, true);
        $pt = self::pointsTable();
        $vals = [
            'season' => (string) $s['name'], 'start' => $date($s['start_date']), 'final_start' => $date($s['final_week_start']),
            'end' => $date($s['end_date']), 'weeks' => (string) $weeks,
            'season_weeks' => (string) ($s['start_date'] && $s['final_week_start'] ? max(0, (int) round((strtotime($s['final_week_start']) - strtotime($s['start_date'])) / 86400 / 7)) : 0),
            'play' => (string) $pt['play'], 'top1' => (string) $pt['podium'][0], 'top2' => (string) $pt['podium'][1], 'top3' => (string) $pt['podium'][2],
            'week' => (string) $pt['week'], 'friend' => (string) $pt['friend'], 'crew' => (string) $pt['crew'],
            'crew_size' => (string) $pt['crewSize'], 'friends_month' => (string) $pt['friendsPerMonth'],
            'hs_top' => (string) $s['headstart_top_n'],
            'hs_top_place' => class_exists('Ordinal') ? Ordinal::format((int) $s['headstart_top_n'], $locale) : (string) $s['headstart_top_n'],
            'players' => (string) $s['prize_threshold_players'], 'photos' => (string) $s['prize_threshold_photos'],
            'fallback' => self::fallbackPrize($s, $locale),
            'souvenir_to' => (string) max(2, min(50, (int) ((is_array($sv) ? $sv['to'] ?? null : null) ?? 10))),
        ];
        return preg_replace_callback('/\{\{(\w+)\}\}/', static fn(array $m): string => $vals[$m[1]] ?? $m[0], $body) ?? $body;
    }

    // ── Admin ───────────────────────────────────────────────────────────────

    public static function log(?int $seasonId, string $action, ?string $target = null, array $detail = []): void
    {
        Database::pdo()->prepare("INSERT INTO contest_admin_log (season_id, action, target, detail) VALUES (?, ?, ?, ?::jsonb)")
            ->execute([$seasonId, $action, $target, json_encode($detail, JSON_UNESCAPED_UNICODE)]);
    }

    /** Invalidate a photo or a vote for the contest only (the game keeps it). */
    public static function invalidate(int $seasonId, string $kind, string $targetId, string $reason): void
    {
        if (!in_array($kind, ['photo', 'vote'], true)) throw new InvalidArgumentException('kind');
        if (trim($reason) === '') throw new InvalidArgumentException('Give a reason.');
        Database::pdo()->prepare("INSERT INTO contest_invalidations (season_id, kind, target_id, reason) VALUES (?, ?, ?, ?)
                                  ON CONFLICT DO NOTHING")->execute([$seasonId, $kind, $targetId, trim($reason)]);
        self::log($seasonId, "invalidate_{$kind}", $targetId, ['reason' => trim($reason)]);
        self::forget($seasonId);
    }

    public static function undoInvalidation(int $seasonId, int $id): void
    {
        $stmt = Database::pdo()->prepare("UPDATE contest_invalidations SET undone_at = now() WHERE id = ? AND season_id = ? AND undone_at IS NULL
                                          RETURNING kind, target_id");
        $stmt->execute([$id, $seasonId]);
        if ($r = $stmt->fetch(PDO::FETCH_ASSOC)) self::log($seasonId, "undo_invalidate_{$r['kind']}", $r['target_id']);
        self::forget($seasonId);
    }

    public static function disqualify(int $seasonId, string $userId, bool $on, string $reason = ''): void
    {
        if ($on && trim($reason) === '') throw new InvalidArgumentException('Give a reason.');
        Database::pdo()->prepare("UPDATE contest_participants SET disqualified = ?, dq_reason = ?, dq_at = CASE WHEN ? THEN now() END
                                  WHERE season_id = ? AND user_id = ?")
            ->execute([$on ? 'true' : 'false', $on ? trim($reason) : null, $on ? 'true' : 'false', $seasonId, $userId]);
        self::log($seasonId, $on ? 'disqualify' : 'undo_disqualify', $userId, $on ? ['reason' => trim($reason)] : []);
        self::forget($seasonId);
    }

    /** A participant's contest photos, every like on them (valid or not), invalidations. */
    public static function participantDetail(array $season, string $userId): array
    {
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("
            SELECT dp.id, dc.challenge_date::text AS date, dp.photo_url, dp.moderation_status, dp.created_at,
                   (dp.created_at >= cp.joined_at) AS after_join,
                   (SELECT ci.id FROM contest_invalidations ci WHERE ci.season_id = cp.season_id AND ci.kind = 'photo'
                     AND ci.target_id = dp.id AND ci.undone_at IS NULL) AS invalidation_id
            FROM contest_participants cp
            JOIN daily_proofs dp ON dp.user_id = cp.user_id
            JOIN daily_challenges dc ON dc.id = dp.challenge_id
            WHERE cp.season_id = ? AND cp.user_id = ? AND dc.challenge_date BETWEEN ? AND ?
              AND NOT dp.is_demo AND NOT dp.is_seed AND NOT dp.is_suggestion
            ORDER BY dc.challenge_date DESC
        ");
        $stmt->execute([$season['id'], $userId, $season['start_date'], $season['end_date']]);
        $photos = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $votes  = [];
        if ($photos !== []) {
            $in   = implode(',', array_fill(0, count($photos), '?'));
            $stmt = $pdo->prepare("
                SELECT v.id, v.proof_id, v.created_at, v.voter_user_id, vu.username,
                       (" . self::excludedSql('vu', false) . ") AS excluded,
                       (SELECT ci.id FROM contest_invalidations ci WHERE ci.season_id = ? AND ci.kind = 'vote'
                         AND ci.target_id = v.id::text AND ci.undone_at IS NULL) AS invalidation_id
                FROM daily_votes v JOIN users vu ON vu.id = v.voter_user_id
                WHERE v.proof_id IN ($in) ORDER BY v.created_at
            ");
            $stmt->execute(array_merge([$season['id']], array_column($photos, 'id')));
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $v) $votes[$v['proof_id']][] = $v;
        }
        return ['photos' => $photos, 'votes' => $votes];
    }

    /**
     * Suspicious signals (computed, nothing blocked): vote-only accounts, vote spikes,
     * referral rings, participants sharing a device.
     */
    public static function signals(array $season, int $spikePerHour = 10): array
    {
        $pdo = Database::pdo();
        $sid = $season['id'];
        $range = [$season['start_date'], $season['end_date']];

        // Accounts with no approved photo of their own that liked one participant 3+ times.
        $stmt = $pdo->prepare("
            SELECT v.voter_user_id AS voter, vu.username AS voter_name, to_timestamp(vu.created_at) AS voter_created,
                   dp.user_id AS target, tu.username AS target_name, count(*) AS n
            FROM daily_votes v
            JOIN daily_proofs dp     ON dp.id = v.proof_id
            JOIN daily_challenges dc ON dc.id = dp.challenge_id
            JOIN contest_participants cp ON cp.user_id = dp.user_id AND cp.season_id = ?
            JOIN users vu ON vu.id = v.voter_user_id
            JOIN users tu ON tu.id = dp.user_id
            WHERE dc.challenge_date BETWEEN ? AND ?
              AND NOT EXISTS (SELECT 1 FROM daily_proofs mp WHERE mp.user_id = v.voter_user_id AND mp.moderation_status = 'approved')
            GROUP BY v.voter_user_id, vu.username, vu.created_at, dp.user_id, tu.username
            HAVING count(*) >= 3 ORDER BY n DESC LIMIT 50
        ");
        $stmt->execute(array_merge([$sid], $range));
        $voteOnly = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // A participant's photo liked $spikePerHour+ times within one clock hour.
        $stmt = $pdo->prepare("
            SELECT dp.id AS photo, dp.user_id AS target, tu.username AS target_name,
                   date_trunc('hour', v.created_at) AS hour, count(*) AS n
            FROM daily_votes v
            JOIN daily_proofs dp     ON dp.id = v.proof_id
            JOIN daily_challenges dc ON dc.id = dp.challenge_id
            JOIN contest_participants cp ON cp.user_id = dp.user_id AND cp.season_id = ?
            JOIN users tu ON tu.id = dp.user_id
            WHERE dc.challenge_date BETWEEN ? AND ?
            GROUP BY dp.id, dp.user_id, tu.username, date_trunc('hour', v.created_at)
            HAVING count(*) >= ? ORDER BY n DESC LIMIT 50
        ");
        $stmt->execute(array_merge([$sid], $range, [$spikePerHour]));
        $spikes = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Invited friends (both participants) on the inviter's device or network, or liking the inviter a lot.
        $stmt = $pdo->prepare("
            SELECT a.user_id AS referrer, au.username AS referrer_name, b.user_id AS friend, bu.username AS friend_name,
                   EXISTS (SELECT 1 FROM user_devices x JOIN user_devices y ON y.install_id = x.install_id AND y.user_id = a.user_id
                           WHERE x.user_id = b.user_id AND x.install_id <> '') AS same_device,
                   EXISTS (SELECT 1 FROM user_devices x JOIN user_devices y ON y.ip_hash = x.ip_hash AND y.user_id = a.user_id
                           WHERE x.user_id = b.user_id AND x.ip_hash <> '') AS same_network,
                   (SELECT count(*) FROM daily_votes v JOIN daily_proofs dp ON dp.id = v.proof_id
                     WHERE v.voter_user_id = b.user_id AND dp.user_id = a.user_id) AS likes_to_referrer
            FROM contest_participants b
            JOIN users bu ON bu.id = b.user_id
            JOIN contest_participants a ON a.season_id = b.season_id AND a.user_id = bu.invited_by_user_id
            JOIN users au ON au.id = a.user_id
            WHERE b.season_id = ?
        ");
        $stmt->execute([$sid]);
        $rings = array_values(array_filter($stmt->fetchAll(PDO::FETCH_ASSOC), static fn(array $r): bool =>
            DailyProofRepository::bool($r['same_device']) || DailyProofRepository::bool($r['same_network']) || (int) $r['likes_to_referrer'] >= 3));

        // Participants sharing an install.
        $stmt = $pdo->prepare("
            SELECT x.install_id, string_agg(DISTINCT u.username, ', ') AS players, count(DISTINCT x.user_id) AS n
            FROM user_devices x JOIN contest_participants cp ON cp.user_id = x.user_id AND cp.season_id = ?
            JOIN users u ON u.id = x.user_id
            WHERE x.install_id <> ''
            GROUP BY x.install_id HAVING count(DISTINCT x.user_id) > 1
        ");
        $stmt->execute([$sid]);
        $sharedDevices = $stmt->fetchAll(PDO::FETCH_ASSOC);

        return ['voteOnly' => $voteOnly, 'spikes' => $spikes, 'rings' => $rings, 'sharedDevices' => $sharedDevices];
    }
}
