<?php

declare(strict_types=1);

/**
 * Launch Season "Notify me" (the Upcoming phase): a tap registers interest, no age / country /
 * rules yet (those come with the normal join once the season starts). When the season's first day
 * arrives, the cron sends ONE push to everyone who tapped it: "The Launch Season is live". A test
 * season only notifies its testers. The only push of the contest layer (ContestIsolationTest keeps
 * every other contest file push-free); it never touches the score. Writes contest_* tables only.
 */
final class ContestNotify
{
    public const TYPE = 'contest_live';

    /** [title, body] per locale (else English). */
    private const TEXT = [
        'en' => ['The Launch Season is live 🚀', 'Start playing now: finish first in the final week to win the trip to Vietnam ✈️'],
        'fr' => ['La Launch Season est lancée 🚀', 'Commence à jouer : finis premier de la dernière semaine pour gagner le voyage au Vietnam ✈️'],
        'vi' => ['Launch Season đã bắt đầu 🚀', 'Chơi ngay: dẫn đầu tuần cuối để thắng chuyến đi Việt Nam ✈️'],
        'es' => ['¡La Launch Season ya empezó! 🚀', 'Empieza a jugar: termina primero en la última semana y gana el viaje a Vietnam ✈️'],
        'it' => ['La Launch Season è iniziata 🚀', 'Inizia a giocare: arriva primo nell\'ultima settimana e vinci il viaggio in Vietnam ✈️'],
        'pt-br' => ['A Launch Season começou 🚀', 'Comece a jogar: termine em primeiro na última semana e ganhe a viagem ao Vietnã ✈️'],
        'pt-pt' => ['A Launch Season começou 🚀', 'Começa a jogar: termina em primeiro na última semana e ganha a viagem ao Vietname ✈️'],
        'de' => ['Die Launch Season läuft 🚀', 'Jetzt mitspielen: Werde Platz 1 der Finalwoche und gewinne die Reise nach Vietnam ✈️'],
        'nl' => ['De Launch Season is begonnen 🚀', 'Speel nu mee: eindig als eerste in de laatste week en win de reis naar Vietnam ✈️'],
        'zh-hans' => ['Launch Season 开始啦 🚀', '现在就开玩：拿下决赛周第 1 名，赢取越南之旅 ✈️'],
        'zh-hant' => ['Launch Season 開始囉 🚀', '現在就開玩：拿下決賽週第 1 名，贏取越南之旅 ✈️'],
        'ja' => ['Launch Season がスタート 🚀', '今すぐ参加：ファイナルウィークで1位になってベトナム旅行をゲット ✈️'],
        'ko' => ['Launch Season이 시작됐어요 🚀', '지금 시작하세요: 파이널 위크 1위가 되어 베트남 여행을 차지하세요 ✈️'],
        'fil' => ['Live na ang Launch Season 🚀', 'Maglaro na: manguna sa huling linggo para manalo ng trip sa Vietnam ✈️'],
        'th' => ['Launch Season เริ่มแล้ว 🚀', 'เริ่มเล่นเลย: เป็นอันดับ 1 ของสัปดาห์สุดท้ายเพื่อคว้าทริปเวียดนาม ✈️'],
        'id' => ['Launch Season sudah dimulai 🚀', 'Mulai main sekarang: jadilah yang pertama di minggu final untuk memenangkan perjalanan ke Vietnam ✈️'],
        'hi' => ['Launch Season शुरू हो गया 🚀', 'अभी खेलना शुरू करें: फ़ाइनल वीक में पहले स्थान पर रहकर वियतनाम की ट्रिप जीतें ✈️'],
        'ru' => ['Launch Season стартовал 🚀', 'Начинай играть: займи первое место в финальной неделе и выиграй поездку во Вьетнам ✈️'],
        'ar' => ['انطلق Launch Season 🚀', 'ابدأ اللعب الآن: كن الأول في الأسبوع الأخير لتفوز برحلة إلى فيتنام ✈️'],
    ];

    public static function register(int $seasonId, string $userId): void
    {
        Database::pdo()->prepare("INSERT INTO contest_interest (season_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
            ->execute([$seasonId, $userId]);
    }

    public static function isRegistered(int $seasonId, string $userId): bool
    {
        $st = Database::pdo()->prepare("SELECT 1 FROM contest_interest WHERE season_id = ? AND user_id = ?");
        $st->execute([$seasonId, $userId]);
        return (bool) $st->fetchColumn();
    }

    public static function count(int $seasonId): int
    {
        $st = Database::pdo()->prepare("SELECT COUNT(*) FROM contest_interest WHERE season_id = ?");
        $st->execute([$seasonId]);
        return (int) $st->fetchColumn();
    }

    public static function text(?string $locale): array
    {
        return self::TEXT[$locale ?? 'en'] ?? self::TEXT['en'];
    }

    /**
     * The cron: every published, unpaused season whose first day has come (and not ended) and
     * whose live push hasn't gone out sends it once (claimed atomically, so overlapping ticks
     * can't double-send). Returns the number of pushes sent.
     */
    public static function dispatchLive(): int
    {
        $pdo   = Database::pdo();
        $today = DailyClock::currentDate();
        $sent  = 0;
        $due = $pdo->prepare("SELECT id, is_test FROM contest_seasons
                              WHERE status = 'running' AND NOT paused AND live_notified_at IS NULL AND start_date <= ? AND end_date >= ?");
        $due->execute([$today, $today]);
        foreach ($due->fetchAll(\PDO::FETCH_ASSOC) as $s) {
            $claim = $pdo->prepare("UPDATE contest_seasons SET live_notified_at = now() WHERE id = ? AND live_notified_at IS NULL RETURNING id");
            $claim->execute([$s['id']]);
            if (!$claim->fetchColumn()) continue;
            // A test season: its testers only (the season is invisible to anyone else anyway).
            $who = $pdo->prepare("SELECT ci.user_id, u.locale FROM contest_interest ci JOIN users u ON u.id = ci.user_id
                                  WHERE ci.season_id = ?" . ($s['is_test'] ? " AND EXISTS (SELECT 1 FROM contest_testers t WHERE t.season_id = ci.season_id AND t.user_id = ci.user_id)" : ''));
            $who->execute([$s['id']]);
            foreach ($who->fetchAll(\PDO::FETCH_ASSOC) as $r) {
                [$title, $body] = self::text($r['locale'] ?? null);
                try {
                    NotificationRepository::createUnchecked($r['user_id'], self::TYPE, $title, $body,
                        ['deepLink' => '/contest', 'seasonId' => (int) $s['id']], $r['locale'] ?? null);
                    $sent++;
                } catch (\Throwable $e) {
                    error_log('[contest-live] push failed for user=' . $r['user_id'] . ' err=' . $e->getMessage());
                }
            }
            error_log('[contest-live] season ' . $s['id'] . ': ' . $sent . ' push(es)');
        }
        return $sent;
    }
}
