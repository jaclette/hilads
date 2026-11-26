<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Launch Season isolation: the contest code only READS the permanent score (score_events),
 * never writes it, never sends
 * a push or a notification (one exception: ContestNotify's single "season is live" push to the
 * Notify-me taps), and only writes contest_* tables. A source check, so a later change that
 * breaks the rule fails here.
 */
final class ContestIsolationTest extends TestCase
{
    private static function sources(bool $withNotify = false): array
    {
        $root = __DIR__ . '/..';
        $files = [$root . '/src/Contest.php'];
        foreach (glob($root . '/admin/contest*.php') ?: [] as $f) $files[] = $f;
        if ($withNotify) $files[] = $root . '/src/ContestNotify.php';
        // Code only: the comments may name what the contest never touches.
        $code = static function (string $f): string {
            $out = '';
            foreach (token_get_all((string) file_get_contents($f)) as $t) {
                if (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true)) continue;
                $out .= is_array($t) ? $t[1] : $t;
            }
            return $out;
        };
        return array_combine($files, array_map($code, $files));
    }

    public function testNoPermanentScoreWriteNoPushNoNotification(): void
    {
        foreach (self::sources() as $file => $src) {
            // The campaign READS the regular points (score_events) since 2026-11-26; writing them is
            // caught by testWritesOnlyContestTables, and any other use of the table here fails below.
            preg_match_all('/\bscore_events\b/', $src, $all);
            preg_match_all('/\b(?:FROM|JOIN)\s+score_events\b/i', $src, $reads);
            self::assertSame(count($all[0]), count($reads[0]), basename($file) . ' only reads score_events (FROM / JOIN)');
            foreach (['MonthlyRankService', 'PushService', 'MobilePushService', 'PushBroadcastService',
                      'NotificationRepository', 'DailyNotify', 'DailyPushes', 'Invites::notify', 'score_alltime', 'score_month'] as $needle) {
                self::assertFalse(str_contains($src, $needle), basename($file) . " must not use {$needle}");
            }
        }
    }

    public function testTheOnlyPushIsTheLiveNotice(): void
    {
        $src = self::sources(true)[__DIR__ . '/../src/ContestNotify.php'];
        // The same live notice reaches app guests (no account, so no bell row): their device tokens, once.
        self::assertSame(1, substr_count($src, 'MobilePushService::'), 'ContestNotify pushes guests in one place');
        self::assertSame(1, substr_count($src, 'MobilePushService::sendToTokens('), 'ContestNotify pushes guests by token only');
        self::assertMatchesRegularExpression('/sendToTokens\([^;]*self::TYPE\)/s', $src, 'the guest push is the live notice');
        $src = str_replace('MobilePushService::sendToTokens(', '', $src);
        foreach (['score_events', 'MonthlyRankService', 'PushService', 'MobilePushService', 'PushBroadcastService',
                  'DailyNotify', 'DailyPushes', 'score_alltime', 'score_month'] as $needle) {
            self::assertFalse(str_contains($src, $needle), "ContestNotify.php must not use {$needle}");
        }
        self::assertSame(1, substr_count($src, 'NotificationRepository::'), 'ContestNotify sends exactly one kind of notification');
        self::assertStringContainsString("TYPE = 'contest_live'", $src);
    }

    public function testWritesOnlyContestTables(): void
    {
        foreach (self::sources(true) as $file => $src) {
            preg_match_all('/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_]+)/i', $src, $m, PREG_SET_ORDER);
            foreach ($m as $hit) {
                if (strtoupper($hit[1]) === 'UPDATE' && in_array(strtolower($hit[2]), ['set'], true)) continue;   // ON CONFLICT DO UPDATE SET
                self::assertStringStartsWith('contest_', strtolower($hit[2]), basename($file) . ' writes ' . $hit[2]);
            }
        }
    }
}
