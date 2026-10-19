<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class DailyDemoTest extends TestCase
{
    public function testPlayersForMergesADaysPlan(): void
    {
        $this->assertCount(count(DailyDemo::PLAYERS), DailyDemo::playersFor(null));
        $p = DailyDemo::playersFor(['linh' => ['caption' => 'Oldest herb shop', 'answer' => 68, 'spot' => null]]);
        $this->assertCount(1, $p);
        $this->assertSame(['linh', 'Oldest herb shop', 68, null, 'Ho Chi Minh City'], [$p[0]['key'], $p[0]['caption'], $p[0]['answer'], $p[0]['spot'], $p[0]['city']]);
    }

    public function testCleanPlanChecksDatesPlayersAndCaptions(): void
    {
        $plan = DailyDemo::cleanPlan([['date' => '2026-10-19', 'players' => ['kenji' => ['caption' => 'Senbei since 1921', 'answer' => 104]]]]);
        $this->assertSame(['2026-10-19'], array_keys($plan));
        foreach ([
            [['date' => '19/10', 'players' => ['kenji' => ['caption' => 'x']]]],
            [['date' => '2026-10-19', 'players' => []]],
            [['date' => '2026-10-19', 'players' => ['nobody' => ['caption' => 'x']]]],
            [['date' => '2026-10-19', 'players' => ['kenji' => ['caption' => '']]]],
        ] as $bad) {
            try {
                DailyDemo::cleanPlan($bad);
                $this->fail('accepted ' . json_encode($bad));
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }
}
