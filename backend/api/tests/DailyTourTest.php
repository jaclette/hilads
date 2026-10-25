<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class DailyTourTest extends TestCase
{
    private static function p(string $id, string $city, int $votes, string $approved = '2026-10-19 03:00:00'): array
    {
        return ['id' => $id, 'city_id' => $city, 'vote_count' => $votes, 'local_vote_count' => 0, 'approved_at' => $approved];
    }

    public function testEverySlideGroupedByCityBestFirst(): void
    {
        $slides = DailyTour::slides([
            self::p('a1', 'city_1', 2), self::p('a2', 'city_1', 7), self::p('a3', 'city_1', 0),
            self::p('b1', 'city_2', 1),
            self::p('c1', 'city_3', 9),
            // A tie: the earliest posted first.
            self::p('d2', 'city_4', 1, '2026-10-19 05:00:00'), self::p('d1', 'city_4', 1, '2026-10-19 04:00:00'),
        ], ['c1', 'a2']);
        $this->assertSame(['a2', 'a1', 'a3', 'b1', 'c1', 'd1', 'd2'], array_column($slides, 'proofId'));
        $byProof = array_column($slides, null, 'proofId');
        $this->assertSame(3, $byProof['a3']['count']);
        $this->assertSame(0, $byProof['a2']['rank']);
        $this->assertSame(2, $byProof['a3']['rank']);
        $this->assertSame(2, $byProof['a2']['podium']);
        $this->assertSame(1, $byProof['c1']['podium']);
        $this->assertNull($byProof['a1']['podium']);
    }

    public function testOrderPodiumCitiesThenViewerCityThenOthersEachBestFirst(): void
    {
        $slides = [
            ['cityId' => 'city_4', 'proofId' => 'd', 'count' => 5, 'rank' => 0, 'podium' => null],
            ['cityId' => 'city_2', 'proofId' => 'b2', 'count' => 2, 'rank' => 1, 'podium' => null],
            ['cityId' => 'city_2', 'proofId' => 'b', 'count' => 2, 'rank' => 0, 'podium' => null],
            ['cityId' => 'city_3', 'proofId' => 'c', 'count' => 1, 'rank' => 0, 'podium' => 2],
            ['cityId' => 'city_1', 'proofId' => 'a2', 'count' => 9, 'rank' => 1, 'podium' => null],
            ['cityId' => 'city_1', 'proofId' => 'a', 'count' => 9, 'rank' => 0, 'podium' => 1],
            ['cityId' => 'city_5', 'proofId' => 'e', 'count' => 3, 'rank' => 0, 'podium' => null],
        ];
        $this->assertSame(['a', 'a2', 'c', 'b', 'b2', 'd', 'e'], array_column(DailyTour::order($slides, 'city_2'), 'proofId'));
        $this->assertSame(['a', 'a2', 'c', 'd', 'e', 'b', 'b2'], array_column(DailyTour::order($slides, null), 'proofId'));
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
