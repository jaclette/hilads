<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Spots and the map (V3-03): week, bbox, tags, price range, ranking, search, payload shapes. */
final class SpotsTest extends TestCase
{
    public function testWeekIsMondayToSunday(): void
    {
        // 2026-10-17 is a Saturday.
        $this->assertSame(['2026-10-12', '2026-10-18'], Spots::week('2026-10-17'));
        $this->assertSame(['2026-10-12', '2026-10-18'], Spots::week('2026-10-12'));
        $this->assertSame(['2026-10-12', '2026-10-18'], Spots::week('2026-10-18'));
        $this->assertSame(['2026-10-19', '2026-10-25'], Spots::week('2026-10-19'));
    }

    public function testParseBbox(): void
    {
        $this->assertSame([106.6, 10.7, 106.8, 10.9], Spots::parseBbox('106.6,10.7,106.8,10.9'));
        $this->assertSame([106.6, 10.7, 106.8, 10.9], Spots::parseBbox(' 106.6, 10.7 ,106.8,10.9'));
        foreach ([null, '', '1,2,3', '1,2,3,x', '106.8,10.7,106.6,10.9', '106.6,10.9,106.8,10.7', '-181,0,0,1', '0,-91,1,1'] as $bad) {
            $this->assertNull(Spots::parseBbox($bad), (string) $bad);
        }
    }

    public function testParseTags(): void
    {
        $this->assertSame(['cơm tấm', 'sườn'], Spots::parseTags(' Cơm Tấm ,sườn, , com tam '));
        $this->assertSame([], Spots::parseTags(null));
        $this->assertCount(5, Spots::parseTags('a,b,c,d,e,f,g'));
        $this->assertSame([], Spots::parseTags(str_repeat('x', 41)));
    }

    public function testMergeTagsKeepsTheFirstSpelling(): void
    {
        $this->assertSame(['Cơm tấm', 'sườn'], Spots::mergeTags(['Cơm tấm'], ['com tam', 'sườn']));
    }

    public function testPriceRangeUsesTheMostUsedCurrency(): void
    {
        $this->assertNull(Spots::priceRange([]));
        $this->assertSame(['min' => 35000.0, 'max' => 45000.0, 'currency' => 'VND'],
            Spots::priceRange([[45000, 'VND'], [3, 'EUR'], [35000, 'VND'], [null, null]]));
        // A tie goes to the alphabetically first currency (stable answer).
        $this->assertSame('EUR', Spots::priceRange([[3, 'EUR'], [40000, 'VND']])['currency']);
    }

    public function testRankOf(): void
    {
        $spots = [
            ['id' => 'a', 'votes' => 5, 'votesWeek' => 0, 'proofCount' => 1],
            ['id' => 'b', 'votes' => 9, 'votesWeek' => 2, 'proofCount' => 1],
            ['id' => 'c', 'votes' => 5, 'votesWeek' => 2, 'proofCount' => 3],
        ];
        $this->assertSame(1, Spots::rankOf($spots, 'b', 'votes'));
        $this->assertSame(2, Spots::rankOf($spots, 'c', 'votes'), 'more proofs break the tie');
        $this->assertSame(1, Spots::rankOf($spots, 'c', 'votesWeek'));
        $this->assertNull(Spots::rankOf($spots, 'a', 'votesWeek'), 'no votes this week: no rank');
        $this->assertNull(Spots::rankOf($spots, 'zz', 'votes'));
    }

    public function testSearchMatchesNameAndTagsWithoutAccents(): void
    {
        $spot = ['name' => 'Quán Cơm Tấm Ba Ghiền', 'tags' => ['sườn nướng']];
        $this->assertTrue(Spots::matches($spot, 'com tam'));
        $this->assertTrue(Spots::matches($spot, 'GHIỀN'));
        $this->assertTrue(Spots::matches($spot, 'suon'));
        $this->assertFalse(Spots::matches($spot, 'pho'));
        $this->assertFalse(Spots::matches($spot, '!!'));
    }

    public function testFormatSpot(): void
    {
        $spot = Spots::format([
            'id' => 'abc', 'name' => 'Cà phê Bệt', 'lat' => '10.77', 'lng' => '106.70', 'city_id' => 'city_20',
            'city_name' => 'Ho Chi Minh City', 'themes' => 'coffee,neighborhood', 'proof_count' => '3', 'votes' => '12',
            'votes_week' => '4', 'validated' => 't', 'last_date' => '2026-10-17',
            'prices' => '[[25000, "VND"], [30000, "VND"]]', 'cover_photo' => null, 'cover_caption' => 'Sit on the curb',
        ], ['cà phê sữa đá']);
        $this->assertSame(['id' => 20, 'name' => 'Ho Chi Minh City'], $spot['city']);
        $this->assertSame(['coffee', 'neighborhood'], $spot['themes']);
        $this->assertSame(3, $spot['proofCount']);
        $this->assertSame(4, $spot['votesWeek']);
        $this->assertTrue($spot['validatedByLocal']);
        $this->assertSame(['min' => 25000.0, 'max' => 30000.0, 'currency' => 'VND'], $spot['priceRange']);
        $this->assertSame('2026-10-17', $spot['lastProofDate']);
        $this->assertSame('Sit on the curb', $spot['cover']['caption']);
    }

    public function testPhotoCarriesADateNeverATime(): void
    {
        $photo = Spots::formatPhoto([
            'id' => 'p1', 'photo_url' => null, 'caption' => null, 'price_amount' => null, 'price_currency' => null,
            'challenge_date' => '2026-10-17', 'theme' => 'coffee', 'user_id' => 'u1', 'username' => 'anh',
            'display_name' => 'Anh', 'profile_photo_url' => null, 'is_local' => 'f', 'vote_count' => '2',
            'local_vote_count' => '1', 'approved_at' => '2026-10-17 09:14:00+00', 'created_at' => '2026-10-17 09:00:00+00',
        ]);
        $this->assertSame('2026-10-17', $photo['date']);
        $this->assertTrue($photo['validatedByLocal']);
        foreach (['approvedAt', 'createdAt', 'editedAt', 'approved_at', 'created_at'] as $k) {
            $this->assertArrayNotHasKey($k, $photo);
        }
    }

    public function testPlanPins(): void
    {
        $now  = 1792202400;
        $plan = ['id' => 'e1', 'title' => 'Birdy, 6 PM', 'source' => 'hilads', 'is_venue' => false,
                 'venue_lat' => 10.77, 'venue_lng' => 106.7, 'starts_at' => $now + 3600, 'ends_at' => $now + 7200,
                 'series_id' => null, 'participant_count' => 6];
        $this->assertSame(['id' => 'e1', 'title' => 'Birdy, 6 PM', 'lat' => 10.77, 'lng' => 106.7,
                           'startsAt' => $now + 3600, 'endsAt' => $now + 7200, 'recurring' => false,
                           'participantCount' => 6], Spots::formatPlan($plan, $now));
        $this->assertNull(Spots::formatPlan(['source' => 'ticketmaster'] + $plan, $now), 'public events are not plans');
        $this->assertNull(Spots::formatPlan(['is_venue' => true] + $plan, $now), 'venues are not plans');
        $this->assertNull(Spots::formatPlan(['venue_lat' => null] + $plan, $now), 'no position, no pin');
        $this->assertNull(Spots::formatPlan(['ends_at' => $now] + $plan, $now), 'over');
    }
}
