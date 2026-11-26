<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../src/DailyClock.php';
require_once __DIR__ . '/../src/DailyProofRepository.php';
require_once __DIR__ . '/../src/Scoring.php';
require_once __DIR__ . '/../src/Contest.php';

/**
 * Launch Season: the pure standings. Since 2026-11-26 the campaign adds up the regular Hilads
 * points (play, podium, perfect week, friends) on the season's challenges, from the day a player
 * joined; the final week starts from zero plus the head-start; ties go to likes, then the first
 * to the score; only players with points are ranked.
 */
final class ContestTest extends TestCase
{
    private const SEASON = [
        'id' => 1, 'name' => 'Launch Season', 'status' => 'running', 'is_test' => true, 'paused' => false,
        'start_date' => '2026-12-01', 'final_week_start' => '2026-12-22', 'end_date' => '2026-12-28',
        'vote_cap_per_photo' => 20, 'referral_points' => 20, 'referral_min_photos' => 2, 'referral_cap' => 1,
        'headstart_top_n' => 10, 'prize_threshold_players' => 2, 'prize_threshold_photos' => 2,
    ];

    private static function p(string $id, string $joinDate = '2026-12-01', bool $dq = false): array
    {
        return ['user_id' => $id, 'username' => $id, 'joined_at' => $joinDate . ' 10:00:00+00', 'join_date' => $joinDate, 'disqualified' => $dq];
    }

    private static function e(string $user, string $date, string $kind, int $points, int $at = 1000): array
    {
        return ['user_id' => $user, 'date' => $date, 'kind' => $kind, 'points' => $points, 'at' => $at];
    }

    private static function photo(string $user, string $date, int $votes): array
    {
        return ['id' => $user . $date, 'user_id' => $user, 'date' => $date, 'votes' => $votes];
    }

    public function testRegularPointsAreAddedUpAndSplitAtTheFinalWeek(): void
    {
        $st = Contest::compute(self::SEASON, [self::p('a')], [
            self::e('a', '2026-12-02', 'daily_proof', 10), self::e('a', '2026-12-02', 'daily_top1', 30),
            self::e('a', '2026-12-06', 'perfect_week', 30), self::e('a', '2026-12-07', 'friend_joined', 10),
            self::e('a', '2026-12-07', 'crew_bonus', 50), self::e('a', '2026-12-22', 'daily_proof', 10),
            self::e('a', '2026-12-23', 'daily_top3', 10),
            self::e('a', '2026-12-23', 'daily_vote', 99),     // not a campaign kind (no vote points in v2)
        ], [], []);
        $r = $st['rows']['a'];
        self::assertSame(130, $r['seasonPoints']);
        self::assertSame(['play' => 10, 'podium' => 30, 'week' => 30, 'friends' => 60], $r['seasonBy']);
        self::assertSame(20, $r['finalPoints'], 'the final week starts from zero');
        self::assertSame(['play' => 10, 'podium' => 10, 'week' => 0, 'friends' => 0], $r['finalBy']);
    }

    public function testPointsCountFromTheDayYouJoined(): void
    {
        $st = Contest::compute(self::SEASON, [self::p('a', '2026-12-05')], [
            self::e('a', '2026-12-04', 'daily_proof', 10), self::e('a', '2026-12-05', 'daily_proof', 10),
        ], [self::photo('a', '2026-12-04', 3), self::photo('a', '2026-12-05', 2)], []);
        self::assertSame(10, $st['rows']['a']['seasonPoints']);
        self::assertSame(1, $st['rows']['a']['photos']);
        self::assertSame(2, $st['rows']['a']['seasonLikes']);
    }

    public function testFinalScoreAddsTheHeadstart(): void
    {
        $st = Contest::compute(self::SEASON, [self::p('a'), self::p('b')], [
            self::e('a', '2026-12-02', 'daily_proof', 10), self::e('b', '2026-12-22', 'daily_proof', 10),
        ], [], ['a' => 10]);
        self::assertSame(10, $st['rows']['a']['finalPoints']);
        self::assertSame(10, $st['rows']['b']['finalPoints']);
    }

    public function testTiesGoToLikesThenTheFirstToTheScore(): void
    {
        $events = [self::e('a', '2026-12-22', 'daily_proof', 10, 300), self::e('b', '2026-12-22', 'daily_proof', 10, 200),
                   self::e('c', '2026-12-22', 'daily_proof', 10, 100)];
        $photos = [self::photo('a', '2026-12-22', 5), self::photo('b', '2026-12-22', 2), self::photo('c', '2026-12-22', 2)];
        $st = Contest::compute(self::SEASON, [self::p('a'), self::p('b'), self::p('c')], $events, $photos, []);
        self::assertSame(['a', 'c', 'b'], $st['final'], 'most likes first, then the earliest to reach the score');
    }

