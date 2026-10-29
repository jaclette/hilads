<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Today by country and by city (stories row and mosaic): grouping, top photo, unseen, order. */
final class DailyCountriesTest extends TestCase
{
    /** Light rows as countryRows returns them: newest first. */
    private const ROWS = [
        ['id' => 'p6', 'user_id' => 'u1', 'city_id' => 'city_3', 'city_name' => 'Tokyo',  'country' => 'jp', 'vote_count' => 0, 'at' => 600],
        ['id' => 'p5', 'user_id' => 'u2', 'city_id' => 'city_1', 'city_name' => 'Saigon', 'country' => 'vn', 'vote_count' => 2, 'at' => 500],
        ['id' => 'p4', 'user_id' => 'u3', 'city_id' => 'city_2', 'city_name' => 'Berlin', 'country' => 'de', 'vote_count' => 1, 'at' => 400],
        ['id' => 'p3', 'user_id' => 'u4', 'city_id' => 'city_4', 'city_name' => 'Hanoi',  'country' => 'vn', 'vote_count' => 2, 'at' => 300],
        ['id' => 'p2', 'user_id' => 'u3', 'city_id' => 'city_2', 'city_name' => 'Berlin', 'country' => 'de', 'vote_count' => 3, 'at' => 200],
        ['id' => 'p1', 'user_id' => 'u5', 'city_id' => 'city_3', 'city_name' => 'Tokyo',  'country' => 'jp', 'vote_count' => 0, 'at' => 100],
    ];

    public function testGroupsByCountryNewestFirstWithTheBestOnTop(): void
    {
        $g = array_column(DailyProofRepository::groupByCountry(self::ROWS, null, null), null, 'country');
        $this->assertSame(['p5', 'p3'], $g['VN']['ids']);
        $this->assertSame(2, $g['VN']['count']);
        // A tie (2 votes each): the earliest posted keeps the spot, and its city is the country's.
        $this->assertSame('p3', $g['VN']['topId']);
        $this->assertSame('Hanoi', $g['VN']['cityName']);
        $this->assertSame('p2', $g['DE']['topId']);
        // No vote at all: the earliest posted.
        $this->assertSame('p1', $g['JP']['topId']);
        $this->assertNull($g['JP']['unseen']);
    }

    public function testMostRecentFirstWithoutACountryOrSeenPhotos(): void
    {
        $order = array_column(DailyProofRepository::groupByCountry(self::ROWS, null, null), 'country');
        $this->assertSame(['JP', 'VN', 'DE'], $order);
    }

    public function testMyCountryFirstThenUnseenThenMostRecent(): void
    {
        // Everything in Japan seen, one Berlin photo unseen: Germany before Japan.
        $seen  = ['p6' => true, 'p1' => true, 'p2' => true, 'p5' => true, 'p3' => true];
        $items = DailyProofRepository::groupByCountry(self::ROWS, 'VN', $seen);
        $this->assertSame(['VN', 'DE', 'JP'], array_column($items, 'country'));
        $this->assertSame([false, true, false], array_column($items, 'unseen'));
    }

    public function testGroupsByCityWithCountsAuthorsAndLikes(): void
    {
        $g = array_column(DailyProofRepository::groupByCity(self::ROWS, null, null), null, 'cityId');
        $this->assertCount(4, $g);                                  // Saigon and Hanoi stay apart
        $this->assertSame(['p2', 'p4'], $g['city_2']['ids']);       // best first
        $this->assertSame('p2', $g['city_2']['topId']);
        $this->assertSame(['u3'], $g['city_2']['authorIds']);       // one author, two photos
        $this->assertSame(4, $g['city_2']['totalLikes']);
        $this->assertSame(['p1', 'p6'], $g['city_3']['ids']);       // no vote: the earliest first
        $this->assertSame(['u5', 'u1'], $g['city_3']['authorIds']);
    }

    public function testMyCityFirstThenUnseenThenMostRecent(): void
    {
        $seen  = ['p6' => true, 'p1' => true, 'p2' => true, 'p5' => true, 'p3' => true];
        $order = array_column(DailyProofRepository::groupByCity(self::ROWS, 'city_4', $seen), 'cityId');
        $this->assertSame(['city_4', 'city_2', 'city_3', 'city_1'], $order);
    }
}
