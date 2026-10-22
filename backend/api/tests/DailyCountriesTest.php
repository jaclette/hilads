<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Today by country (stories row and mosaic): grouping, top photo, unseen, order. */
final class DailyCountriesTest extends TestCase
{
    /** Light rows as countryRows returns them: newest first. */
    private const ROWS = [
        ['id' => 'p6', 'city_id' => 'city_3', 'city_name' => 'Tokyo',  'country' => 'jp', 'vote_count' => 0, 'at' => 600],
        ['id' => 'p5', 'city_id' => 'city_1', 'city_name' => 'Saigon', 'country' => 'vn', 'vote_count' => 2, 'at' => 500],
        ['id' => 'p4', 'city_id' => 'city_2', 'city_name' => 'Berlin', 'country' => 'de', 'vote_count' => 1, 'at' => 400],
        ['id' => 'p3', 'city_id' => 'city_4', 'city_name' => 'Hanoi',  'country' => 'vn', 'vote_count' => 2, 'at' => 300],
        ['id' => 'p2', 'city_id' => 'city_2', 'city_name' => 'Berlin', 'country' => 'de', 'vote_count' => 3, 'at' => 200],
        ['id' => 'p1', 'city_id' => 'city_3', 'city_name' => 'Tokyo',  'country' => 'jp', 'vote_count' => 0, 'at' => 100],
    ];

    public function testGroupsByCountryNewestFirstWithTheMostVotedOnTop(): void
    {
        $g = array_column(DailyProofRepository::groupByCountry(self::ROWS, null, null), null, 'country');
        $this->assertSame(['p5', 'p3'], $g['VN']['ids']);
        $this->assertSame(2, $g['VN']['count']);
        // A tie (2 votes each): the newest wins, and its city is the country's.
        $this->assertSame('p5', $g['VN']['topId']);
        $this->assertSame('Saigon', $g['VN']['cityName']);
        $this->assertSame('p2', $g['DE']['topId']);
        // No vote at all: the newest.
        $this->assertSame('p6', $g['JP']['topId']);
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
}