    public function testOnlyPlayersWithPointsAreRanked(): void
    {
        $st = Contest::compute(self::SEASON, [self::p('a'), self::p('zero')], [self::e('a', '2026-12-02', 'daily_proof', 10)], [], []);
        self::assertSame(['a'], $st['season']);
        self::assertNull($st['rows']['zero']['seasonRank'], 'never "#1" with 0 points');
    }

    public function testMovementComparesWithBeforeTodaysChallenge(): void
    {
        $events = [self::e('a', '2026-12-02', 'daily_proof', 10), self::e('b', '2026-12-02', 'daily_proof', 10, 2000),
                   self::e('b', '2026-12-03', 'daily_top1', 30)];
        $st = Contest::compute(self::SEASON, [self::p('a'), self::p('b')], $events, [], [], '2026-12-03');
        self::assertSame(1, $st['rows']['b']['seasonRank']);
        self::assertSame(2, $st['rows']['b']['prevSeasonRank']);
        self::assertSame(1, $st['rows']['a']['prevSeasonRank']);
    }

    public function testDisqualifiedAreOutOfRankingsAndTheGoal(): void
    {
        $st = Contest::compute(self::SEASON, [self::p('a'), self::p('dq', '2026-12-01', true)],
            [self::e('a', '2026-12-02', 'daily_proof', 10), self::e('dq', '2026-12-02', 'daily_proof', 10)],
            [self::photo('a', '2026-12-02', 0), self::photo('a', '2026-12-03', 0), self::photo('dq', '2026-12-02', 0), self::photo('dq', '2026-12-03', 0)], []);
        self::assertSame(['a'], $st['season']);
        self::assertSame(1, $st['counter']['players']);
        self::assertFalse($st['counter']['reached']);
    }

    public function testTheGoalNeedsEnoughPlayersWithEnoughPhotos(): void
    {
        $photos = [self::photo('a', '2026-12-02', 0), self::photo('a', '2026-12-03', 0), self::photo('b', '2026-12-02', 0), self::photo('b', '2026-12-03', 0)];
        $st = Contest::compute(self::SEASON, [self::p('a'), self::p('b')], [], $photos, []);
        self::assertSame(['players' => 2, 'threshold' => 2, 'photos' => 2, 'reached' => true], $st['counter']);
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
        self::assertSame('final', Contest::racePart('over'));
        self::assertSame('season', Contest::racePart('upcoming'));
    }

    public function testFallbackPrizeAndTabDefaults(): void
    {
        self::assertSame(Contest::DEFAULT_FALLBACK['fr'], Contest::fallbackPrize(self::SEASON, 'fr'));
        self::assertSame('a souvenir pack', Contest::fallbackPrize(self::SEASON + ['fallback_prize_i18n' => ['en' => 'a souvenir pack']], 'fr'));
        self::assertSame(['label' => 'Voyage', 'icon' => 'airplane'], Contest::tab(self::SEASON, 'fr'));
        self::assertSame(['label' => 'Win', 'icon' => 'trophy'], Contest::tab(self::SEASON + ['tab' => ['icon' => 'trophy', 'label' => ['en' => 'Win']]], 'de'));
        self::assertSame('airplane', Contest::tab(self::SEASON + ['tab' => ['icon' => 'not-an-icon']], 'en')['icon']);
        self::assertCount(19, Contest::DEFAULT_TAB['label']);
        self::assertCount(19, Contest::DEFAULT_FALLBACK);
    }

    public function testRulesTemplateIsFilledFromTheSeason(): void
    {
        $md = Contest::fillRules(Contest::placeholderRules(), self::SEASON + ['souvenir' => ['enabled' => true, 'to' => 8],
                                                                               'fallback_prize_i18n' => ['en' => 'a Vietnam souvenir pack']]);
        self::assertStringNotContainsString('{{', $md, 'every placeholder is filled');
        self::assertStringContainsString('+10 points for each daily challenge you play', $md);
        self::assertStringContainsString('+30, +20 or +10 points', $md);
        self::assertStringContainsString('they receive a Vietnam souvenir pack instead of the trip', $md);
        self::assertStringContainsString('ranks 2 to 8 of the final-week ranking', $md);
        self::assertStringNotContainsString('capped at', $md, 'likes no longer score');
        self::assertStringContainsString('[TBD:', $md, 'open points stay visible until the text is final');
        self::assertStringNotContainsString('DRAFT', Contest::placeholderRules());
    }
}
