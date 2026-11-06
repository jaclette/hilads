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
}
