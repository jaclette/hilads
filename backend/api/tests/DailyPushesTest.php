<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Daily push timing (morning, reminder, digest), local days and texts. */
final class DailyPushesTest extends TestCase
{
    private static function utc(string $s): DateTimeImmutable
    {
        return new DateTimeImmutable($s, new DateTimeZone('UTC'));
    }

    private static function sendAt(string $nowUtc, string $tz): string
    {
        return DailyPushes::morningSendAt(self::utc($nowUtc), $tz)->format('Y-m-d H:i');
    }

    public function testSaigonGetsItAtTheDrop(): void
    {
        // 02:00 UTC = 09:00 in Saigon: daytime, send now.
        $this->assertSame('2026-11-02 02:00', self::sendAt('2026-11-02 02:00', 'Asia/Ho_Chi_Minh'));
    }

    public function testParisAtNightWaitsForNineLocal(): void
    {
        // 02:00 UTC = 03:00 in Paris (CET, after the DST change): wait for 09:00 = 08:00 UTC.
        $this->assertSame('2026-11-02 08:00', self::sendAt('2026-11-02 02:00', 'Europe/Paris'));
        // Same drop in summer time (CEST): 09:00 Paris = 07:00 UTC.
        $this->assertSame('2026-07-02 07:00', self::sendAt('2026-07-02 02:00', 'Europe/Paris'));
    }

    public function testNewYorkLateEveningWaitsForNextMorning(): void
    {
        // 02:00 UTC = 21:00 in New York (EST): 21:00 is outside the window -> next day 09:00 = 14:00 UTC.
        $this->assertSame('2026-11-02 14:00', self::sendAt('2026-11-02 02:00', 'America/New_York'));
    }

    public function testWindowEdges(): void
    {
        // UTC recipient: 08:59 -> 09:00 same day; 09:00 and 20:59 -> now; 21:00 and 23:00 -> next day 09:00.
        $this->assertSame('2026-11-02 09:00', self::sendAt('2026-11-02 08:59', 'UTC'));
        $this->assertSame('2026-11-02 09:00', self::sendAt('2026-11-02 09:00', 'UTC'));
        $this->assertSame('2026-11-02 20:59', self::sendAt('2026-11-02 20:59', 'UTC'));
        $this->assertSame('2026-11-03 09:00', self::sendAt('2026-11-02 21:00', 'UTC'));
        $this->assertSame('2026-11-03 09:00', self::sendAt('2026-11-02 23:00', 'UTC'));
    }

    public function testLateDropUsesTheActualRunTime(): void
    {
        // A drop that ran at 05:00 UTC reaches Paris (06:00) at 09:00 local, Saigon (12:00) right away.
        $this->assertSame('2026-11-02 08:00', self::sendAt('2026-11-02 05:00', 'Europe/Paris'));
        $this->assertSame('2026-11-02 05:00', self::sendAt('2026-11-02 05:00', 'Asia/Ho_Chi_Minh'));
    }

    public function testInvalidZoneFallsBackToUtc(): void
    {
        $this->assertSame('2026-11-02 09:00', self::sendAt('2026-11-02 02:00', 'Mars/Olympus'));
    }

    public function testTimezoneFallbackOrder(): void
    {
        $this->assertSame('Asia/Bangkok', DailyPushes::pickTimezone('Asia/Bangkok', 'Europe/Paris', 'UTC'));
        $this->assertSame('Europe/Paris', DailyPushes::pickTimezone(null, 'Europe/Paris', 'Asia/Ho_Chi_Minh'));
        $this->assertSame('Asia/Ho_Chi_Minh', DailyPushes::pickTimezone('GMT+7', '', 'Asia/Ho_Chi_Minh'));
        $this->assertSame('UTC', DailyPushes::pickTimezone(null, null, null));
    }

