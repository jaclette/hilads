<?php

declare(strict_types=1);

/**
 * Launch Season: a time-limited contest on top of the game (Admin › Launch Season).
 *
 * A SEPARATE LAYER. It reads daily_proofs / daily_votes / users / user_devices and writes
 * only the contest_* tables: never score_events, never users.score_*, never a push or a
 * notification (ContestIsolationTest checks this file for it). Posting and voting are the
 * game's own, unchanged: a participant's photos count for the contest automatically.
 *
 * - A contest photo: approved, not demo / seed / suggestion, its challenge dated in the
 *   season, posted after its author joined, not invalidated for the contest.
 * - A contest vote: a like on a contest photo, not from a review / demo / fake / hidden
 *   account, not invalidated. 1 vote = 1 point, at most vote_cap_per_photo per photo.
 * - Referral: a participant B whose users.invited_by_user_id is A (a participant), invited
 *   during the season and before B joined, on a distinct device (Invites::blockReason),
 *   with at least referral_min_photos contest photos: +referral_points for A, at most
 *   referral_cap of them.
 * - Season ranking (photos dated before final_week_start) = capped votes + referral bonus.
 *   At the final week the top headstart_top_n are frozen (N points for #1 … 1 for #N).
 *   Final = capped votes on final-week photos + referral bonus + head-start.
 *   Ties: days played, then all votes uncapped, then the earliest join.
 * - Everything is computed on read (cached CACHE_TTL s): a setting or an invalidation
 *   changes the standings at once. Only the head-start is stored.
 * - Test seasons (is_test): only contest_testers see and join them; testers never join a
 *   real season; a dev build (X-App-Build: dev) joins only a test season.
 */
final class Contest
{
    public const CACHE_TTL = 30;
    public const SETTINGS = ['vote_cap_per_photo', 'referral_points', 'referral_min_photos', 'referral_cap',
                             'headstart_top_n', 'prize_threshold_players', 'prize_threshold_photos'];

    /** The locales the prize text can be written in (the apps' 19). */
    public const LOCALES = ['en', 'fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant', 'ja', 'ko', 'fil', 'th', 'id', 'hi', 'ru', 'ar'];

