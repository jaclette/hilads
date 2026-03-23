<?php

declare(strict_types=1);

class CityRepository
{
    private static ?array $cities = null;

    private static function cities(): array
    {
        if (self::$cities === null) {
            self::$cities = require __DIR__ . '/cities_data.php';
        }
        return self::$cities;
    }

    public static function all(): array
    {
        return self::cities();
    }

    public static function findById(int $id): ?array
    {
        foreach (self::cities() as $city) {
            if ($city['id'] === $id) {
                return $city;
            }
        }

        return null;
    }

    public static function nearest(float $lat, float $lng): array
    {
        $nearest = null;
        $minDistance = PHP_FLOAT_MAX;

        foreach (self::cities() as $city) {
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