    public function testMorningMessageIsEnglishAndHasNoChallengeId(): void
    {
        $m = DailyPushes::morningMessage(['text_i18n' => '{"en":"Eat what locals eat"}', 'challenge_date' => '2026-11-02', 'theme' => 'taste']);
        $this->assertSame('🍜 Today: Taste', $m['title']);
        $this->assertSame('Eat what locals eat', $m['body']);
        $this->assertSame('https://hilads.live/today', $m['data']['deepLink']);
        $this->assertArrayNotHasKey('challengeId', $m['data']);
    }

    // ── Reminder and digest timing (challenge 2026-11-02: 02:00 UTC to 02:00 UTC) ──

    private static function window(): array
    {
        return [self::utc('2026-11-02 02:00'), self::utc('2026-11-03 02:00')];
    }

    private static function reminder(string $tz): ?string
    {
        [$start, $end] = self::window();
        return DailyPushes::reminderSendAt($start, $end, $tz)?->format('Y-m-d H:i');
    }

    private static function digest(string $tz): string
    {
        [$start, $end] = self::window();
        return DailyPushes::digestSendAt($start, $end, $tz)->format('Y-m-d H:i');
    }

    public function testReminderTimes(): void
    {
        $this->assertSame('2026-11-02 14:00', self::reminder('Asia/Ho_Chi_Minh'));    // 21:00 local
        $this->assertSame('2026-11-02 20:00', self::reminder('Europe/Paris'));        // 21:00 local
        $this->assertSame('2026-11-02 23:00', self::reminder('America/Los_Angeles')); // 15:00 local, end 18:00
        $this->assertSame('2026-11-02 23:00', self::reminder('Pacific/Auckland'));    // 12:00 local, end 15:00
        $this->assertSame('2026-11-02 21:00', self::reminder('UTC'));
    }

    public function testReminderIsAlwaysDaytimeAndThreeHoursBeforeTheEnd(): void
    {
        [$start, $end] = self::window();
        foreach (DateTimeZone::listIdentifiers() as $tz) {
            $at = DailyPushes::reminderSendAt($start, $end, $tz);
            $this->assertNotNull($at, $tz);
            $this->assertGreaterThanOrEqual($start, $at, $tz);
            $this->assertLessThanOrEqual($end->modify('-3 hours'), $at, $tz);
            $local = $at->setTimezone(new DateTimeZone($tz))->format('H:i');
            $this->assertTrue($local >= '09:00' && $local <= '21:00', "$tz $local");
        }
    }

    public function testDigestTimes(): void
    {
        $this->assertSame('2026-11-02 13:00', self::digest('Asia/Ho_Chi_Minh'));    // 20:00 local
        $this->assertSame('2026-11-02 19:00', self::digest('Europe/Paris'));        // 20:00 local
        $this->assertSame('2026-11-02 11:00', self::digest('Asia/Tokyo'));          // 20:00 local
        $this->assertSame('2026-11-03 01:00', self::digest('America/Los_Angeles')); // 1h before the end (17:00)
        $this->assertSame('2026-11-03 01:00', self::digest('Pacific/Auckland'));    // 1h before the end (14:00)
    }

    public function testDigestIsAlwaysDaytimeAndInsideTheChallenge(): void
    {
        [$start, $end] = self::window();
        foreach (DateTimeZone::listIdentifiers() as $tz) {
            $at = DailyPushes::digestSendAt($start, $end, $tz);
            $this->assertGreaterThanOrEqual($start->modify('+6 hours'), $at, $tz);
            $this->assertLessThanOrEqual($end->modify('-1 hour'), $at, $tz);
            $local = $at->setTimezone(new DateTimeZone($tz))->format('H:i');
            $this->assertTrue($local >= '09:00' && $local <= '20:00', "$tz $local");
        }
    }

