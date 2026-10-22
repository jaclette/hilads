<?php

declare(strict_types=1);

/**
 * Hilads places (V3-02, SPEC 9.4 / 9.12): our own places, no third-party
 * places API. The first proof at a location creates the place (a name typed by
 * the user + the device position, moderated); later proofs attach to it. A
 * place becomes a spot once it has an approved proof.
 *
 * Locate the place, never the person: a proof stores only its distance to the
 * place. A device position is kept only when it becomes a new place's position.
 */
final class Places
{
    /** Existing places listed in the proof's place step. */
    public const NEARBY_RADIUS_M = 100;
    /** Max distance between the device and the place when posting. */
    public const PROOF_RADIUS_M  = 150;
    /** A new place this close to one with the same name reuses it. */
    public const DEDUP_RADIUS_M  = 25;
    /** V1 pins this close with the same name become one place (migration). */
    public const PIN_GROUP_RADIUS_M = 40;
    public const NAME_MAX     = 80;
    public const NEARBY_LIMIT = 20;

    // ── Pure helpers ──────────────────────────────────────────────────────────

    /** Great-circle distance in meters (haversine). */
    public static function distanceM(float $lat1, float $lng1, float $lat2, float $lng2): int
    {
        $r    = 6371000.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a    = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        return (int) round(2 * $r * asin(min(1.0, sqrt($a))));
    }

    /** [minLat, maxLat, minLng, maxLng] around a point, for an index-friendly prefilter. */
    public static function boundingBox(float $lat, float $lng, int $meters): array
    {
        $dLat = $meters / 111320.0;
        $dLng = $meters / (111320.0 * max(0.01, cos(deg2rad($lat))));
        return [$lat - $dLat, $lat + $dLat, $lng - $dLng, $lng + $dLng];
    }

    /** Accented letters folded by normalizeName (Vietnamese + common Latin; intl is not on Render). */
    private const FOLD = [
        'a' => 'àáảãạăằắẳẵặâầấẩẫậäå', 'e' => 'èéẻẽẹêềếểễệë', 'i' => 'ìíỉĩịîï',
        'o' => 'òóỏõọôồốổỗộơờớởỡợöø', 'u' => 'ùúủũụưừứửữựûü', 'y' => 'ỳýỷỹỵÿ',
        'd' => 'đ', 'c' => 'ç', 'n' => 'ñ',
    ];

    /** Name used to spot duplicates: lowercase, no accents, no punctuation, single spaces. */
    public static function normalizeName(string $name): string
    {
        static $map = null;
        if ($map === null) {
            $map = [];
            foreach (self::FOLD as $base => $letters) {
                foreach (mb_str_split($letters) as $ch) {
                    $map[$ch] = $base;
                }
            }
        }
        $s = strtr(mb_strtolower(trim($name)), $map);
        $s = (string) preg_replace('/[^\p{L}\p{N}]+/u', ' ', $s);
        return trim($s);
    }

    /** Every weekly theme is about a place (Join in: where it happens); a special day is not. */
    public static function isPlaceTheme(?string $theme): bool
    {
        $key = $theme !== null ? DailyThemes::effective($theme, null) : null;
        return $key !== null && $key !== DailyThemes::SPECIAL;
    }

    /** True when the body uses the V3 place format (sent by the app from 1.8.0). */
    public static function usesNewFormat(array $body): bool
    {
        return array_key_exists('spotId', $body) || array_key_exists('newPlace', $body)
            || array_key_exists('position', $body);
    }

