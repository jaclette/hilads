<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../src/DailyClock.php';
require_once __DIR__ . '/../src/DailyProofRepository.php';
require_once __DIR__ . '/../src/Contest.php';

/** Launch Season: the pure standings (votes cap, referrals, head-start, ties, counter). */
final class ContestTest extends TestCase
{
    private const SEASON = [
        'id' => 1, 'name' => 'Launch Season', 'status' => 'running', 'is_test' => true, 'paused' => false,
        'start_date' => '2026-12-01', 'final_week_start' => '2026-12-22', 'end_date' => '2026-12-28',
        'vote_cap_per_photo' => 20, 'referral_points' => 20, 'referral_min_photos' => 2, 'referral_cap' => 1,
        'headstart_top_n' => 10, 'prize_threshold_players' => 500, 'prize_threshold_photos' => 2,
    ];

    private static function p(string $id, string $joined = '2026-12-01 10:00:00+00', ?string $by = null, ?string $at = null, bool $dq = false, ?string $blocked = null): array
    {
        return ['user_id' => $id, 'username' => $id, 'joined_at' => $joined, 'disqualified' => $dq,
                'invited_by_user_id' => $by, 'invited_at' => $at, 'ref_blocked' => $blocked];
    }

    private static function photo(string $user, string $date, int $votes): array
    {
        return ['id' => $user . $date, 'user_id' => $user, 'date' => $date, 'votes' => $votes];
    }

    public function testVotesAreCappedPerPhotoAndSplitAtTheFinalWeek(): void
    {
        $s = Contest::compute(self::SEASON, [self::p('a')], [
            self::photo('a', '2026-12-02', 35),   // capped at 20
            self::photo('a', '2026-12-21', 5),    // last day before the final week: season
            self::photo('a', '2026-12-22', 7),    // final week
        ], []);
        $a = $s['rows']['a'];
        self::assertSame(25, $a['seasonVotes']);
        self::assertSame(7, $a['finalVotes']);
        self::assertSame(47, $a['allVotes']);
        self::assertSame(3, $a['days']);
        self::assertSame(25, $a['seasonPoints']);
        self::assertSame(7, $a['finalPoints']);
    }

    public function testReferralNeedsTheSeasonWindowJoinOrderDeviceAndPhotos(): void
    {
        $in = '2026-12-02 08:00:00+00';
        $s = Contest::compute(self::SEASON, [
            self::p('a'),
            self::p('b', '2026-12-02 09:00:00+00', 'a', $in),                       // active
            self::p('c', '2026-12-02 09:00:00+00', 'a', '2026-11-20 08:00:00+00'),  // invited before the season
            self::p('d', '2026-12-02 07:00:00+00', 'a', $in),                       // joined before the invite
            self::p('e', '2026-12-02 09:00:00+00', 'a', $in, false, 'same_device'),
            self::p('f', '2026-12-02 09:00:00+00', 'a', $in),                       // 1 photo: pending
            self::p('g', '2026-12-02 09:00:00+00', 'a', $in, true),                 // disqualified
        ], [
            self::photo('b', '2026-12-03', 0), self::photo('b', '2026-12-04', 0),
            self::photo('c', '2026-12-03', 0), self::photo('c', '2026-12-04', 0),
            self::photo('d', '2026-12-03', 0), self::photo('d', '2026-12-04', 0),
            self::photo('e', '2026-12-03', 0), self::photo('e', '2026-12-04', 0),
            self::photo('f', '2026-12-03', 0),
            self::photo('g', '2026-12-03', 0), self::photo('g', '2026-12-04', 0),
        ], []);
        $status = array_column($s['rows']['a']['referralFriends'], 'status', 'userId');
        self::assertSame(['b' => 'active', 'c' => 'before_season', 'd' => 'invited_after_join', 'e' => 'same_device',
                          'f' => 'pending', 'g' => 'disqualified'], $status);
        self::assertSame(1, $s['rows']['a']['referrals']);
        self::assertSame(20, $s['rows']['a']['referralBonus']);
        self::assertSame(20, $s['rows']['a']['seasonPoints']);
    }

    public function testReferralBonusIsCapped(): void
    {
        $in = '2026-12-02 08:00:00+00';
        $people = [self::p('a')];
        $photos = [];
        foreach (['b', 'c', 'd'] as $f) {
            $people[] = self::p($f, '2026-12-02 09:00:00+00', 'a', $in);
            $photos[] = self::photo($f, '2026-12-03', 0);
            $photos[] = self::photo($f, '2026-12-04', 0);
        }
        $s = Contest::compute(self::SEASON, $people, $photos, []);
        self::assertSame(3, $s['rows']['a']['referrals']);
        self::assertSame(1, $s['rows']['a']['referralsCounted']);
        self::assertSame(20, $s['rows']['a']['referralBonus']);
    }

