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
        $m = DailyPushes::morningMessage(['text_i18n' => '{"en":"Eat what locals eat"}', 'challenge_date' => '2026-11-02']);
        $this->assertSame("Today's Daily Challenge: Eat what locals eat", $m['body']);
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
        $this->assertSame('Yesterday your proof ranked 2nd in the world 🏆',
            DailyPushes::outcomeLine(self::mine(['worldRank' => 2, 'cityRank' => 1, 'cityBest' => true, 'votes' => 9]), null));
        $this->assertSame('Yesterday your proof was the best in Ho Chi Minh City 🔥',
            DailyPushes::outcomeLine(self::mine(['cityRank' => 1, 'cityBest' => true, 'votes' => 3]), null));
        $this->assertSame('Yesterday your proof ranked 4th in Ho Chi Minh City.',
            DailyPushes::outcomeLine(self::mine(['cityRank' => 4, 'votes' => 1]), null));
        $this->assertSame('Yesterday your proof got 1 vote.',
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
        $this->assertSame("Yesterday's winner: Anh, 14 votes. Today's Daily Challenge: Eat what locals eat", $m['body']);
    }

    public function testReminderMessage(): void
    {
        $m = DailyPushes::reminderMessage('2026-11-02', 6 * 3600 + 59 * 60);
        $this->assertSame("Only 6h left for today's Daily Challenge.", $m['body']);
        $this->assertSame(['date' => '2026-11-02', 'deepLink' => 'https://hilads.live/today'], $m['data']);
        $this->assertSame("Only 1h left for today's Daily Challenge.", DailyPushes::reminderMessage('2026-11-02', 600)['body']);
    }

    public function testDigestMessage(): void
    {
        $this->assertSame('3 people voted for your proof. 5 people completed your Local Twist.',
            DailyPushes::digestMessage('2026-11-02', 3, 5)['body']);
        $this->assertSame('1 person voted for your proof.', DailyPushes::digestMessage('2026-11-02', 1, 0)['body']);
        $this->assertSame('1 person completed your Local Twist.', DailyPushes::digestMessage('2026-11-02', 0, 1)['body']);
        $this->assertNull(DailyPushes::digestMessage('2026-11-02', 0, 0));
    }

    public function testTop10Text(): void
    {
        $m = DailyPushes::top10Message('2026-11-02', 4);
        $this->assertSame("You're in today's top 10! 🏆 Your proof is #4 in the world right now.", $m['body']);
        $this->assertSame('2026-11-02', $m['data']['date']);
        $this->assertSame('Tu es dans le top 10 du jour ! 🏆 Ta preuve est #4 dans le monde en ce moment.',
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