    /**
     * Parse the V3 place fields of a proof body. Returns [input, null] or
     * [null, errorCode]. input: ['spotId' => ?string, 'newName' => ?string,
     * 'lat' => ?float, 'lng' => ?float]. The theme rules are checked in
     * checkForTheme; here only the shapes.
     */
    public static function parseProofInput(array $body): array
    {
        $in = ['spotId' => null, 'newName' => null, 'lat' => null, 'lng' => null];

        $spotId = $body['spotId'] ?? null;
        if ($spotId !== null) {
            if (!is_string($spotId) || !preg_match('/^[a-f0-9]{16}$/', $spotId)) {
                return [null, 'place_not_found'];
            }
            $in['spotId'] = $spotId;
        }

        $new = $body['newPlace'] ?? null;
        if ($new !== null) {
            $name = is_array($new) && is_string($new['name'] ?? null)
                ? trim((string) preg_replace('/\s+/u', ' ', $new['name'])) : '';
            if ($name === '' || mb_strlen($name) > self::NAME_MAX) {
                return [null, 'invalid_place_name'];
            }
            $in['newName'] = $name;
        }

        if ($in['spotId'] !== null && $in['newName'] !== null) {
            return [null, 'invalid_place'];
        }

        $pos = $body['position'] ?? null;
        if ($pos !== null) {
            $lat = is_array($pos) ? ($pos['lat'] ?? null) : null;
            $lng = is_array($pos) ? ($pos['lng'] ?? null) : null;
            if (!is_numeric($lat) || !is_numeric($lng) || abs((float) $lat) > 90 || abs((float) $lng) > 180) {
                return [null, 'invalid_position'];
            }
            $in['lat'] = (float) $lat;
            $in['lng'] = (float) $lng;
        }
        return [$in, null];
    }

    /**
     * Theme rules on parsed input. A special day: no place. Place themes: a
     * spot or a new place, and the device position. Join in on an app built
     * before it (no X-Themes-Rev: 3, so Ask a local without a place step) may post
     * without one. Returns an error code or null.
     */
    public static function checkForTheme(?string $theme, array $in): ?string
    {
        $hasPlace = $in['spotId'] !== null || $in['newName'] !== null;
        if (!self::isPlaceTheme($theme)) {
            return $hasPlace ? 'place_not_allowed' : null;
        }
        if (!$hasPlace && DailyThemes::clientVersion() < 3 && DailyThemes::effective($theme, null) === 'join_in') {
            return null;
        }
        if (!$hasPlace) {
            return 'place_required';
        }
        if ($in['lat'] === null) {
            return 'invalid_position';
        }
        return null;
    }

    /**
     * Group V1 pins into places (migration). Pins: [{id, city_id, user_id, lat,
     * lng, name}], oldest first. Same city + same normalized name + within
     * PIN_GROUP_RADIUS_M of the group's first pin = one place. Pins without
     * a name are left out (a place needs one). Returns groups:
     * [{city_id, name, lat, lng, created_by, pins: [ids]}] (the first pin gives
     * the position and the creator).
     */
    public static function groupPins(array $pins): array
    {
        $groups = [];
        foreach ($pins as $p) {
            $name = trim((string) ($p['name'] ?? ''));
            if ($name === '' || $p['city_id'] === null) {
                continue;
            }
            $norm = self::normalizeName($name);
            $hit  = null;
            foreach ($groups as $i => $g) {
                if ($g['city_id'] === $p['city_id'] && $g['norm'] === $norm
                    && self::distanceM($g['lat'], $g['lng'], (float) $p['lat'], (float) $p['lng']) <= self::PIN_GROUP_RADIUS_M) {
                    $hit = $i;
                    break;
                }
            }
            if ($hit === null) {
                $groups[] = ['city_id' => $p['city_id'], 'name' => mb_substr($name, 0, self::NAME_MAX), 'norm' => $norm,
                             'lat' => (float) $p['lat'], 'lng' => (float) $p['lng'],
                             'created_by' => $p['user_id'] ?? null, 'pins' => [$p['id']]];
            } else {
                $groups[$hit]['pins'][] = $p['id'];
            }
        }
        return array_map(static function (array $g): array {
            unset($g['norm']);
            return $g;
        }, $groups);
    }

    // ── Database ──────────────────────────────────────────────────────────────