    public function testInviterOutsideTheContestEarnsNothing(): void
    {
        $s = Contest::compute(self::SEASON, [self::p('b', '2026-12-02 09:00:00+00', 'zz', '2026-12-02 08:00:00+00')],
                              [self::photo('b', '2026-12-03', 0), self::photo('b', '2026-12-04', 0)], []);
        self::assertSame(0, $s['rows']['b']['referralBonus']);
    }

    public function testFinalScoreAddsHeadstartAndReferralOnly(): void
    {
        $s = Contest::compute(self::SEASON, [self::p('a'), self::p('b')], [
            self::photo('a', '2026-12-05', 20), self::photo('a', '2026-12-23', 3),
            self::photo('b', '2026-12-05', 1),  self::photo('b', '2026-12-23', 10),
        ], ['a' => 10, 'b' => 9]);
        self::assertSame(['a', 'b'], $s['season']);
        self::assertSame(13, $s['rows']['a']['finalPoints']);
        self::assertSame(19, $s['rows']['b']['finalPoints']);
        self::assertSame(['b', 'a'], $s['final']);
        self::assertSame(1, $s['rows']['b']['finalRank']);
    }

    public function testTiesBreakOnDaysThenAllVotesThenEarliestJoin(): void
    {
        $s = Contest::compute(['vote_cap_per_photo' => 10] + self::SEASON, [
            self::p('late',  '2026-12-01 12:00:00+00'),
            self::p('early', '2026-12-01 08:00:00+00'),
            self::p('days',  '2026-12-01 13:00:00+00'),
            self::p('votes', '2026-12-01 14:00:00+00'),
        ], [
            self::photo('late', '2026-12-02', 10),
            self::photo('early', '2026-12-02', 10),
            self::photo('days', '2026-12-02', 5), self::photo('days', '2026-12-03', 5),
            self::photo('votes', '2026-12-02', 30),   // 10 capped, 30 overall
        ], []);
        // All on 10 points: 2 days first, then 30 likes overall, then the earliest join.
        self::assertSame(['days', 'votes', 'early', 'late'], $s['season']);
    }

    public function testDisqualifiedAreOutOfRankingsAndCounter(): void
    {
        $s = Contest::compute(self::SEASON, [self::p('a'), self::p('b', '2026-12-01 10:00:00+00', null, null, true)], [
            self::photo('a', '2026-12-02', 1), self::photo('a', '2026-12-03', 1),
            self::photo('b', '2026-12-02', 50), self::photo('b', '2026-12-03', 50),
        ], []);
        self::assertSame(['a'], $s['season']);
        self::assertSame(1, $s['counter']['players']);
        self::assertSame(2, $s['totals']['participants']);
    }

    public function testCounterNeedsEnoughPhotos(): void
    {
        $s = Contest::compute(self::SEASON, [self::p('a'), self::p('b')], [
            self::photo('a', '2026-12-02', 0), self::photo('a', '2026-12-03', 0), self::photo('b', '2026-12-02', 0),
        ], []);
        self::assertSame(['players' => 1, 'threshold' => 500, 'photos' => 2], $s['counter']);
    }

    public function testHeadstartPoints(): void
    {
        self::assertSame(10, Contest::headstartPoints(1, 10));
        self::assertSame(1, Contest::headstartPoints(10, 10));
        self::assertSame(0, Contest::headstartPoints(11, 10));
        self::assertSame(3, Contest::headstartPoints(1, 3));
        self::assertSame(0, Contest::headstartPoints(1, 0));
    }

    public function testPhase(): void
    {
        $s = self::SEASON;
        self::assertSame('upcoming', Contest::phase($s, '2026-11-30'));
        self::assertSame('season', Contest::phase($s, '2026-12-01'));
        self::assertSame('season', Contest::phase($s, '2026-12-21'));
        self::assertSame('final', Contest::phase($s, '2026-12-22'));
        self::assertSame('final', Contest::phase($s, '2026-12-28'));
        self::assertSame('over', Contest::phase($s, '2026-12-29'));
        self::assertSame('draft', Contest::phase(['status' => 'draft'] + $s, '2026-12-05'));
        self::assertSame('ended', Contest::phase(['status' => 'ended'] + $s, '2026-12-05'));
    }

    public function testRulesTemplateIsFilledFromTheSeason(): void
    {
        $md = Contest::fillRules(Contest::placeholderRules(), self::SEASON + ['souvenir' => ['enabled' => true, 'to' => 8]]);
        self::assertStringNotContainsString('{{', $md, 'every placeholder is filled');
        self::assertStringContainsString('capped at ' . self::SEASON['vote_cap_per_photo'] . ' points per photo', $md);
        self::assertStringContainsString('ranks 2 to 8 of the final-week leaderboard', $md);
        self::assertStringContainsString('[TBD:', $md, 'open points stay visible until the text is final');
        // The DRAFT banner is the page's (until Final is ticked), not part of the text.
        self::assertStringNotContainsString('DRAFT', Contest::placeholderRules());
    }
}
