<?php

declare(strict_types=1);

// Address search for "Seed a spot" (GET /admin/daily/spots/geocode?q=): the
// matches from OpenStreetMap's Nominatim (Geocoder: real User-Agent, ≤1
// request per second), as JSON. The form fills Position from the chosen one.

admin_require_login();

header('Content-Type: application/json; charset=utf-8');
$q = trim((string) ($_GET['q'] ?? ''));
if (mb_strlen($q) < 3 || mb_strlen($q) > 200) {
    echo json_encode(['items' => []]);
    exit;
}
echo json_encode(['items' => Geocoder::search($q, 5)], JSON_UNESCAPED_UNICODE);
