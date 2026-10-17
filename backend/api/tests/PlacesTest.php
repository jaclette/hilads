<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Hilads places (V3-02): distances, names, proof input, theme rules, V1 pin groups. */
final class PlacesTest extends TestCase
{
    public function testDistance(): void
    {
        $this->assertSame(0, Places::distanceM(10.7769, 106.7009, 10.7769, 106.7009));
        // 0.001° of latitude ≈ 111 m.
        $this->assertEqualsWithDelta(111, Places::distanceM(10.7769, 106.7009, 10.7779, 106.7009), 1);
        // 0.01° of longitude at 10.77°N ≈ 1093 m.
        $this->assertEqualsWithDelta(1093, Places::distanceM(10.7769, 106.7009, 10.7769, 106.7109), 3);
    }

    public function testBoundingBoxContainsTheRadius(): void
    {
        [$minLat, $maxLat, $minLng, $maxLng] = Places::boundingBox(10.7769, 106.7009, 100);
        $this->assertGreaterThanOrEqual(100, Places::distanceM(10.7769, 106.7009, $maxLat, 106.7009));
        $this->assertGreaterThanOrEqual(100, Places::distanceM(10.7769, 106.7009, 10.7769, $maxLng));
        $this->assertLessThan(10.7769, $minLat);
        $this->assertLessThan(106.7009, $minLng);
    }

    public function testNormalizeName(): void
    {
        $this->assertSame('ba ghien stall 2', Places::normalizeName('  Ba   "Ghien"! Stall #2 '));
        $this->assertSame(Places::normalizeName('Đường sách'), Places::normalizeName('đường SÁCH'));
    }

    public function testNormalizeFoldsAccents(): void
    {
        $this->assertSame('com tam ba ghien', Places::normalizeName('Cơm Tấm Ba Ghiền'));
        $this->assertSame('duong sach', Places::normalizeName('Đường Sách'));
        $this->assertSame('cafe creme', Places::normalizeName('Café Crème'));
    }

    public function testPlaceThemes(): void
    {
        $this->assertFalse(Places::isPlaceTheme('language'));
        $this->assertFalse(Places::isPlaceTheme(null));
        foreach (['street_food', 'coffee', 'market', 'night_out', 'neighborhood', 'traditions'] as $t) {
            $this->assertTrue(Places::isPlaceTheme($t), $t);
        }
    }

    public function testNewFormatDetection(): void
    {
        $this->assertFalse(Places::usesNewFormat(['photoUrl' => 'x', 'place' => ['lat' => 1, 'lng' => 2]]));
        $this->assertTrue(Places::usesNewFormat(['spotId' => 'abc']));
        $this->assertTrue(Places::usesNewFormat(['newPlace' => null]));
        $this->assertTrue(Places::usesNewFormat(['position' => ['lat' => 1, 'lng' => 2]]));
    }

    public function testParseSpot(): void
    {
        [$in, $err] = Places::parseProofInput(['spotId' => '0123456789abcdef', 'position' => ['lat' => '10.7', 'lng' => 106.7]]);
        $this->assertNull($err);
        $this->assertSame('0123456789abcdef', $in['spotId']);
        $this->assertNull($in['newName']);
        $this->assertSame(10.7, $in['lat']);

        $this->assertSame('place_not_found', Places::parseProofInput(['spotId' => 'nope'])[1]);
        $this->assertSame('place_not_found', Places::parseProofInput(['spotId' => 12])[1]);
    }

    public function testParseNewPlace(): void
    {
        [$in, $err] = Places::parseProofInput(['newPlace' => ['name' => "  Cơm tấm\n stall "], 'position' => ['lat' => 1, 'lng' => 2]]);
        $this->assertNull($err);
        $this->assertSame('Cơm tấm stall', $in['newName']);

        $this->assertSame('invalid_place_name', Places::parseProofInput(['newPlace' => ['name' => '  ']])[1]);
        $this->assertSame('invalid_place_name', Places::parseProofInput(['newPlace' => ['name' => str_repeat('a', 81)]])[1]);
        $this->assertSame('invalid_place_name', Places::parseProofInput(['newPlace' => 'Stall'])[1]);
        $this->assertSame('invalid_place', Places::parseProofInput([
            'spotId' => '0123456789abcdef', 'newPlace' => ['name' => 'Stall'],
        ])[1]);
    }

