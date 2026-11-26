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

    /** [title, body] per locale (else English). "Launch Trip" stays English in every language. */
    private const TEXT = [
        'en' => ['The Launch Trip has started ✈️', 'Play today\'s challenge to enter the race: finish first in the final week to win the trip.'],
        'fr' => ['Le Launch Trip a commencé ✈️', 'Joue le défi du jour pour entrer dans la course : finis premier de la dernière semaine pour gagner le voyage.'],
        'vi' => ['Launch Trip đã bắt đầu ✈️', 'Chơi thử thách hôm nay để vào cuộc đua: dẫn đầu tuần cuối để thắng chuyến đi.'],
        'es' => ['El Launch Trip ha empezado ✈️', 'Juega el reto de hoy para entrar en la carrera: termina primero en la última semana y gana el viaje.'],
        'it' => ['Il Launch Trip è iniziato ✈️', 'Gioca la sfida di oggi per entrare in gara: arriva primo nell\'ultima settimana e vinci il viaggio.'],
        'pt-br' => ['O Launch Trip começou ✈️', 'Jogue o desafio de hoje para entrar na corrida: termine em primeiro na última semana e ganhe a viagem.'],
        'pt-pt' => ['O Launch Trip começou ✈️', 'Joga o desafio de hoje para entrar na corrida: termina em primeiro na última semana e ganha a viagem.'],
        'de' => ['Der Launch Trip hat begonnen ✈️', 'Spiel die heutige Challenge, um ins Rennen zu kommen: Werde Erster der Finalwoche und gewinne die Reise.'],
        'nl' => ['De Launch Trip is begonnen ✈️', 'Speel de challenge van vandaag om mee te racen: eindig als eerste in de laatste week en win de reis.'],
        'zh-hans' => ['Launch Trip 开始啦 ✈️', '玩今天的挑战即可参赛：拿下决赛周第 1 名，赢取这趟旅行。'],
        'zh-hant' => ['Launch Trip 開始囉 ✈️', '玩今天的挑戰即可參賽：拿下決賽週第 1 名，贏得這趟旅行。'],
        'ja' => ['Launch Trip がスタート ✈️', '今日のチャレンジをプレイしてレースに参加：ファイナルウィークで1位になって旅行をゲット。'],
        'ko' => ['Launch Trip이 시작됐어요 ✈️', '오늘의 챌린지를 플레이하고 레이스에 참가하세요: 파이널 위크 1위가 여행을 차지해요.'],
        'fil' => ['Nagsimula na ang Launch Trip ✈️', 'Laruin ang challenge ngayon para makasali sa race: manguna sa huling linggo para manalo ng trip.'],
        'th' => ['Launch Trip เริ่มแล้ว ✈️', 'เล่นชาเลนจ์วันนี้เพื่อเข้าร่วมการแข่งขัน: เป็นอันดับ 1 ของสัปดาห์สุดท้ายเพื่อคว้าทริปนี้'],
        'id' => ['Launch Trip sudah dimulai ✈️', 'Mainkan tantangan hari ini untuk ikut balapan: jadilah yang pertama di minggu final untuk memenangkan perjalanannya.'],
        'hi' => ['Launch Trip शुरू हो गया ✈️', 'रेस में शामिल होने के लिए आज का चैलेंज खेलें: फ़ाइनल वीक में पहले स्थान पर रहकर ट्रिप जीतें।'],
        'ru' => ['Launch Trip начался ✈️', 'Сыграй сегодняшний челлендж, чтобы войти в гонку: займи первое место в финальной неделе и выиграй поездку.'],
        'ar' => ['بدأ Launch Trip ✈️', 'العب تحدي اليوم لتدخل السباق: كن الأول في الأسبوع الأخير لتفوز بالرحلة.'],
    ];

    /** The email's button and footer line per locale (web visitors who left their email). */
    private const EMAIL = [
        'en' => ['Open Hilads', 'You asked us to tell you when it starts. This is the only email about it.'],
        'fr' => ['Ouvrir Hilads', 'Tu as demandé à être prévenu du lancement. C\'est le seul e-mail à ce sujet.'],
        'vi' => ['Mở Hilads', 'Bạn đã yêu cầu được báo khi bắt đầu. Đây là email duy nhất về việc này.'],
        'es' => ['Abrir Hilads', 'Pediste que te avisáramos cuando empezara. Es el único correo sobre esto.'],
        'it' => ['Apri Hilads', 'Hai chiesto di essere avvisato all\'inizio. È l\'unica email su questo.'],
        'pt-br' => ['Abrir o Hilads', 'Você pediu para ser avisado quando começasse. Este é o único e-mail sobre isso.'],
        'pt-pt' => ['Abrir o Hilads', 'Pediste para ser avisado quando começasse. Este é o único e-mail sobre isso.'],
        'de' => ['Hilads öffnen', 'Du wolltest beim Start Bescheid bekommen. Das ist die einzige E-Mail dazu.'],
        'nl' => ['Open Hilads', 'Je vroeg om een seintje bij de start. Dit is de enige e-mail hierover.'],
        'zh-hans' => ['打开 Hilads', '你要求在开始时通知你。这是关于此事的唯一一封邮件。'],
        'zh-hant' => ['打開 Hilads', '你要求在開始時通知你。這是關於此事的唯一一封郵件。'],
        'ja' => ['Hilads を開く', '開始時のお知らせをご希望いただいたため、お送りしています。この件のメールはこれだけです。'],
        'ko' => ['Hilads 열기', '시작할 때 알려 달라고 요청하셨어요. 이 건에 관한 이메일은 이것 하나뿐이에요.'],
        'fil' => ['Buksan ang Hilads', 'Hiniling mong sabihan ka kapag nagsimula na. Ito lang ang email tungkol dito.'],
        'th' => ['เปิด Hilads', 'คุณขอให้แจ้งเมื่อเริ่ม นี่คืออีเมลฉบับเดียวเกี่ยวกับเรื่องนี้'],
        'id' => ['Buka Hilads', 'Kamu minta diberi tahu saat dimulai. Ini satu-satunya email tentang hal ini.'],
        'hi' => ['Hilads खोलें', 'आपने शुरू होने पर बताने को कहा था। इसके बारे में यही एकमात्र ईमेल है।'],
        'ru' => ['Открыть Hilads', 'Ты просил сообщить о старте. Это единственное письмо об этом.'],
        'ar' => ['افتح Hilads', 'طلبت أن نخبرك عند البدء. هذه هي الرسالة الوحيدة بهذا الشأن.'],
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

    /** "Notify me" from an app guest (no account): its device's push token is found by guest_id at the start. */
    public static function registerGuest(int $seasonId, string $guestId, ?string $locale): void
    {
        Database::pdo()->prepare("INSERT INTO contest_interest_guest (season_id, guest_id, locale) VALUES (?, ?, ?)
                                  ON CONFLICT (season_id, guest_id) WHERE guest_id IS NOT NULL DO NOTHING")
            ->execute([$seasonId, $guestId, $locale]);
    }

    /** "Notify me" from the web: the email, sent once with Resend when the race starts. */
    public static function registerEmail(int $seasonId, string $email, ?string $locale): void
    {
        Database::pdo()->prepare("INSERT INTO contest_interest_guest (season_id, email, locale) VALUES (?, ?, ?)
                                  ON CONFLICT (season_id, lower(email)) WHERE email IS NOT NULL DO NOTHING")
            ->execute([$seasonId, mb_strtolower(trim($email)), $locale]);
    }

    /** A plausible email (one @, a dot in the domain, no spaces, at most 254 chars). */
    public static function validEmail(string $email): bool
    {
        $email = trim($email);
        return strlen($email) <= 254 && filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
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
            $sent += self::dispatchGuests((int) $s['id'], (bool) $s['is_test']);
            error_log('[contest-live] season ' . $s['id'] . ': ' . $sent . ' push(es) / email(s)');
        }
        return $sent;
    }

    /**
     * The people without an account who tapped "Notify me": app guests get the push on their device
     * (mobile_push_tokens by guest_id, unless that device already belongs to an account that asked
     * too), web visitors the email. Never for a test season (testers have accounts). Each row once.
     */
    private static function dispatchGuests(int $seasonId, bool $isTest): int
    {
        if ($isTest) return 0;
        $pdo  = Database::pdo();
        $rows = $pdo->prepare("UPDATE contest_interest_guest SET notified_at = now() WHERE season_id = ? AND notified_at IS NULL
                               RETURNING guest_id, email, locale");
        $rows->execute([$seasonId]);
        $sent = 0;
        foreach ($rows->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $locale = $r['locale'] ?? null;
            [$title, $body] = self::text($locale);
            try {
                if (!empty($r['guest_id'])) {
                    $tok = $pdo->prepare("SELECT token FROM mobile_push_tokens t WHERE t.guest_id = ?
                                          AND NOT EXISTS (SELECT 1 FROM contest_interest ci WHERE ci.season_id = ? AND ci.user_id = t.user_id)");
                    $tok->execute([$r['guest_id'], $seasonId]);
                    $sent += MobilePushService::sendToTokens($tok->fetchAll(\PDO::FETCH_COLUMN), $title, $body,
                        ['deepLink' => '/trip', 'seasonId' => $seasonId], self::TYPE);
                } elseif (!empty($r['email'])) {
                    $sent += self::sendEmail((string) $r['email'], $locale, $title, $body) ? 1 : 0;
                }
            } catch (\Throwable $e) {
                error_log('[contest-live] guest notify failed: ' . $e->getMessage());
            }
        }
        return $sent;
    }

    /** The one "it has started" email (Resend; skipped without RESEND_API_KEY). */
    private static function sendEmail(string $to, ?string $locale, string $title, string $body): bool
    {
        $key = getenv('RESEND_API_KEY');
        if (!$key) { error_log('[contest-live] RESEND_API_KEY not set - email skipped'); return false; }
        $l = DailyI18n::normalize($locale);
        [$button, $footer] = self::EMAIL[$l] ?? self::EMAIL['en'];
        $url = 'https://hilads.live' . ($l !== 'en' ? '/' . $l : '') . '/trip?utm_source=email&utm_medium=notify&utm_campaign=launch_trip';
        $h   = static fn(string $x): string => htmlspecialchars($x);
        $dir = $l === 'ar' ? ' dir="rtl"' : '';
        $html = '<!DOCTYPE html><html lang="' . $h($l) . '"' . $dir . '><body style="font-family:sans-serif;background:#FBF6F0;color:#241A12;margin:0;padding:40px 20px">'
            . '<div style="max-width:480px;margin:0 auto"><h2 style="margin-bottom:8px">' . $h($title) . '</h2><p>' . $h($body) . '</p>'
            . '<p style="margin:28px 0"><a href="' . $h($url) . '" style="background:#C24A38;color:#fff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:700;font-size:16px">' . $h($button) . '</a></p>'
            . '<p style="color:#6E5D4E;font-size:14px">' . $h($footer) . '</p></div></body></html>';
        $ch = curl_init('https://api.resend.com/emails');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_TIMEOUT => 10,
            CURLOPT_POSTFIELDS => json_encode(['from' => 'Hilads <no-reply@hilads.live>', 'to' => [$to], 'subject' => $title,
                                               'html' => $html, 'text' => "{$title}\n\n{$body}\n\n{$url}\n\n{$footer}"]),
            CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $key, 'Content-Type: application/json'],
        ]);
        $res = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($status < 200 || $status >= 300) { error_log('[contest-live] Resend error ' . $status . ': ' . $res); return false; }
        return true;
    }
}
