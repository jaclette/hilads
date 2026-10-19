<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class DailyTourTest extends TestCase
{
    private static function p(string $id, string $city, int $votes, string $approved = '2026-10-19 03:00:00'): array
    {
        return ['id' => $id, 'city_id' => $city, 'vote_count' => $votes, 'local_vote_count' => 0, 'approved_at' => $approved];
    }

    public function testOneSlidePerCityWithItsBestProof(): void
    {
        $slides = DailyTour::slides([
            self::p('a1', 'city_1', 2), self::p('a2', 'city_1', 7), self::p('a3', 'city_1', 0),
            self::p('b1', 'city_2', 1),
            self::p('c1', 'city_3', 9),
        ], ['c1', 'a2']);
        $byCity = array_column($slides, null, 'cityId');
        $this->assertCount(3, $slides);
        $this->assertSame('a2', $byCity['city_1']['proofId']);
        $this->assertSame(3, $byCity['city_1']['count']);
        $this->assertSame(2, $byCity['city_1']['podium']);
        $this->assertSame(1, $byCity['city_3']['podium']);
        $this->assertNull($byCity['city_2']['podium']);
    }

    public function testOrderPodiumThenViewerCityThenOthers(): void
    {
        $slides = [
            ['cityId' => 'city_4', 'proofId' => 'd', 'count' => 5, 'podium' => null],
            ['cityId' => 'city_2', 'proofId' => 'b', 'count' => 1, 'podium' => null],
            ['cityId' => 'city_3', 'proofId' => 'c', 'count' => 1, 'podium' => 2],
            ['cityId' => 'city_1', 'proofId' => 'a', 'count' => 9, 'podium' => 1],
            ['cityId' => 'city_5', 'proofId' => 'e', 'count' => 2, 'podium' => null],
        ];
        $this->assertSame(['city_1', 'city_3', 'city_2', 'city_4', 'city_5'], array_column(DailyTour::order($slides, 'city_2'), 'cityId'));
        $this->assertSame(['city_1', 'city_3', 'city_4', 'city_5', 'city_2'], array_column(DailyTour::order($slides, null), 'cityId'));
    }

    public function testMomentBuckets(): void
    {
        $this->assertSame('night', DailyTour::moment(3));
        $this->assertSame('morning', DailyTour::moment(5));
        $this->assertSame('morning', DailyTour::moment(11));
        $this->assertSame('afternoon', DailyTour::moment(12));
        $this->assertSame('evening', DailyTour::moment(21));
        $this->assertSame('night', DailyTour::moment(22));
    }
}