    public static function findById(string $id): ?array
    {
        $stmt = Database::pdo()->prepare("SELECT * FROM places WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Places within NEARBY_RADIUS_M of a position, nearest first: approved
     * spots, plus the viewer's own places still in review.
     */
    public static function nearby(float $lat, float $lng, ?string $userId): array
    {
        [$minLat, $maxLat, $minLng, $maxLng] = self::boundingBox($lat, $lng, self::NEARBY_RADIUS_M);
        $stmt = Database::pdo()->prepare("
            SELECT pl.id, pl.name, pl.lat, pl.lng, pl.status,
                   (SELECT count(*) FROM daily_proofs p
                     WHERE p.place_id = pl.id AND p.moderation_status = 'approved') AS proof_count,
                   (SELECT string_agg(DISTINCT dc.theme, ',') FROM daily_proofs p
                      JOIN daily_challenges dc ON dc.id = p.challenge_id
                     WHERE p.place_id = pl.id AND p.moderation_status = 'approved' AND dc.theme IS NOT NULL) AS themes
            FROM places pl
            WHERE pl.lat BETWEEN ? AND ? AND pl.lng BETWEEN ? AND ?
              AND pl.merged_into IS NULL AND NOT pl.hidden
              AND (pl.status = 'approved' OR (pl.status = 'pending' AND pl.created_by = ?))
        ");
        $stmt->execute([$minLat, $maxLat, $minLng, $maxLng, $userId ?? '']);

        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $d = self::distanceM($lat, $lng, (float) $r['lat'], (float) $r['lng']);
            if ($d > self::NEARBY_RADIUS_M) {
                continue;
            }
            $out[] = [
                'id'         => $r['id'],
                'name'       => $r['name'],
                'distanceM'  => $d,
                'proofCount' => (int) $r['proof_count'],
                'themes'     => $r['themes'] !== null ? DailyThemes::clientList(explode(',', $r['themes'])) : [],
                'inReview'   => $r['status'] === 'pending',
            ];
        }
        usort($out, static fn(array $a, array $b): int => $a['distanceM'] <=> $b['distanceM']);
        return array_slice($out, 0, self::NEARBY_LIMIT);
    }

    /**
     * Resolve the place of a proof (V3 format, theme already checked) and run
     * the distance check. A new place is NOT written here (see create): returns
     * ['place' => row|null, 'newName' => ?string, 'distanceM' => int].
     * Throws InvalidArgumentException(code), or PlaceTooFarException.
     */
    public static function resolveForProof(array $in, ?string $userId): array
    {
        $lat = (float) $in['lat'];
        $lng = (float) $in['lng'];

        if ($in['spotId'] !== null) {
            $place = self::usable(self::findById($in['spotId']), $userId);
            if ($place === null) {
                throw new InvalidArgumentException('place_not_found');
            }
            $d = self::distanceM($lat, $lng, (float) $place['lat'], (float) $place['lng']);
            if ($d > self::PROOF_RADIUS_M) {
                throw new PlaceTooFarException($d);
            }
            return ['place' => $place, 'newName' => null, 'distanceM' => $d];
        }

        // New place: same name close by = the same place.
        $name = (string) $in['newName'];
        if (ModerationService::check($name) !== null) {
            throw new InvalidArgumentException('place_name_blocked');
        }
        $twin = self::findTwin($name, $lat, $lng, $userId);
        if ($twin !== null) {
            return ['place' => $twin, 'newName' => null,
                    'distanceM' => self::distanceM($lat, $lng, (float) $twin['lat'], (float) $twin['lng'])];
        }
        return ['place' => null, 'newName' => $name, 'distanceM' => 0];
    }

    /** Create a place in review at a position; returns its row. */
    public static function create(string $name, float $lat, float $lng, ?string $cityId, string $userId): array
    {
        $id = bin2hex(random_bytes(8));
        Database::pdo()->prepare("
            INSERT INTO places (id, city_id, name, lat, lng, created_by, status)
            VALUES (?, ?, ?, ?, ?, ?, 'pending')
        ")->execute([$id, $cityId, mb_substr($name, 0, self::NAME_MAX), $lat, $lng, $userId]);
        return self::findById($id);
    }

    /**
     * Place for a 1.7.1 pin (place: {lat, lng, name}): the pin is the place's
     * position, with no distance check (no device position). Needs a name; a
     * flagged name just leaves the proof without a place (that version can't
     * show a new error). Returns the place id or null.
     */
    public static function fromLegacyPin(array $fields, ?string $cityId, string $userId): ?string
    {
        $name = trim((string) ($fields['place_name'] ?? ''));
        if (($fields['place_lat'] ?? null) === null || $name === '' || ModerationService::check($name) !== null) {
            return null;
        }
        $lat  = (float) $fields['place_lat'];
        $lng  = (float) $fields['place_lng'];
        $twin = self::findTwin($name, $lat, $lng, $userId);
        return $twin !== null ? $twin['id'] : self::create($name, $lat, $lng, $cityId, $userId)['id'];
    }

    /** A proof was approved: its place in review becomes a spot. */
    public static function approveForProof(array $proof): void
    {
        if (($proof['place_id'] ?? null) === null) {
            return;
        }
        Database::pdo()->prepare("
            UPDATE places SET status = 'approved', updated_at = now()
            WHERE id = ? AND status = 'pending'
        ")->execute([$proof['place_id']]);
    }

    /** A proof was rejected: a place in review with no other live proof is rejected too. */
    public static function rejectIfOrphan(?string $placeId): void
    {
        if ($placeId === null) {
            return;
        }
        Database::pdo()->prepare("
            UPDATE places SET status = 'rejected', updated_at = now()
            WHERE id = ? AND status = 'pending'
              AND NOT EXISTS (SELECT 1 FROM daily_proofs
                              WHERE place_id = ? AND moderation_status IN ('pending', 'approved'))
        ")->execute([$placeId, $placeId]);
    }

    /** The proof's place columns for a resolved place (the pin copy keeps older apps' maps working). */
    public static function proofFields(array $place, ?int $distanceM): array
    {
        return [
            'place_id'   => $place['id'],
            'distance_m' => $distanceM,
            'place_lat'  => (float) $place['lat'],
            'place_lng'  => (float) $place['lng'],
            'place_name' => $place['name'],
        ];
    }

    /** Follow a merge, and keep only places this user may attach a proof to. */
    private static function usable(?array $place, ?string $userId): ?array
    {
        for ($i = 0; $place !== null && $place['merged_into'] !== null && $i < 5; $i++) {
            $place = self::findById((string) $place['merged_into']);
        }
        if ($place === null || DailyProofRepository::bool($place['hidden'])) {
            return null;
        }
        if ($place['status'] === 'approved' || ($place['status'] === 'pending' && $place['created_by'] === $userId)) {
            return $place;
        }
        return null;
    }

    /** An approved place (or the user's own in review) with the same name within DEDUP_RADIUS_M. */
    public static function findTwin(string $name, float $lat, float $lng, ?string $userId): ?array
    {
        [$minLat, $maxLat, $minLng, $maxLng] = self::boundingBox($lat, $lng, self::DEDUP_RADIUS_M);
        $stmt = Database::pdo()->prepare("
            SELECT * FROM places
            WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
              AND merged_into IS NULL AND NOT hidden
              AND (status = 'approved' OR (status = 'pending' AND created_by = ?))
        ");
        $stmt->execute([$minLat, $maxLat, $minLng, $maxLng, $userId ?? '']);
        $norm = self::normalizeName($name);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if (self::normalizeName($r['name']) === $norm
                && self::distanceM($lat, $lng, (float) $r['lat'], (float) $r['lng']) <= self::DEDUP_RADIUS_M) {
                return $r;
            }
        }
        return null;
    }
}

/** The device is farther from the place than PROOF_RADIUS_M. */
final class PlaceTooFarException extends InvalidArgumentException
{
    public function __construct(public readonly int $distanceM)
    {
        parent::__construct('too_far');
    }
}