    public function testParsePosition(): void
    {
        foreach ([['lat' => 91, 'lng' => 0], ['lat' => 0, 'lng' => 181], ['lat' => 'x', 'lng' => 1], ['lat' => 1], 'here'] as $bad) {
            $this->assertSame('invalid_position', Places::parseProofInput(['position' => $bad])[1], json_encode($bad));
        }
        [$in, $err] = Places::parseProofInput([]);
        $this->assertNull($err);
        $this->assertNull($in['lat']);
    }

    public function testThemeRules(): void
    {
        $none  = ['spotId' => null, 'newName' => null, 'lat' => 1.0, 'lng' => 2.0];
        $spot  = ['spotId' => '0123456789abcdef', 'newName' => null, 'lat' => 1.0, 'lng' => 2.0];
        $noPos = ['spotId' => null, 'newName' => 'Stall', 'lat' => null, 'lng' => null];

        $this->assertNull(Places::checkForTheme('language', $none));
        $this->assertSame('place_not_allowed', Places::checkForTheme('language', $spot));
        $this->assertSame('place_required', Places::checkForTheme('coffee', $none));
        $this->assertSame('invalid_position', Places::checkForTheme('coffee', $noPos));
        $this->assertNull(Places::checkForTheme('coffee', $spot));
    }

    public function testGroupPins(): void
    {
        $pins = [
            ['id' => 'p1', 'city_id' => 'city_1', 'user_id' => 'u1', 'lat' => 10.77690, 'lng' => 106.70090, 'name' => 'Cơm tấm Ba'],
            // 22 m away, same name with other spacing/case: same place.
            ['id' => 'p2', 'city_id' => 'city_1', 'user_id' => 'u2', 'lat' => 10.77710, 'lng' => 106.70090, 'name' => ' cơm TẤM  ba '],
            // Same name, 110 m away: another place.
            ['id' => 'p3', 'city_id' => 'city_1', 'user_id' => 'u3', 'lat' => 10.77790, 'lng' => 106.70090, 'name' => 'Cơm tấm Ba'],
            // Same spot, other name: another place.
            ['id' => 'p4', 'city_id' => 'city_1', 'user_id' => 'u4', 'lat' => 10.77690, 'lng' => 106.70090, 'name' => 'Bánh mì cart'],
            // Same name and position, other city: another place.
            ['id' => 'p5', 'city_id' => 'city_2', 'user_id' => 'u5', 'lat' => 10.77690, 'lng' => 106.70090, 'name' => 'Cơm tấm Ba'],
            // No name / no city: left out.
            ['id' => 'p6', 'city_id' => 'city_1', 'user_id' => 'u6', 'lat' => 10.77690, 'lng' => 106.70090, 'name' => null],
            ['id' => 'p7', 'city_id' => null, 'user_id' => 'u7', 'lat' => 10.77690, 'lng' => 106.70090, 'name' => 'Stall'],
        ];
        $groups = Places::groupPins($pins);
        $this->assertSame([['p1', 'p2'], ['p3'], ['p4'], ['p5']], array_column($groups, 'pins'));
        $this->assertSame('Cơm tấm Ba', $groups[0]['name']);
        $this->assertSame('u1', $groups[0]['created_by']);
        $this->assertSame(10.7769, $groups[0]['lat']);
    }

    public function testProofFields(): void
    {
        $f = Places::proofFields(['id' => 'abc', 'lat' => '10.5', 'lng' => '106.5', 'name' => 'Stall'], 42);
        $this->assertSame(['place_id' => 'abc', 'distance_m' => 42, 'place_lat' => 10.5, 'place_lng' => 106.5,
                           'place_name' => 'Stall'], $f);
    }
}
