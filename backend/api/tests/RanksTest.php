<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../src/Ranks.php';

/** V6 Ranks: periods and ranking helpers. */
final class RanksTest extends TestCase
{
    public function testPeriods(): void
    {
        $this->assertSame(['2026-11-06', '2026-11-06'], Ranks::dates('today', '2026-11-06'));
        $this->assertSame(['2026-11-05', '2026-11-05'], Ranks::dates('yesterday', '2026-11-06'));
        $this->assertNull(Ranks::dates('alltime', '2026-11-06'));
        [$from, $to] = Ranks::dates('week', '2026-11-06');   // a Friday
        $this->assertSame('2026-11-02', $from);
        $this->assertSame('2026-11-08', $to);
    }

    public function testRankByKeepsOrderAndSkipsZeros(): void
    {
        $rows = [['id' => 'a', 'p' => 30], ['id' => 'b', 'p' => 20], ['id' => 'c', 'p' => 0]];
        $this->assertSame(['a' => 1, 'b' => 2], Ranks::rankBy($rows, 'id', 'p'));
    }

    public function testMyBestPhotoRankAndLikesToPassTheOneAbove(): void
    {
        $rows = [
            ['id' => 'a', 'user_id' => 'x',  'votes' => 5, 'comments' => 1, 'at' => 10],
            ['id' => 'b', 'user_id' => 'y',  'votes' => 4, 'comments' => 2, 'at' => 20],
            ['id' => 'c', 'user_id' => 'me', 'votes' => 4, 'comments' => 2, 'at' => 30],
            ['id' => 'd', 'user_id' => 'me', 'votes' => 1, 'comments' => 0, 'at' => 5],
            ['id' => 'e', 'user_id' => 'z',  'votes' => 1, 'comments' => 3, 'at' => 50],
        ];
        // My best is #3, tied on likes and comments with #2 but posted later: one more like passes it.
        $this->assertSame(['rank' => 3, 'proofId' => 'c', 'votes' => 4, 'comments' => 2, 'gap' => 1], Ranks::myBestPhoto($rows, 'me'));
        // Fewer likes but more comments than the one above: the likes difference is enough.
        $this->assertSame(1, Ranks::myBestPhoto([$rows[3], $rows[4]], 'z')['gap'] ?? null);
        $this->assertNull(Ranks::myBestPhoto($rows, 'x')['gap']);
        $this->assertNull(Ranks::myBestPhoto($rows, 'nobody'));
    }
}
