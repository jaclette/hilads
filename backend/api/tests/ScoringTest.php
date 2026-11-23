<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../src/DailyResults.php';
require_once __DIR__ . '/../src/Scoring.php';
require_once __DIR__ . '/../src/DailyClock.php';
require_once __DIR__ . '/../src/AppConfig.php';

/** Scoring v2's pure rules: the config, the World podium, Perfect weeks. */
final class ScoringTest extends TestCase
{
    private function photo(string $id, int $votes, string $at, string $user = ''): array
    {
        return ['id' => $id, 'user_id' => $user ?: 'u_' . $id, 'vote_count' => $votes, 'created_at' => $at];
    }

    public function testConfigHasEveryValue(): void
    {
        self::assertSame(10, Scoring::points('daily_proof'));
        self::assertSame([30, 20, 10], [Scoring::points('daily_top1'), Scoring::points('daily_top2'), Scoring::points('daily_top3')]);
        self::assertSame(30, Scoring::points('perfect_week'));
        self::assertSame(10, Scoring::points('friend_joined'));
        self::assertSame(50, Scoring::points('crew_bonus'));
        self::assertSame(0, Scoring::points('daily_vote'));
        self::assertNotContains('daily_vote', Scoring::config()['season_kinds']);
        self::assertSame(0, Scoring::config()['switches']['podium_min_photos']);
        self::assertFalse(Scoring::config()['switches']['vote_requires_play']);
    }

    public function testPodiumMostLikesThenPostedFirst(): void
    {
        $rows = [
            $this->photo('a', 3, '2026-11-20 10:00:00'),
            $this->photo('b', 5, '2026-11-20 12:00:00'),
            $this->photo('c', 3, '2026-11-20 09:00:00'),
            $this->photo('d', 0, '2026-11-20 08:00:00'),
            $this->photo('e', 1, '2026-11-20 08:00:00'),
        ];
        self::assertSame(['b', 'c', 'a'], array_column(Scoring::podium($rows), 'id'));
    }

    public function testPodiumNeedsALike(): void
    {
        $rows = [$this->photo('a', 2, '2026-11-20 10:00:00'), $this->photo('b', 0, '2026-11-20 09:00:00')];
        self::assertSame(['a'], array_column(Scoring::podium($rows), 'id'));
    }

    public function testPodiumMinPhotosPaysOnlyTheFirst(): void
    {
        $rows = [$this->photo('a', 2, '2026-11-20 10:00:00'), $this->photo('b', 1, '2026-11-20 09:00:00')];
        self::assertSame(['a'], array_column(Scoring::podium($rows, 1, 3), 'id'));
        self::assertSame(['a', 'b'], array_column(Scoring::podium($rows, 1, 2), 'id'));
        self::assertSame(['a', 'b'], array_column(Scoring::podium($rows, 1, 0), 'id'));
    }

    public function testWeekIsMondayToSunday(): void
    {
        self::assertSame(['2026-11-16', '2026-11-22'], Scoring::week('2026-11-22'));
        self::assertSame(['2026-11-23', '2026-11-29'], Scoring::week('2026-11-23'));
        self::assertSame(['2026-11-30', '2026-12-06'], Scoring::week('2026-12-01'));
    }

    public function testPerfectWeek(): void
    {
        $published = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'];
        $all = array_fill_keys($published, true);
        self::assertSame(['2026-11-22'], Scoring::perfectWeeks($published, $all, '2026-11-22'));

        $missing = $all;
        unset($missing['2026-11-19']);
        self::assertSame([], Scoring::perfectWeeks($published, $missing, '2026-11-22'));

        // The week is not over yet.
        self::assertSame([], Scoring::perfectWeeks($published, $all, '2026-11-21'));
    }

    public function testPerfectWeekSkipsDaysWithoutAChallenge(): void
    {
        $published = ['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
        self::assertSame(['2026-11-22'], Scoring::perfectWeeks($published, array_fill_keys($published, true), '2026-11-23'));
    }

    public function testPerfectWeekAcrossAMonth(): void
    {
        $published = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'];
        self::assertSame(['2026-12-06'], Scoring::perfectWeeks($published, array_fill_keys($published, true), '2026-12-06'));
    }

    protected function tearDown(): void
    {
        AppConfig::setSettings(null);
    }

    public function testV2StartsOnTheSwitchDate(): void
    {
        AppConfig::setSettings([]);
        self::assertNull(Scoring::since());
        self::assertFalse(Scoring::isV2('2026-11-30'));

        AppConfig::setSettings(['scoring_v2_since' => '2026-11-24']);
        self::assertFalse(Scoring::isV2('2026-11-23'));
        self::assertTrue(Scoring::isV2('2026-11-24'));
        self::assertTrue(Scoring::isV2('2026-12-01'));
    }

    public function testSwitchesDefaultOffAndFollowTheBackOffice(): void
    {
        AppConfig::setSettings([]);
        self::assertSame(0, Scoring::switch('podium_min_photos'));
        self::assertFalse(Scoring::switch('vote_requires_play'));
        AppConfig::setSettings(['scoring_podium_min_photos' => '5', 'scoring_vote_requires_play' => '1']);
        self::assertSame(5, Scoring::switch('podium_min_photos'));
        self::assertTrue(Scoring::switch('vote_requires_play'));
    }

    public function testSeasonIsTheMonthEndingAtTheDropOfTheFirst(): void
    {
        $now = new DateTimeImmutable('2026-11-23 10:00:00', new DateTimeZone('UTC'));
        $s = Scoring::season('2026-11-23', $now);
        self::assertSame('2026-11', $s['key']);
        self::assertSame('2026-11-01', $s['startsOn']);
        self::assertSame('2026-11-30', $s['endsOn']);
        self::assertSame('2026-12-01T02:00:00Z', $s['endsAt']);
        self::assertSame(8, $s['daysLeft']);
        self::assertTrue($s['pre']);

        $d = Scoring::season('2026-12-31', new DateTimeImmutable('2026-12-31 12:00:00', new DateTimeZone('UTC')));
        self::assertSame('2027-01-01T02:00:00Z', $d['endsAt']);
        self::assertSame(1, $d['daysLeft']);
        self::assertFalse($d['pre']);
    }
}