    /**
     * The launch prize, prefilled on a new season and on seasons saved before the prize
     * setting (Admin › Launch Season edits it per season and locale: title + one line).
     */
    public const DEFAULT_PRIZE = [
        'en'      => ['title' => 'Win a week in Vietnam', 'subtitle' => "Flights included, for the season's best photographer.", 'description' => 'Seven days in Vietnam for the season\'s best photographer, return flights included. Limestone islands in Ha Long Bay, lantern-lit evenings in Hoi An, street food in Saigon: your next photos are waiting.'],
        'fr'      => ['title' => 'Gagne une semaine au Vietnam', 'subtitle' => 'Vols compris, pour le meilleur photographe de la saison.', 'description' => 'Sept jours au Vietnam pour le meilleur photographe de la saison, vols aller-retour compris. Les îles de calcaire de la baie d\'Ha Long, les soirées aux lanternes de Hoi An, la street food de Saigon : tes prochaines photos t\'attendent.'],
        'vi'      => ['title' => 'Thắng một tuần du lịch Việt Nam', 'subtitle' => 'Bao gồm vé máy bay, dành cho nhiếp ảnh gia xuất sắc nhất mùa.', 'description' => 'Bảy ngày ở Việt Nam dành cho nhiếp ảnh gia xuất sắc nhất mùa, bao gồm vé máy bay khứ hồi. Những đảo đá vôi ở vịnh Hạ Long, buổi tối lung linh đèn lồng ở Hội An, ẩm thực đường phố Sài Gòn: những bức ảnh tiếp theo của bạn đang chờ.'],
        'es'      => ['title' => 'Gana una semana en Vietnam', 'subtitle' => 'Vuelos incluidos, para el mejor fotógrafo de la temporada.', 'description' => 'Siete días en Vietnam para el mejor fotógrafo de la temporada, vuelos de ida y vuelta incluidos. Las islas de piedra caliza de la bahía de Ha Long, las noches de farolillos en Hoi An, la comida callejera de Saigón: tus próximas fotos te esperan.'],
        'it'      => ['title' => 'Vinci una settimana in Vietnam', 'subtitle' => 'Voli inclusi, per il miglior fotografo della stagione.', 'description' => 'Sette giorni in Vietnam per il miglior fotografo della stagione, voli di andata e ritorno inclusi. Le isole calcaree della baia di Ha Long, le sere tra le lanterne di Hoi An, lo street food di Saigon: le tue prossime foto ti aspettano.'],
        'pt-br'   => ['title' => 'Ganhe uma semana no Vietnã', 'subtitle' => 'Voos incluídos, para o melhor fotógrafo da temporada.', 'description' => 'Sete dias no Vietnã para o melhor fotógrafo da temporada, passagens de ida e volta incluídas. As ilhas de calcário da baía de Ha Long, as noites de lanternas em Hoi An, a comida de rua de Saigon: suas próximas fotos estão esperando.'],
        'pt-pt'   => ['title' => 'Ganha uma semana no Vietname', 'subtitle' => 'Voos incluídos, para o melhor fotógrafo da temporada.', 'description' => 'Sete dias no Vietname para o melhor fotógrafo da temporada, voos de ida e volta incluídos. As ilhas de calcário da baía de Ha Long, as noites de lanternas em Hoi An, a comida de rua de Saigão: as tuas próximas fotos estão à espera.'],
        'de'      => ['title' => 'Gewinne eine Woche in Vietnam', 'subtitle' => 'Inklusive Flügen, für die beste Fotografin oder den besten Fotografen der Saison.', 'description' => 'Sieben Tage Vietnam für die beste Fotografin oder den besten Fotografen der Saison, Hin- und Rückflug inklusive. Kalksteininseln in der Halong-Bucht, Laternenabende in Hoi An, Streetfood in Saigon: Deine nächsten Fotos warten schon.'],
        'nl'      => ['title' => 'Win een week in Vietnam', 'subtitle' => 'Inclusief vluchten, voor de beste fotograaf van het seizoen.', 'description' => 'Zeven dagen Vietnam voor de beste fotograaf van het seizoen, retourvluchten inbegrepen. Kalksteeneilanden in de Ha Long-baai, avonden vol lantaarns in Hoi An, streetfood in Saigon: je volgende foto\'s wachten al.'],
        'zh-hans' => ['title' => '赢取越南一周之旅', 'subtitle' => '含往返机票，送给本季最佳摄影师。', 'description' => '为本季最佳摄影师送上越南七日游，含往返机票。下龙湾的石灰岩群岛、会安灯笼点亮的夜晚、西贡的街头美食：你的下一组照片正在等你。'],
        'zh-hant' => ['title' => '贏取越南一週之旅', 'subtitle' => '含來回機票，送給本季最佳攝影師。', 'description' => '為本季最佳攝影師送上越南七日遊，含來回機票。下龍灣的石灰岩群島、會安燈籠點亮的夜晚、西貢的街頭美食：你的下一組照片正在等你。'],
        'ja'      => ['title' => 'ベトナム1週間の旅をゲット', 'subtitle' => '航空券込み。シーズン最優秀フォトグラファーへ。', 'description' => 'シーズン最優秀フォトグラファーにベトナム7日間の旅を（往復航空券込み）。ハロン湾の石灰岩の島々、ランタンが灯るホイアンの夜、サイゴンの屋台グルメ。次の一枚があなたを待っています。'],
        'ko'      => ['title' => '베트남 일주일 여행에 당첨되세요', 'subtitle' => '항공권 포함, 시즌 최고의 사진가에게.', 'description' => '시즌 최고의 사진가에게 베트남 7일 여행을 드려요. 왕복 항공권 포함. 하롱베이의 석회암 섬들, 등불이 밝히는 호이안의 밤, 사이공의 길거리 음식: 다음 사진이 당신을 기다려요.'],
        'fil'     => ['title' => 'Manalo ng isang linggo sa Vietnam', 'subtitle' => 'Kasama ang flights, para sa pinakamahusay na photographer ng season.', 'description' => 'Pitong araw sa Vietnam para sa pinakamahusay na photographer ng season, kasama ang round-trip flights. Mga limestone island sa Ha Long Bay, mga gabing puno ng parol sa Hoi An, street food sa Saigon: naghihintay ang mga susunod mong photo.'],
        'th'      => ['title' => 'ลุ้นเที่ยวเวียดนาม 1 สัปดาห์', 'subtitle' => 'รวมตั๋วเครื่องบิน สำหรับช่างภาพยอดเยี่ยมของซีซัน', 'description' => 'เที่ยวเวียดนาม 7 วันสำหรับช่างภาพยอดเยี่ยมของซีซัน รวมตั๋วเครื่องบินไป-กลับ เกาะหินปูนในอ่าวฮาลอง ค่ำคืนแสงโคมในฮอยอัน สตรีทฟู้ดในไซง่อน ภาพถัดไปของคุณรออยู่'],
        'id'      => ['title' => 'Menangkan seminggu di Vietnam', 'subtitle' => 'Termasuk tiket pesawat, untuk fotografer terbaik musim ini.', 'description' => 'Tujuh hari di Vietnam untuk fotografer terbaik musim ini, termasuk tiket pesawat pulang-pergi. Pulau-pulau batu kapur di Teluk Ha Long, malam berhias lampion di Hoi An, jajanan kaki lima di Saigon: foto-foto berikutnya menantimu.'],
        'hi'      => ['title' => 'वियतनाम में एक हफ़्ता जीतें', 'subtitle' => 'फ़्लाइट्स शामिल, सीज़न के सबसे अच्छे फ़ोटोग्राफ़र के लिए।', 'description' => 'सीज़न के सबसे अच्छे फ़ोटोग्राफ़र के लिए वियतनाम में सात दिन, आने-जाने की फ़्लाइट्स शामिल। हा लॉन्ग बे के चूना-पत्थर के द्वीप, होई आन की लालटेनों वाली शामें, साइगॉन का स्ट्रीट फ़ूड: आपकी अगली फ़ोटो इंतज़ार कर रही हैं।'],
        'ru'      => ['title' => 'Выиграй неделю во Вьетнаме', 'subtitle' => 'С перелётом — для лучшего фотографа сезона.', 'description' => 'Семь дней во Вьетнаме для лучшего фотографа сезона, перелёт туда и обратно включён. Известняковые острова бухты Халонг, вечера с фонариками в Хойане, уличная еда Сайгона — твои следующие фото уже ждут.'],
        'ar'      => ['title' => 'اربح أسبوعًا في فيتنام', 'subtitle' => 'شامل تذاكر الطيران، لأفضل مصوّر في الموسم.', 'description' => 'سبعة أيام في فيتنام لأفضل مصوّر في الموسم، تشمل تذاكر الطيران ذهابًا وإيابًا. جزر الحجر الجيري في خليج ها لونغ، وأمسيات الفوانيس في هوي آن، وطعام الشارع في سايغون: صورك القادمة بانتظارك.'],
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
        foreach (self::SETTINGS as $k) $r[$k] = (int) $r[$k];
        $r['is_test'] = DailyProofRepository::bool($r['is_test']);
        $r['paused']  = DailyProofRepository::bool($r['paused']);
        $prize = json_decode((string) ($r['prize_i18n'] ?? ''), true);
        $r['prize_i18n'] = is_array($prize) && $prize !== [] ? $prize : self::DEFAULT_PRIZE;
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
        if ($userId !== null) {
            $stmt = $pdo->prepare("
                SELECT s.* FROM contest_seasons s JOIN contest_testers t ON t.season_id = s.id AND t.user_id = ?
                WHERE s.is_test AND s.status = 'running' AND NOT s.paused ORDER BY s.id DESC LIMIT 1
            ");
            $stmt->execute([$userId]);
            if ($r = $stmt->fetch(PDO::FETCH_ASSOC)) return self::normalizeSeason($r);
        }
        $r = $pdo->query("SELECT * FROM contest_seasons WHERE NOT is_test AND status = 'running' AND NOT paused ORDER BY id DESC LIMIT 1")
                 ->fetch(PDO::FETCH_ASSOC);
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
     * not_tester (a test season), dev_build (a dev build joins only a test season).
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
        if ($season['is_test']) {
            return self::isTester($season['id'], $userId) ? null : 'not_tester';
        }
        if (DailyProofRepository::bool($u['tester'])) return 'tester';
        if ($devBuild) return 'dev_build';
        return null;
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

    /** The standings of a season (cached), the head-start frozen first when it is due. */
    public static function standings(array $season): array
    {
        if ($season['headstart_frozen_at'] === null && in_array(self::phase($season), ['final', 'over', 'ended'], true)) {
            self::freezeHeadstart($season);
            $season = self::season($season['id']) ?? $season;
        }
        return Cache::remember(self::cacheKey($season['id']), self::CACHE_TTL, static function () use ($season): array {
            [$participants, $photos, $headstart] = self::load($season);
            return self::compute($season, $participants, $photos, $headstart);
        }) ?? [];
    }

    public static function forget(int $seasonId): void
    {
        Cache::forget(self::cacheKey($seasonId));
    }

    private static function cacheKey(int $seasonId): string
    {
        return "contest_standings_v1_{$seasonId}";
    }

    /** SQL shared by the standings and the admin: the accounts that never count. */
    private static function excludedSql(string $alias, bool $test): string
    {
        $x = "{$alias}.is_review OR {$alias}.is_demo OR {$alias}.is_fake";
        return $test ? $x : "{$x} OR {$alias}.hidden_from_rankings";
    }

    /**
     * The raw rows: participants (with their inviter and whether the device rule blocks
     * that invite), contest photos (with their valid votes), the frozen head-start.
     */
    private static function load(array $season): array
    {
        $pdo  = Database::pdo();
        $sid  = $season['id'];
        $test = $season['is_test'];
        $stmt = $pdo->prepare("
            SELECT cp.user_id, cp.joined_at, cp.disqualified, cp.dq_reason, cp.country, cp.referred_by,
                   u.username, u.display_name, u.profile_thumb_photo_url AS thumb,
                   u.invited_by_user_id, u.invited_at
            FROM contest_participants cp JOIN users u ON u.id = cp.user_id
            WHERE cp.season_id = ? AND u.deleted_at IS NULL AND NOT (" . self::excludedSql('u', $test) . ")
            " . ($test ? '' : "AND NOT EXISTS (SELECT 1 FROM contest_testers t WHERE t.user_id = cp.user_id)") . "
        ");
        $stmt->execute([$sid]);
        $participants = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $ids = array_flip(array_column($participants, 'user_id'));
        foreach ($participants as &$p) {
            $p['ref_blocked'] = null;
            $a = $p['invited_by_user_id'];
            if ($a !== null && isset($ids[$a])) {
                $p['ref_blocked'] = Invites::blockReason((string) $a, (string) $p['user_id']);
            }
        }
        unset($p);

        $stmt = $pdo->prepare("
            SELECT dp.id, dp.user_id, dc.challenge_date::text AS date, dp.created_at,
                   (SELECT count(*) FROM daily_votes v JOIN users vu ON vu.id = v.voter_user_id
                    WHERE v.proof_id = dp.id AND NOT (" . self::excludedSql('vu', false) . ")
                      AND NOT EXISTS (SELECT 1 FROM contest_invalidations ci WHERE ci.season_id = cp.season_id AND ci.kind = 'vote'
                                      AND ci.target_id = v.id::text AND ci.undone_at IS NULL)) AS votes
            FROM contest_participants cp
            JOIN daily_proofs dp     ON dp.user_id = cp.user_id AND dp.created_at >= cp.joined_at
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

        return [$participants, $photos, $headstart];
    }

    /**
     * The standings from raw rows (pure: ContestTest drives it).
     *
     * @param list<array>        $participants user_id, joined_at, disqualified, invited_by_user_id, invited_at, ref_blocked (+ display fields)
     * @param list<array>        $photos       id, user_id, date (Y-m-d), votes (valid, uncapped)
     * @param array<string,int>  $headstart    user_id => points (frozen)
     * @return array{rows: array<string,array>, season: list<string>, final: list<string>, counter: array, totals: array}
     */
    public static function compute(array $season, array $participants, array $photos, array $headstart): array
    {
        $cap = (int) $season['vote_cap_per_photo'];
        $fws = (string) $season['final_week_start'];
        $windowStart = $season['start_date'] . ' 00:00:00+00';
        $rows = [];
        foreach ($participants as $p) {
            $id = (string) $p['user_id'];
            $rows[$id] = [
                'userId' => $id, 'username' => $p['username'] ?? null, 'displayName' => $p['display_name'] ?? null,
                'thumb' => $p['thumb'] ?? null, 'country' => $p['country'] ?? null,
                'joinedAt' => (string) $p['joined_at'], 'disqualified' => DailyProofRepository::bool($p['disqualified'] ?? false),
                'dqReason' => $p['dq_reason'] ?? null,
                'seasonVotes' => 0, 'finalVotes' => 0, 'allVotes' => 0, 'photos' => 0, 'dates' => [],
                'referrals' => 0, 'referralBonus' => 0, 'referralFriends' => [], 'headstart' => (int) ($headstart[$id] ?? 0),
            ];
        }
        foreach ($photos as $ph) {
            $id = (string) $ph['user_id'];
            if (!isset($rows[$id])) continue;
            $votes = (int) $ph['votes'];
            $pts   = min($votes, $cap);
            $rows[$id][(string) $ph['date'] < $fws ? 'seasonVotes' : 'finalVotes'] += $pts;
            $rows[$id]['allVotes'] += $votes;
            $rows[$id]['photos']++;
            $rows[$id]['dates'][(string) $ph['date']] = true;
        }

        // Referrals: B counts for A once B is an active contest player.
        foreach ($participants as $b) {
            $a = $b['invited_by_user_id'] ?? null;
            $bid = (string) $b['user_id'];
            if ($a === null || !isset($rows[$a]) || $a === $bid) continue;
            $friend = ['userId' => $bid, 'username' => $b['username'] ?? null, 'photos' => $rows[$bid]['photos'], 'status' => 'pending'];
            $invitedAt = (string) ($b['invited_at'] ?? '');
            if ($invitedAt === '' || strtotime($invitedAt) < strtotime($windowStart)) {
                $friend['status'] = 'before_season';
            } elseif (strtotime($invitedAt) >= strtotime((string) $b['joined_at'])) {
                $friend['status'] = 'invited_after_join';
            } elseif (!empty($b['ref_blocked'])) {
                $friend['status'] = 'same_device';
            } elseif ($rows[$bid]['disqualified']) {
                $friend['status'] = 'disqualified';
            } elseif ($rows[$bid]['photos'] >= (int) $season['referral_min_photos']) {
                $friend['status'] = 'active';
                $rows[$a]['referrals']++;
            }
            $rows[$a]['referralFriends'][] = $friend;
        }

        $threshold = (int) $season['prize_threshold_photos'];
        $qualified = 0;
        foreach ($rows as $id => &$r) {
            $r['days']          = count($r['dates']);
            unset($r['dates']);
            $r['referralsCounted'] = min($r['referrals'], (int) $season['referral_cap']);
            $r['referralBonus'] = $r['referralsCounted'] * (int) $season['referral_points'];
            $r['seasonPoints']  = $r['seasonVotes'] + $r['referralBonus'];
            $r['finalPoints']   = $r['finalVotes'] + $r['referralBonus'] + $r['headstart'];
            if (!$r['disqualified'] && $r['photos'] >= $threshold) $qualified++;
        }
        unset($r);

        $order = static function (string $field) use ($rows): array {
            $ids = array_keys(array_filter($rows, static fn(array $r): bool => !$r['disqualified']));
            usort($ids, static function (string $x, string $y) use ($rows, $field): int {
                $a = $rows[$x]; $b = $rows[$y];
                return [$b[$field], $b['days'], $b['allVotes'], strtotime($a['joinedAt'])]
                   <=> [$a[$field], $a['days'], $a['allVotes'], strtotime($b['joinedAt'])];
            });
            return array_map('strval', $ids);
        };
        $seasonOrder = $order('seasonPoints');
        $finalOrder  = $order('finalPoints');
        foreach ($seasonOrder as $i => $id) $rows[$id]['seasonRank'] = $i + 1;
        foreach ($finalOrder as $i => $id)  $rows[$id]['finalRank']  = $i + 1;

        return [
            'rows'    => $rows,
            'season'  => $seasonOrder,
            'final'   => $finalOrder,
            'counter' => ['players' => $qualified, 'threshold' => (int) $season['prize_threshold_players'], 'photos' => $threshold],
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
            [$participants, $photos] = self::load($season);
            $s   = self::compute($season, $participants, $photos, []);
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

    public static function seasonPayload(array $s, ?string $locale = null): array
    {
        return [
            'prize' => self::prize($s, $locale),
            'photos' => class_exists('ContestPhotos') ? ContestPhotos::payload($s) : [],
        ] + (class_exists('ContestTrip') ? ContestTrip::payload($s, $locale) : []) + [
            'id' => $s['id'], 'name' => $s['name'], 'isTest' => $s['is_test'], 'phase' => self::phase($s),
            'startDate' => $s['start_date'], 'endDate' => $s['end_date'], 'finalWeekStart' => $s['final_week_start'],
            // The real moments (the daily drop, ISO UTC) for the countdowns: the season starts at its first
            // challenge's drop, the final week at its first day's, and it ends at the drop after its last day.
            'startsAt' => self::dropIso($s['start_date']), 'finalAt' => self::dropIso($s['final_week_start']),
            'endsAt' => self::dropIso((new DateTimeImmutable($s['end_date'] . ' 12:00:00', new DateTimeZone('UTC')))->modify('+1 day')->format('Y-m-d')),
            'rules' => [
                'voteCap' => $s['vote_cap_per_photo'], 'referralPoints' => $s['referral_points'],
                'referralMinPhotos' => $s['referral_min_photos'], 'referralCap' => $s['referral_cap'],
                'headstartTopN' => $s['headstart_top_n'],
            ],
            'rulesUrl' => 'https://hilads.live/launch-season/rules' . ($s['is_test'] ? '?season=' . $s['id'] : ''),
        ];
    }

    private static function dropIso(string $date): ?string
    {
        try {
            return DailyClock::dropAt($date)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
        } catch (\Throwable) {
            return null;
        }
    }

    /** One standings row for the app / web. */
    public static function rowPayload(array $r, string $phase): array
    {
        return [
            'rank' => $phase === 'final' ? ($r['finalRank'] ?? null) : ($r['seasonRank'] ?? null),
            'userId' => $r['userId'], 'username' => $r['username'], 'displayName' => $r['displayName'],
            'photoUrl' => class_exists('R2Uploader') ? R2Uploader::thumbProxy($r['thumb']) : $r['thumb'],
            'points' => $phase === 'final' ? $r['finalPoints'] : $r['seasonPoints'],
            'votes' => $phase === 'final' ? $r['finalVotes'] : $r['seasonVotes'],
            'referral' => $r['referralBonus'], 'headstart' => $phase === 'final' ? $r['headstart'] : 0,
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
        $me    = null;
        if ($userId !== null) {
            if (isset($st['rows'][$userId])) {
                $r  = $st['rows'][$userId];
                $me = [
                    'joined' => true, 'disqualified' => $r['disqualified'],
                    'seasonRank' => $r['seasonRank'] ?? null, 'finalRank' => $r['finalRank'] ?? null,
                    'points' => ['votes' => $r['seasonVotes'], 'finalVotes' => $r['finalVotes'], 'referral' => $r['referralBonus'],
                                 'headstart' => $r['headstart'], 'season' => $r['seasonPoints'], 'final' => $r['finalPoints']],
                    'photos' => $r['photos'], 'days' => $r['days'],
                    'referrals' => ['active' => $r['referrals'], 'cap' => $season['referral_cap'], 'minPhotos' => $season['referral_min_photos'],
                                    'friends' => array_map(static fn(array $f): array => ['username' => $f['username'], 'photos' => $f['photos'], 'status' => $f['status']],
                                                           $r['referralFriends'])],
                ];
            } elseif (self::participant($season['id'], $userId) !== null) {
                $me = ['joined' => true, 'disqualified' => false, 'excluded' => true];
            } else {
                $block = self::joinBlock($season, $userId, self::isDevBuild());
                $stmt  = Database::pdo()->prepare("SELECT home_country FROM users WHERE id = ?");
                $stmt->execute([$userId]);
                $cc    = $stmt->fetchColumn() ?: (class_exists('Request') ? Request::country() : null);
                $me = ['joined' => false, 'canJoin' => $block === null, 'reason' => $block, 'suggestedCountry' => $cc ? strtoupper((string) $cc) : null];
            }
        }
        return [
            'season'  => self::seasonPayload($season, $locale),
            'counter' => $st['counter'] ?? null,
            'participants' => $st['totals']['participants'] ?? 0,
            'me'      => $me,
        ];
    }

    /** GET /contest/ranking: the season (weeks 1…) or final-week ranking, top $limit + me. */
    public static function ranking(?string $userId, string $phase, int $limit = 100): ?array
    {
        $season = self::visibleFor($userId);
        if ($season === null) return null;
        $st    = self::standings($season);
        $phase = $phase === 'final' ? 'final' : 'season';
        $order = $st[$phase] ?? [];
        $rows  = [];
        foreach (array_slice($order, 0, $limit) as $id) $rows[] = self::rowPayload($st['rows'][$id], $phase);
        $me = $userId !== null && isset($st['rows'][$userId]) && !$st['rows'][$userId]['disqualified']
            ? self::rowPayload($st['rows'][$userId], $phase) : null;
        return ['phase' => $phase, 'frozen' => $season['headstart_frozen_at'] !== null, 'rows' => $rows, 'me' => $me, 'total' => count($order)];
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
            return ['season' => null, 'locale' => 'en', 'body' => self::placeholderRules(null), 'isFinal' => false, 'version' => 0, 'updatedAt' => null];
        }
        $stmt = $pdo->prepare("SELECT locale, body, is_final, version, updated_at FROM contest_rules WHERE season_id = ? AND locale IN (?, 'en')
                               ORDER BY (locale = ?) DESC LIMIT 1");
        $stmt->execute([$season['id'], $locale, $locale]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        return [
            'season'    => ['id' => $season['id'], 'name' => $season['name'], 'startDate' => $season['start_date'], 'endDate' => $season['end_date']],
            'locale'    => $r['locale'] ?? 'en',
            'body'      => $r['body'] ?? self::placeholderRules($season),
            'isFinal'   => $r ? DailyProofRepository::bool($r['is_final']) : false,
            'version'   => (int) ($r['version'] ?? 0),
            'updatedAt' => $r['updated_at'] ?? null,
        ];
    }

    /** The DRAFT placeholder (markdown), from the season's settings. */
    public static function placeholderRules(?array $s): string
    {
        $s ??= ['name' => 'Launch Season', 'start_date' => '…', 'end_date' => '…', 'final_week_start' => '…',
                'vote_cap_per_photo' => 20, 'referral_points' => 20, 'referral_min_photos' => 5, 'referral_cap' => 10,
                'headstart_top_n' => 10, 'prize_threshold_players' => 500, 'prize_threshold_photos' => 10];
        return <<<MD
        # {$s['name']} — official rules

        **DRAFT - not final.** This text is being reviewed and will change.

        ## Who can enter
        Anyone 18 or older with a Hilads account who joins the {$s['name']} in the app. One entry per person.

        ## Dates
        From {$s['start_date']} to {$s['end_date']}. The final week starts on {$s['final_week_start']}.

        ## How points work
        - Post your photo for the daily challenge as usual. Once you have joined, every approved photo you post during the season counts.
        - 1 like = 1 point, up to {$s['vote_cap_per_photo']} points per photo.
        - Invite friends: +{$s['referral_points']} points for each friend who joins with your link during the season, joins the contest and posts {$s['referral_min_photos']} approved photos (up to {$s['referral_cap']} friends).
        - At the start of the final week, the top {$s['headstart_top_n']} get a head start ({$s['headstart_top_n']} points for #1 down to 1 point).
        - Final score = likes in the final week + invite points + head start. Ties: most days played, then most likes overall, then the earliest to join.

        ## Prize
        The prize is awarded if at least {$s['prize_threshold_players']} players post {$s['prize_threshold_photos']} approved photos or more during the season.

        ## Fair play
        Hilads may invalidate photos, likes or invites and disqualify entries that break the rules.
        MD;
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
