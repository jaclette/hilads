<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Represent your city (SPEC 9.16): streaks and the reminder's streak line. */
final class DailyPresenceTest extends TestCase
{
    public function testStreakEndsTodayWhenRepresented(): void
    {
        $this->assertSame(['represented' => true, 'streak' => 3],
            DailyPresence::streakFrom(['2026-10-18', '2026-10-17', '2026-10-16', '2026-10-14'], '2026-10-18'));
    }

    public function testStreakEndsYesterdayWhenNotYetRepresented(): void
    {
        // Today has no proof yet: the streak at stake is the run up to yesterday.
        $this->assertSame(['represented' => false, 'streak' => 2],
            DailyPresence::streakFrom(['2026-10-17', '2026-10-16', '2026-10-14'], '2026-10-18'));
    }

    public function testAGapDayBreaksTheStreak(): void
    {
        $this->assertSame(['represented' => false, 'streak' => 0],
            DailyPresence::streakFrom(['2026-10-16', '2026-10-15'], '2026-10-18'));
        $this->assertSame(['represented' => true, 'streak' => 1],
            DailyPresence::streakFrom(['2026-10-18', '2026-10-16'], '2026-10-18'));
        $this->assertSame(['represented' => false, 'streak' => 0], DailyPresence::streakFrom([], '2026-10-18'));
    }

    public function testReminderUsesTheCityStreakLine(): void
    {
        $c = ['challenge_date' => '2026-11-02', 'theme' => 'taste', 'text_i18n' => '{"en":"Eat what locals eat","fr":"Mange comme les locaux"}'];
        $m = DailyPushes::reminderMessage($c, 6 * 3600, 'en', 'Linh', 3, ['name' => 'Ho Chi Minh City', 'n' => 5]);
        $this->assertSame("Eat what locals eat Saigon's 5-day streak ends tonight. Will you represent it?", $m['body']);
        $fr = DailyPushes::reminderMessage($c, 6 * 3600, 'fr', null, 0, ['name' => 'Ho Chi Minh City', 'n' => 5]);
        $this->assertSame("Mange comme les locaux La série de Saigon s'arrête ce soir. Tu la représentes ?", $fr['body']);
        // Under 2 days: the usual social line.
        $one = DailyPushes::reminderMessage($c, 6 * 3600, 'en', null, 6, ['name' => 'Ho Chi Minh City', 'n' => 1]);
        $this->assertSame('Eat what locals eat 6 people already did it.', $one['body']);
    }

    public function testCityShortNames(): void
    {
        $this->assertSame('Saigon', CityNames::short('Ho Chi Minh City', 'en'));
        $this->assertSame('Sài Gòn', CityNames::short('Ho Chi Minh City', 'vi'));
        $this->assertSame('Londres', CityNames::short('London', 'fr'));
        $this->assertSame('Bangkok', CityNames::short('Bangkok', 'de'));
    }
}
