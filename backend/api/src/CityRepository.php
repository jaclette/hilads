<?php

declare(strict_types=1);

class CityRepository
{
    private static array $cities = [
        ['id' => 1,  'name' => 'Paris',         'lat' =>  48.8566,  'lng' =>   2.3522],
        ['id' => 2,  'name' => 'London',         'lat' =>  51.5074,  'lng' =>  -0.1278],
        ['id' => 3,  'name' => 'New York',        'lat' =>  40.7128,  'lng' => -74.0060],
        ['id' => 4,  'name' => 'Tokyo',           'lat' =>  35.6895,  'lng' => 139.6917],
        ['id' => 5,  'name' => 'Sydney',          'lat' => -33.8688,  'lng' => 151.2093],
        ['id' => 6,  'name' => 'São Paulo',       'lat' => -23.5505,  'lng' => -46.6333],
        ['id' => 7,  'name' => 'Cairo',           'lat' =>  30.0444,  'lng' =>  31.2357],
        ['id' => 8,  'name' => 'Mumbai',          'lat' =>  19.0760,  'lng' =>  72.8777],
        ['id' => 9,  'name' => 'Bangkok',         'lat' =>  13.7563,  'lng' => 100.5018],
        ['id' => 10, 'name' => 'Mexico City',     'lat' =>  19.4326,  'lng' => -99.1332],
        ['id' => 11, 'name' => 'Lagos',           'lat' =>   6.5244,  'lng' =>   3.3792],
        ['id' => 12, 'name' => 'Istanbul',        'lat' =>  41.0082,  'lng' =>  28.9784],
        ['id' => 13, 'name' => 'Buenos Aires',    'lat' => -34.6037,  'lng' => -58.3816],
        ['id' => 14, 'name' => 'Los Angeles',     'lat' =>  34.0522,  'lng' => -118.2437],
        ['id' => 15, 'name' => 'Singapore',       'lat' =>   1.3521,  'lng' => 103.8198],
        ['id' => 16, 'name' => 'Dubai',           'lat' =>  25.2048,  'lng' =>  55.2708],
        ['id' => 17, 'name' => 'Berlin',          'lat' =>  52.5200,  'lng' =>  13.4050],
        ['id' => 18, 'name' => 'Nairobi',         'lat' =>  -1.2921,  'lng' =>  36.8219],
        ['id' => 19, 'name' => 'Seoul',           'lat' =>  37.5665,  'lng' => 126.9780],
        ['id' => 20, 'name' => 'Ho Chi Minh City','lat' =>  10.8231,  'lng' => 106.6297],
    ];

    public static function nearest(float $lat, float $lng): array
    {
        $nearest = null;
        $minDistance = PHP_FLOAT_MAX;

        foreach (self::$cities as $city) {
            $distance = self::haversine($lat, $lng, $city['lat'], $city['lng']);
            if ($distance < $minDistance) {
                $minDistance = $distance;
                $nearest = $city;
            }
        }

        return $nearest;
    }

    private static function haversine(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $R = 6371;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);

        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return $R * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}