    public function testLocalDay(): void
    {
        $at = self::utc('2026-11-02 23:30');
        $this->assertSame('2026-11-03', DailyPushes::localDay($at, 'Asia/Ho_Chi_Minh'));
        $this->assertSame('2026-11-02', DailyPushes::localDay($at, 'America/New_York'));
        $this->assertSame('2026-11-02', DailyPushes::localDay($at, 'Not/AZone'));
    }

    // ── Texts ──────────────────────────────────────────────────────────────────

    public function testOrdinals(): void
    {
        $got = array_map([DailyPushes::class, 'ordinal'], [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112]);
        $this->assertSame(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th'], $got);
    }

    private static function mine(array $o): array
    {
        return $o + ['worldRank' => null, 'cityRank' => null, 'cityBest' => false, 'votes' => 0, 'cityName' => 'Ho Chi Minh City'];
    }

    public function testOutcomeLines(): void
    {
        $this->assertSame('Yesterday your photo ranked 2nd in the world.',
            DailyPushes::outcomeLine(self::mine(['worldRank' => 2, 'cityRank' => 1, 'cityBest' => true, 'votes' => 9]), null));
        $this->assertSame('Yesterday your photo was the best in Ho Chi Minh City.',
            DailyPushes::outcomeLine(self::mine(['cityRank' => 1, 'cityBest' => true, 'votes' => 3]), null));
        $this->assertSame('Yesterday your photo ranked 4th in Ho Chi Minh City.',
            DailyPushes::outcomeLine(self::mine(['cityRank' => 4, 'votes' => 1]), null));
        $this->assertSame('Yesterday your photo got 1 vote.',
            DailyPushes::outcomeLine(self::mine(['cityName' => null, 'votes' => 1]), null));
        $this->assertNull(DailyPushes::outcomeLine(self::mine(['cityName' => null]), null));

        $winner = ['name' => 'Anh', 'cityName' => 'Ho Chi Minh City', 'votes' => 14];
        $this->assertSame("Yesterday's winner: Anh in Ho Chi Minh City, 14 votes.", DailyPushes::outcomeLine(null, $winner));
        $this->assertSame("Yesterday's winner: Anh, 1 vote.", DailyPushes::outcomeLine(null, ['cityName' => null, 'votes' => 1] + $winner));
        $this->assertNull(DailyPushes::outcomeLine(null, null));
    }

    public function testMorningMessageWithOutcome(): void
    {
        $m = DailyPushes::morningMessage(['text_i18n' => '{"en":"Eat what locals eat"}', 'challenge_date' => '2026-11-02'],
                                         "Yesterday's winner: Anh, 14 votes.");
        $this->assertSame("Eat what locals eat Yesterday's winner: Anh, 14 votes.", $m['body']);
        // No theme stored: the date's weekday theme (2026-11-02 is a Monday: Hidden gem).
        $this->assertSame('💎 Today: Hidden gem', $m['title']);
    }

    public function testMorningTourLine(): void
    {
        $c = ['text_i18n' => '{"en":"Eat what locals eat","fr":"Mange ce que mangent les locaux"}', 'challenge_date' => '2026-11-02'];
        $m = DailyPushes::morningMessage($c, "Yesterday's winner: Anh, 14 votes.", 'en', 'Ho Chi Minh City');
        $this->assertSame("Eat what locals eat Your photo represents Saigon in the world tour 🌍 Yesterday's winner: Anh, 14 votes.", $m['body']);
        $fr = DailyPushes::morningMessage($c, null, 'fr', 'Paris');
        $this->assertSame('Mange ce que mangent les locaux Ta photo représente Paris dans le tour du monde 🌍', $fr['body']);
        $this->assertNull(DailyPushes::tourLine(null));
        // Too long for the 150-character body: the challenge alone.
        $long = ['text_i18n' => json_encode(['en' => str_repeat('a', 120)]), 'challenge_date' => '2026-11-02'];
        $this->assertSame(str_repeat('a', 120), DailyPushes::morningMessage($long, null, 'en', 'Paris')['body']);
    }

    public function testMorningAsksTheQuestionForMyCity(): void
    {
        $c = ['text_i18n' => '{"en":"Find a bar","fr":"Trouve un bar"}', 'challenge_date' => '2026-11-02', 'theme' => 'sip',
              'compare_type' => 'word', 'compare_question_i18n' => '{"en":"How do locals say cheers?","fr":"Comment les locaux trinquent-ils ?"}'];
        $m = DailyPushes::morningMessage($c, null, 'en', null, 'Ho Chi Minh City');
        $this->assertSame("🍹 Today's question", $m['title']);
        $this->assertSame("How do locals say cheers? Play for Saigon.", $m['body']);
        $fr = DailyPushes::morningMessage($c, null, 'fr', null, 'Paris');
        $this->assertSame("🍹 La question du jour", $fr['title']);
        $this->assertSame('Comment les locaux trinquent-ils ? Joue pour Paris.', $fr['body']);
        // No city: the theme title over the challenge text.
        $this->assertSame('Find a bar', DailyPushes::morningMessage($c)['body']);
    }

    public function testVoteReminderNamesTwoOtherCities(): void
    {
        $c = ['text_i18n' => '{"en":"Find a bar"}', 'challenge_date' => '2026-11-02', 'theme' => 'sip'];
        $m = DailyPushes::voteReminderMessage($c, 6 * 3600, 'Lisbon', 'Mexico City');
        $this->assertSame('🍹 Drinks · 6h left', $m['title']);
        $this->assertSame('Lisbon and Mexico City played today. Go see their photos.', $m['body']);
        $this->assertSame(['compare', 'vote_reminder'], [$m['data']['tab'], $m['pushType']]);
        $this->assertSame("Lisbonne et Mexico ont joué aujourd'hui. Va voir leurs photos.", DailyPushes::voteReminderMessage($c, 3600, 'Lisbon', 'Mexico City', 'fr')['body']);

        $cities = [['id' => 'city_5', 'name' => 'Saigon'], ['id' => 'city_62', 'name' => 'Lisbon'], ['id' => 'city_4', 'name' => 'Tokyo']];
        $this->assertSame(['Lisbon', 'Tokyo'], DailyPushes::waitingCities($cities, 'city_5'));
        $this->assertSame(['Saigon', 'Lisbon'], DailyPushes::waitingCities($cities, null));
        $this->assertNull(DailyPushes::waitingCities(array_slice($cities, 0, 2), 'city_5'));
    }

    public function testFirstVoteNamesTheVotersCity(): void
    {
        $this->assertSame('Someone in Lisbon voted for your photo.', DailyPushes::firstVoteMessage('2026-11-02', 'p1', 'en', 'Lisbon')['body']);
        $this->assertSame('Linh voted for your photo.', DailyPushes::firstVoteMessage('2026-11-02', 'p1', 'en', 'Lisbon', 'Linh')['body']);
        $this->assertSame('Linh a voté pour ta photo.', DailyPushes::firstVoteMessage('2026-11-02', 'p1', 'fr', 'Lisbon', 'Linh')['body']);
        $this->assertSame('Quelqu\'un à Saigon a voté pour ta photo.', DailyPushes::firstVoteMessage('2026-11-02', 'p1', 'fr', 'Ho Chi Minh City')['body']);
    }

    public function testReminderWorldLine(): void
    {
        $m = DailyPushes::reminderMessage(self::SHRINE, 3600, 'en', null, 9, null, ['n' => 5, 'city' => 'Ho Chi Minh City']);
        $this->assertSame('Find a shrine and ask a local what it means. Already 5 countries played. Saigon, your move.', $m['body']);
        $fr = DailyPushes::reminderMessage(self::SHRINE, 3600, 'fr', null, 9, null, ['n' => 5, 'city' => 'Paris']);
        $this->assertStringEndsWith('Déjà 5 pays ont joué. Paris, à toi de jouer.', $fr['body']);
        // A city streak to save keeps the Represent your city line.
        $streak = DailyPushes::reminderMessage(self::SHRINE, 3600, 'en', null, 9, ['name' => 'Paris', 'n' => 4], ['n' => 5, 'city' => 'Paris']);
        $this->assertStringContainsString("Paris has played 4 days in a row", $streak['body']);
    }

    private const SHRINE = ['challenge_date' => '2026-11-02', 'theme' => 'only_here',
                            'text_i18n' => '{"en":"Find a shrine and ask a local what it means.","fr":"Trouve un autel et demande à un local ce qu\u2019il signifie."}'];

    public function testReminderMessage(): void
    {
        // Hours to the nearest hour: 21:00 with 11h59m left reads 12h, not 11h.
        $m = DailyPushes::reminderMessage(self::SHRINE, 11 * 3600 + 59 * 60);
        $this->assertSame('📍 Only here · 12h left', $m['title']);
        $this->assertSame('Find a shrine and ask a local what it means.', $m['body']);
        $this->assertSame(['date' => '2026-11-02', 'deepLink' => 'https://hilads.live/today'], $m['data']);
        $this->assertSame('📍 Only here · 1h left', DailyPushes::reminderMessage(self::SHRINE, 600)['title']);
        // A stored v1 key reads as its v2 theme.
        $this->assertSame('📍 Only here · 1h left', DailyPushes::reminderMessage(['theme' => 'traditions'] + self::SHRINE, 600)['title']);
    }

    public function testReminderNamesAFriendOrCountsPeople(): void
    {
        $t = 'Find a shrine and ask a local what it means.';
        $this->assertSame("{$t} Linh and 11 others already did it.", DailyPushes::reminderMessage(self::SHRINE, 6 * 3600, 'en', 'Linh', 12)['body']);
        $this->assertSame("{$t} Linh and 1 other already did it.", DailyPushes::reminderMessage(self::SHRINE, 6 * 3600, 'en', 'Linh', 2)['body']);
        $this->assertSame("{$t} Linh already did it.", DailyPushes::reminderMessage(self::SHRINE, 6 * 3600, 'en', 'Linh', 1)['body']);
        $this->assertSame("{$t} 6 people already did it.", DailyPushes::reminderMessage(self::SHRINE, 6 * 3600, 'en', null, 6)['body']);
        $this->assertSame("{$t} 1 person already did it.", DailyPushes::reminderMessage(self::SHRINE, 6 * 3600, 'en', null, 1)['body']);
        $fr = DailyPushes::reminderMessage(self::SHRINE, 6 * 3600, 'fr', null, 6);
        $this->assertSame('📍 Seulement ici · plus que 6 h', $fr['title']);
        $this->assertSame("Trouve un autel et demande à un local ce qu’il signifie. 6 personnes l'ont déjà relevé.", $fr['body']);
    }

    public function testALongBodyDropsItsExtraLine(): void
    {
        $long = str_repeat('word ', 26) . 'end.';   // 134 characters
        $c = ['challenge_date' => '2026-11-02', 'theme' => 'sip', 'text_i18n' => json_encode(['en' => $long])];
        $this->assertSame($long, DailyPushes::reminderMessage($c, 6 * 3600, 'en', null, 12)['body']);
        $this->assertSame($long, DailyPushes::morningMessage($c, "Yesterday's winner: Anh in Saigon, 14 votes.")['body']);
        $this->assertSame('Hi 12 people already did it.', DailyPushes::withLine('Hi', '12 people already did it.'));
    }

    public function testFirstVoteMessageOpensTheProof(): void
    {
        $m = DailyPushes::firstVoteMessage('2026-11-02', 'p1');
        $this->assertSame('Your photo got its first vote!', $m['body']);
        $this->assertSame('p1', $m['data']['proofId']);
        $this->assertSame('2026-11-02', $m['data']['date']);
        $this->assertSame('Ta photo a reçu son premier vote !', DailyPushes::firstVoteMessage('2026-11-02', 'p1', 'fr')['body']);
    }

    public function testProposalPushesInTheAuthorsLanguage(): void
    {
        $this->assertSame('Your challenge goes live on Monday, November 2.', DailyPushes::proposalApprovedMessage('2026-11-02')['body']);
        $this->assertSame('Ton challenge sera en ligne le 2026-11-02.', DailyPushes::proposalApprovedMessage('2026-11-02', 'fr')['body']);
        $this->assertSame('1 person completed your challenge.', DailyPushes::proposalResultMessage('2026-11-02', 1)['body']);
        $this->assertSame('1 personne a relevé ton challenge.', DailyPushes::proposalResultMessage('2026-11-02', 1, 'fr')['body']);
        $this->assertSame('4 personnes ont relevé ton challenge.', DailyPushes::proposalResultMessage('2026-11-02', 4, 'fr')['body']);
    }

    public function testDigestMessage(): void
    {
        $this->assertSame('3 people voted for your photo. 5 people completed your Local Twist.',
            DailyPushes::digestMessage('2026-11-02', 3, 5)['body']);
        $this->assertSame('1 person voted for your photo.', DailyPushes::digestMessage('2026-11-02', 1, 0)['body']);
        $this->assertSame('1 person completed your Local Twist.', DailyPushes::digestMessage('2026-11-02', 0, 1)['body']);
        $this->assertNull(DailyPushes::digestMessage('2026-11-02', 0, 0));
    }

    public function testTop10Text(): void
    {
        $m = DailyPushes::top10Message('2026-11-02', 4);
        $this->assertSame("You're in today's top 10! Your photo is #4 in the world right now.", $m['body']);
        $this->assertSame('2026-11-02', $m['data']['date']);
        $this->assertSame('Tu es dans le top 10 du jour ! Ta photo est #4 dans le monde en ce moment.',
                          DailyPushes::top10Message('2026-11-02', 4, 'fr')['body']);
    }

    public function testSpeedBonusWindowFollowsTheMorningPushRule(): void
    {
        // Drop 02:00 UTC. Saigon (09:00 local): start = the drop, bonus until 05:00 UTC (12:00 local).
        $this->assertSame('2026-11-02 05:00', DailyPushes::earlyUntil('2026-11-02', 'Asia/Ho_Chi_Minh')->format('Y-m-d H:i'));
        // Paris (03:00 local, CET): start = 09:00 local = 08:00 UTC, bonus until 11:00 UTC.
        $this->assertSame('2026-11-02 08:00', DailyPushes::startAt('2026-11-02', 'Europe/Paris')->format('Y-m-d H:i'));
        $this->assertSame('2026-11-02 11:00', DailyPushes::earlyUntil('2026-11-02', 'Europe/Paris')->format('Y-m-d H:i'));
        // New York (21:00 local, EST): start = next day 09:00 local = 14:00 UTC, until 17:00 UTC.
        $this->assertSame('2026-11-02 17:00', DailyPushes::earlyUntil('2026-11-02', 'America/New_York')->format('Y-m-d H:i'));

        $this->assertTrue(DailyPushes::isEarly('2026-11-02', 'Europe/Paris', self::utc('2026-11-02 03:00')));   // night, before the start
        $this->assertTrue(DailyPushes::isEarly('2026-11-02', 'Europe/Paris', self::utc('2026-11-02 11:00')));   // last second
        $this->assertFalse(DailyPushes::isEarly('2026-11-02', 'Europe/Paris', self::utc('2026-11-02 11:01')));
        $this->assertFalse(DailyPushes::isEarly('2026-11-02', 'Asia/Ho_Chi_Minh', self::utc('2026-11-02 05:30')));
    }
}
