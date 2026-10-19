<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class DailyIndexTest extends TestCase
{
    public function testWeeks(): void
    {
        $this->assertSame('2026-10-19', DailyIndex::weekStart('2026-10-19'));   // a Monday
        $this->assertSame('2026-10-19', DailyIndex::weekStart('2026-10-25'));   // its Sunday
        $this->assertSame('2026-10-12', DailyIndex::lastWeek('2026-10-19'));
        $this->assertSame('2026-10-12', DailyIndex::lastWeek('2026-10-21'));
    }

    public function testRowsNeedThreeProofsAndSortLowestFirst(): void
    {
        $rows = DailyIndex::rows([
            'city_1' => [2.8, 3.0, 2.6],
            'city_2' => [0.9, 1.1, 0.8, 0.95],
            'city_3' => [1.2, 1.4],            // 2 proofs: left out
        ]);
        $this->assertSame(['city_2', 'city_1'], array_column($rows, 'cityId'));
        $this->assertSame(0.925, $rows[0]['value']);
        $this->assertSame(4, $rows[0]['count']);
        $this->assertSame(2.8, $rows[1]['value']);
    }

    public function testTimeMediansRoundToHalfHours(): void
    {
        $rows = DailyIndex::rows(['city_1' => [1170.0, 1200.0, 1230.0, 1260.0], 'city_2' => [1080.0, 1110.0, 1080.0]], 30);
        $this->assertSame([1080.0, 1230.0], array_column($rows, 'value'));   // 18:00 and 20:30 (the median 20:15 rounds up)
    }
}
