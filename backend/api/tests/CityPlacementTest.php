<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Where a position plays, on real GeoNames data: tests/fixtures/geo_cities_near.json
 * holds the cities around each case of placement_cases.json (regenerate with
 * scripts/geonames_import.php --fixture after a GeoNames refresh).
 */
final class CityPlacementTest extends TestCase
{
    private static array $cities;

    public static function setUpBeforeClass(): void
    {
        require_once __DIR__ . '/../src/CityPlacement.php';
        self::$cities = json_decode(file_get_contents(__DIR__ . '/fixtures/geo_cities_near.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    public static function cases(): array
    {
        $cases = json_decode(file_get_contents(__DIR__ . '/fixtures/placement_cases.json'), true, 512, JSON_THROW_ON_ERROR);
        return array_combine(array_column($cases, 'place'), array_map(fn($c) => [$c], $cases));
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('cases')]
    public function testPlacement(array $case): void
    {
        $overrides = array_map(fn($o) => $o[0], CityPlacement::SEED_OVERRIDES);
        $city = CityPlacement::choose(self::$cities, $case['lat'], $case['lng'], $overrides);
        $this->assertSame(
            $case['expect'],
            $city['geoname_id'] ?? null,
            sprintf('%s → %s, expected %s', $case['place'], $city ? "{$city['name']} ({$city['population']})" : 'nobody', $case['city'] ?? 'nobody'),
        );
    }

    public function testOverrideTargetComesBeforeTheRule(): void
    {
        $a = ['geoname_id' => 1, 'country' => 'XX', 'admin1' => '1', 'population' => 10_000, 'lat' => 0.0, 'lng' => 0.0];
        $b = ['geoname_id' => 2, 'country' => 'XX', 'admin1' => '1', 'population' => 900_000, 'lat' => 0.0, 'lng' => 0.1];
        $c = ['geoname_id' => 3, 'country' => 'XX', 'admin1' => '2', 'population' => 50_000, 'lat' => 1.0, 'lng' => 0.0];
        $this->assertSame(2, CityPlacement::choose([$a, $b], 0.0, 0.0)['geoname_id']);            // absorbed by the rule
        $this->assertSame(1, CityPlacement::choose([$a, $b], 0.0, 0.0, [1 => null])['geoname_id']); // never absorbed
        $this->assertSame(3, CityPlacement::choose([$a, $b, $c], 0.0, 0.0, [1 => 3])['geoname_id']); // attached, even ~111 km away
        $this->assertSame(1, CityPlacement::choose([$a], 0.0, 0.0, [1 => 99])['geoname_id']);      // unknown target: the municipality
    }

    public function testNeverBeyond50Km(): void
    {
        $paris = ['geoname_id' => 2988507, 'country' => 'FR', 'admin1' => '11', 'population' => 2138551, 'lat' => 48.85341, 'lng' => 2.3488];
        $this->assertNull(CityPlacement::choose([$paris], 48.85341, 3.04)); // ~51 km east
        $this->assertSame(2988507, CityPlacement::choose([$paris], 48.85341, 3.0)['geoname_id']); // ~48 km
    }
}
