<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Provisional leaderboard (V2-01): shared ranks, minimum proofs, cities, me, top 10 push. */
final class DailyLeaderboardTest extends TestCase
{
    private static function proof(string $id, ?string $city, int $votes, int $local = 0, string $approved = '2026-11-02 09:00:00+00'): array
    {
        return ['id' => $id, 'user_id' => 'u' . $id, 'city_id' => $city, 'vote_count' => $votes,
                'local_vote_count' => $local, 'approved_at' => $approved];
    }

    private static function ranks(array $rows): array
    {
        return array_map(fn(array $r) => [$r['id'], $r['rank']], $rows);
    }

    public function testTiesOnVotesShareARankInTheOfficialOrder(): void
    {
        $ranked = DailyLeaderboard::withRanks([
            self::proof('a', null, 3, 0, '2026-11-02 09:00:00+00'),
            self::proof('b', null, 3, 1, '2026-11-02 12:00:00+00'),   // more local votes: listed first
            self::proof('c', null, 5),
            self::proof('d', null, 1),
        ]);
        $this->assertSame([['c', 1], ['b', 2], ['a', 2], ['d', 4]], self::ranks($ranked));
    }

    public function testNothingIsRankedBelowTheMinimumProofs(): void
    {
        $board = DailyLeaderboard::build(DailyLeaderboard::MIN_PROOFS - 1, [self::proof('a', null, 4)], [], [], null);
        $this->assertFalse($board['ranked']);
        $this->assertSame([], $board['world']);
        $this->assertNull($board['me']);
    }

    public function testWorldListsVotedProofsOnlyAndStopsAtTen(): void
    {
        $rows = [self::proof('zero', null, 0)];
        for ($i = 1; $i <= 12; $i++) {
            $rows[] = self::proof('p' . $i, null, $i);
        }
        $board = DailyLeaderboard::build(20, $rows, [], [], null);
        $this->assertTrue($board['ranked']);
        $this->assertCount(DailyLeaderboard::WORLD_SIZE, $board['world']);
        $this->assertSame(['p12', 1], [$board['world'][0]['id'], $board['world'][0]['rank']]);
        $this->assertNotContains('zero', array_column($board['world'], 'id'));
    }

    public function testCitiesAreLiveOnlyTopThreeBestCityFirst(): void
    {
        $board = DailyLeaderboard::build(10, [
            self::proof('a1', 'city_1', 2),
            self::proof('a2', 'city_1', 2),
            self::proof('a3', 'city_1', 1),
            self::proof('a4', 'city_1', 1),
            self::proof('b1', 'city_2', 6),
            self::proof('c1', 'city_3', 9),   // not live
            self::proof('n1', null, 4),
        ], ['city_1', 'city_2'], [], null);

        $this->assertSame(['city_2', 'city_1'], array_column($board['cities'], 0));
        $this->assertSame([['a1', 1], ['a2', 1], ['a3', 3]], self::ranks($board['cities'][1][1]));
    }

    public function testBlockedAuthorsAreHiddenWithoutRenumbering(): void
    {
        $board = DailyLeaderboard::build(10, [
            self::proof('a', 'city_1', 5),
            self::proof('b', 'city_1', 3),
            self::proof('c', 'city_1', 1),
        ], ['city_1'], ['ua'], null);
        $this->assertSame([['b', 2], ['c', 3]], self::ranks($board['world']));
        $this->assertSame([['b', 2], ['c', 3]], self::ranks($board['cities'][0][1]));
    }

    public function testMyRankSharesTiesAndCountsZeroVotes(): void
    {
        $rows = [
            self::proof('a', 'city_1', 5),
            self::proof('b', 'city_2', 3),
            self::proof('c', 'city_1', 3),
        ];
        $board = DailyLeaderboard::build(10, $rows, [], [], ['id' => 'c', 'city_id' => 'city_1', 'vote_count' => 3]);
        $this->assertSame(['proofId' => 'c', 'rank' => 2, 'cityRank' => 2, 'voteCount' => 3], $board['me']);

        // A proof with no vote shares the last rank, behind every voted proof.
        $board = DailyLeaderboard::build(10, $rows, [], [], ['id' => 'm', 'city_id' => 'city_2', 'vote_count' => 0]);
        $this->assertSame(['proofId' => 'm', 'rank' => 4, 'cityRank' => 2, 'voteCount' => 0], $board['me']);

        $board = DailyLeaderboard::build(10, $rows, [], [], ['id' => 'n', 'city_id' => null, 'vote_count' => 1]);
        $this->assertNull($board['me']['cityRank']);
    }

    public function testTop10PushNeedsTheFirstTenAndTwoVotes(): void
    {
        $rows = [];
        for ($i = 1; $i <= 11; $i++) {
            // p1..p8: 5 votes each (tied), p9: 1 vote, p10, p11: 2 votes.
            $votes  = $i <= 8 ? 5 : ($i === 9 ? 1 : 2);
            $rows[] = self::proof('p' . $i, null, $votes, 0, sprintf('2026-11-02 %02d:00:00+00', $i));
        }
        $entrants = DailyLeaderboard::pushEntrants(20, $rows);
        $ids      = array_column($entrants, 'id');

        // The first 10 in order are p1..p8, p10, p11 (p9 with 1 vote is 11th); all have 2+ votes.
        $this->assertSame(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p10', 'p11'], $ids);
        $this->assertSame(1, $entrants[0]['rank']);
        $this->assertSame(9, $entrants[8]['rank']);

        // A 1-vote proof inside the first 10 gets no push.
        $few = DailyLeaderboard::pushEntrants(20, [self::proof('a', null, 3), self::proof('b', null, 1)]);
        $this->assertSame(['a'], array_column($few, 'id'));

        $this->assertSame([], DailyLeaderboard::pushEntrants(DailyLeaderboard::MIN_PROOFS - 1, $rows));
    }

    public function testDemoProofsNeverCountForTheTop10Push(): void
    {
        $snap = ['approvedCount' => 7, 'demoCount' => 6, 'rows' => [
            ['id' => 'd1', 'user_id' => 'demo', 'vote_count' => 3, 'is_demo' => true],
            ['id' => 'r1', 'user_id' => 'real', 'vote_count' => 2, 'is_demo' => false],
        ]];
        [$count, $rows] = DailyLeaderboard::realOnly($snap);
        $this->assertSame(1, $count);
        $this->assertSame(['r1'], array_column($rows, 'id'));
        $this->assertSame([], DailyLeaderboard::pushEntrants($count, $rows));   // 1 real proof: below the minimum
    }
}
