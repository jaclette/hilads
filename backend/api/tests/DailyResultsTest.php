<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class DailyResultsTest extends TestCase
{
    private static function proof(string $id, ?string $city, int $votes, int $local, string $approved): array
    {
        return ['id' => $id, 'user_id' => 'u' . $id, 'city_id' => $city, 'vote_count' => $votes,
                'local_vote_count' => $local, 'approved_at' => $approved];
    }

    public function testTiesGoToLocalVotesThenEarliestApproval(): void
    {
        $ranked = DailyResults::rankProofs([
            self::proof('a', 'city_1', 3, 0, '2026-11-02 09:00:00+00'),
            self::proof('b', 'city_1', 3, 1, '2026-11-02 12:00:00+00'),   // same votes, one more local vote
            self::proof('c', 'city_1', 5, 0, '2026-11-02 20:00:00+00'),   // most votes
            self::proof('d', 'city_1', 3, 0, '2026-11-02 08:00:00+00'),   // ties with a, approved earlier
        ]);
        $this->assertSame(['c', 'b', 'd', 'a'], array_column($ranked, 'id'));
    }

    public function testPlanTop3NeedsVotesAndCityBestNeedsALiveCity(): void
    {
        $plan = DailyResults::plan([
            self::proof('a', 'city_1', 2, 0, '2026-11-02 09:00:00+00'),
            self::proof('b', 'city_2', 1, 0, '2026-11-02 09:00:00+00'),
            self::proof('c', 'city_2', 0, 0, '2026-11-02 08:00:00+00'),
            self::proof('d', 'city_3', 0, 0, '2026-11-02 07:00:00+00'),
            self::proof('e', null,     4, 0, '2026-11-02 07:00:00+00'),
        ], ['city_2', 'city_3']);

        // World: only proofs with a vote, at most 3.
        $this->assertSame(['e', 'a', 'b'], array_column($plan['world'], 'id'));
        // Every proof with a city is ranked in it, even with 0 votes.
        $this->assertSame(['b', 'c'], array_column($plan['cities']['city_2'], 'id'));
        $this->assertSame(['d'], array_column($plan['cities']['city_3'], 'id'));
        // Best of a city: live (city_1 is not) and at least one vote (city_3's only proof has none).
        $this->assertSame(['city_2'], array_keys($plan['cityBest']));
        $this->assertSame('b', $plan['cityBest']['city_2']['id']);
    }

    public function testWorldTop3IsEmptyWithoutVotes(): void
    {
        $plan = DailyResults::plan([self::proof('a', 'city_1', 0, 0, '2026-11-02 09:00:00+00')], ['city_1']);
        $this->assertSame([], $plan['world']);
        $this->assertSame([], $plan['cityBest']);
        $this->assertCount(1, $plan['cities']['city_1']);
    }

    public function testStreaks(): void
    {
        $dates = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-07'];
        $done  = array_flip(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06']);

        // 11-04 had no challenge: it neither counts nor breaks the streak (5 in a row).
        // Today (11-07) not done yet: the streak is still alive.
        $this->assertSame([5, 5], DailyResults::countStreaks($dates, $done, '2026-11-07'));
        // Done today too.
        $this->assertSame([6, 6], DailyResults::countStreaks($dates, $done + ['2026-11-07' => true], '2026-11-07'));
        // Missed a past day: the streak restarts after it.
        $done2 = array_flip(['2026-11-01', '2026-11-02', '2026-11-05', '2026-11-06']);
        $this->assertSame([2, 2], DailyResults::countStreaks(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06'], $done2, null));
        // Last date missed and it is not today: no current streak.
        $this->assertSame([0, 2], DailyResults::countStreaks(['2026-11-01', '2026-11-02', '2026-11-03'], array_flip(['2026-11-01', '2026-11-02']), '2026-11-04'));
        $this->assertSame([0, 0], DailyResults::countStreaks([], [], '2026-11-04'));
    }

    public function testStreakBonus(): void
    {
        $this->assertSame(0, DailyPoints::streakBonus(1, 2));    // first day: no bonus
        $this->assertSame(2, DailyPoints::streakBonus(2, 2));
        $this->assertSame(18, DailyPoints::streakBonus(10, 2));
        $this->assertSame(20, DailyPoints::streakBonus(11, 2));  // cap
        $this->assertSame(20, DailyPoints::streakBonus(40, 2));
        $this->assertSame(0, DailyPoints::streakBonus(0, 2));
    }

    public function testFreeVoteSlot(): void
    {
        $this->assertSame(1, DailyVotes::freeSlot([]));
        $this->assertSame(2, DailyVotes::freeSlot([1, 3]));
        $this->assertSame(1, DailyVotes::freeSlot([2, 3]));   // a withdrawn vote frees its slot
        $this->assertNull(DailyVotes::freeSlot([1, 2, 3]));
    }

    public function testVoteState(): void
    {
        $row = ['user_id' => 'u1', 'vote_count' => '4', 'local_vote_count' => '1', 'challenge_date' => '2026-11-02', 'my_vote' => 't'];
        $during = new DateTimeImmutable('2026-11-02 12:00', new DateTimeZone('UTC'));
        $after  = new DateTimeImmutable('2026-11-03 02:30', new DateTimeZone('UTC'));
        $this->assertSame(['voteCount' => 4, 'validatedByLocal' => true, 'myVote' => true, 'isMine' => false, 'votingOpen' => true],
            DailyVotes::stateOf($row, 'u2', $during));
        $s = DailyVotes::stateOf(['local_vote_count' => '0', 'my_vote' => 'f'] + $row, 'u1', $after);
        $this->assertSame([false, false, true, false], [$s['validatedByLocal'], $s['myVote'], $s['isMine'], $s['votingOpen']]);
        $this->assertFalse(DailyVotes::stateOf($row, null, $during)['isMine']);
    }
}
