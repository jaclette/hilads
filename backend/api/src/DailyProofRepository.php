<?php

declare(strict_types=1);

/**
 * Daily Challenge proofs: one photo per user per challenge.
 *
 * City and is_local are set here, server-side, from the poster's profile
 * (DailyRules::isLocalFor). New and edited proofs start as 'pending' and only
 * become visible to others once approved (moderation: prompt 04).
 */
final class DailyProofRepository
{
    public const CAPTION_MAX    = 140;
    public const PLACE_NAME_MAX = 80;

    private const SELECT = "
        SELECT p.*,
               dc.challenge_date,
               u.username, u.display_name, u.profile_photo_url,
               ch.name AS city_name,
               wr.rank AS world_rank, cr.rank AS city_rank
        FROM daily_proofs p
        JOIN daily_challenges dc ON dc.id = p.challenge_id
        JOIN users u             ON u.id  = p.user_id
        LEFT JOIN channels ch    ON ch.id = p.city_id
        LEFT JOIN daily_results wr
               ON wr.challenge_id = p.challenge_id AND wr.scope = 'world' AND wr.proof_id = p.id
        LEFT JOIN daily_results cr
               ON cr.challenge_id = p.challenge_id AND cr.scope = p.city_id AND cr.proof_id = p.id
    ";

    /**
     * Validate a create/edit body. Returns [fields, null] or [[], errorCode].
     * In partial mode (edit) absent keys are left out; an explicit null clears
     * an optional field. photoUrl must be one of our own uploads.
     */
    public static function validateInput(array $body, bool $partial): array
    {
        $out = [];

        if (!$partial || array_key_exists('photoUrl', $body)) {
            $url = is_string($body['photoUrl'] ?? null) ? trim($body['photoUrl']) : '';
            if ($url === '' || R2Uploader::ownUploadFilename($url) === null) {
                return [[], 'invalid_photo'];
            }
            $out['photo_url'] = $url;
        }

        if (array_key_exists('caption', $body)) {
            $caption = $body['caption'];
            if ($caption !== null && !is_string($caption)) {
                return [[], 'invalid_caption'];
            }
            // One sentence: newlines collapse to spaces.
            $caption = $caption === null ? '' : trim((string) preg_replace('/\s+/u', ' ', $caption));
            if (mb_strlen($caption) > self::CAPTION_MAX) {
                return [[], 'invalid_caption'];
            }
            $out['caption'] = $caption === '' ? null : $caption;
        }

        if (array_key_exists('price', $body)) {
            $price = $body['price'];
            if ($price === null) {
                $out['price_amount'] = null;
                $out['price_currency'] = null;
            } else {
                $amount   = is_array($price) ? ($price['amount'] ?? null) : null;
                $currency = is_array($price) ? strtoupper(trim((string) ($price['currency'] ?? ''))) : '';
                if (!is_numeric($amount) || (float) $amount < 0 || (float) $amount > 1e12
                    || !preg_match('/^[A-Z]{3}$/', $currency)) {
                    return [[], 'invalid_price'];
                }
                $out['price_amount']   = round((float) $amount, 2);
                $out['price_currency'] = $currency;
            }
        }

        if (array_key_exists('place', $body)) {
            $place = $body['place'];
            if ($place === null) {
                $out['place_lat'] = null;
                $out['place_lng'] = null;
                $out['place_name'] = null;
            } else {
                $lat  = is_array($place) ? ($place['lat'] ?? null) : null;
                $lng  = is_array($place) ? ($place['lng'] ?? null) : null;
                $name = is_array($place) ? trim((string) ($place['name'] ?? '')) : '';
                if (!is_numeric($lat) || !is_numeric($lng)
                    || abs((float) $lat) > 90 || abs((float) $lng) > 180
                    || mb_strlen($name) > self::PLACE_NAME_MAX) {
                    return [[], 'invalid_place'];
                }
                $out['place_lat']  = (float) $lat;
                $out['place_lng']  = (float) $lng;
                $out['place_name'] = $name === '' ? null : $name;
            }
        }

        return [$out, null];
    }

    /**
     * Create the user's proof for $challenge. Returns the proof row, or null
     * when the user already has one for this challenge.
     */
    public static function create(array $user, array $challenge, array $fields): ?array
    {
        $cityId   = $user['current_city_id'] ?? null;
        $cityName = null;
        if ($cityId !== null && preg_match('/^city_(\d+)$/', $cityId, $m)) {
            $cityName = CityRepository::findById((int) $m[1])['name'] ?? null;
        }
        if ($cityName === null) {
            $cityId = null;
        }

        $stmt = Database::pdo()->prepare("
            INSERT INTO daily_proofs (
                id, challenge_id, user_id, city_id, photo_url, caption,
                price_amount, price_currency, place_lat, place_lng, place_name, is_local
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (challenge_id, user_id) DO NOTHING
            RETURNING id
        ");
        $stmt->execute([
            bin2hex(random_bytes(8)),
            $challenge['id'],
            $user['id'],
            $cityId,
            $fields['photo_url'],
            $fields['caption'] ?? null,
            $fields['price_amount'] ?? null,
            $fields['price_currency'] ?? null,
            $fields['place_lat'] ?? null,
            $fields['place_lng'] ?? null,
            $fields['place_name'] ?? null,
            DailyRules::isLocalFor($user['mode'] ?? null, $user['home_city'] ?? null, $cityName) ? 'true' : 'false',
        ]);
        $id = $stmt->fetchColumn();
        return $id === false ? null : self::findById((string) $id);
    }

    /** Apply an edit and send the proof back to moderation. */
    public static function update(string $id, array $fields): ?array
    {
        $allowed = ['photo_url', 'caption', 'price_amount', 'price_currency', 'place_lat', 'place_lng', 'place_name'];
        $sets = [];
        $args = [];
        foreach ($allowed as $col) {
            if (array_key_exists($col, $fields)) {
                $sets[] = "$col = ?";
                $args[] = $fields[$col];
            }
        }
        $sets[] = "moderation_status = 'pending'";
        $sets[] = "approved_at = NULL";
        $sets[] = "rejection_reason = NULL";
        $sets[] = "edited_at = now()";
        $sets[] = "updated_at = now()";
        $args[] = $id;

        Database::pdo()
            ->prepare("UPDATE daily_proofs SET " . implode(', ', $sets) . " WHERE id = ?")
            ->execute($args);
        return self::findById($id);
    }

    /** Hard delete: votes, results and points cascade (points reversed by trigger). */
    public static function delete(string $id): void
    {
        Database::pdo()->prepare("DELETE FROM daily_proofs WHERE id = ?")->execute([$id]);
    }

    public static function findById(string $id): ?array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . " WHERE p.id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public static function findMine(string $challengeId, string $userId): ?array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . " WHERE p.challenge_id = ? AND p.user_id = ?");
        $stmt->execute([$challengeId, $userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Approved proofs of a challenge, newest approval first. $cityId null =
     * World (every city). $before is a unix time cursor on approved_at.
     */
    public static function listApproved(string $challengeId, ?string $cityId, ?int $before, int $limit): array
    {
        $where = ["p.challenge_id = ?", "p.moderation_status = 'approved'"];
        $args  = [$challengeId];
        if ($cityId !== null) {
            $where[] = "p.city_id = ?";
            $args[]  = $cityId;
        }
        if ($before !== null) {
            $where[] = "p.approved_at < to_timestamp(?)";
            $args[]  = $before;
        }
        $args[] = $limit;
        $stmt = Database::pdo()->prepare(
            self::SELECT . " WHERE " . implode(' AND ', $where) . " ORDER BY p.approved_at DESC, p.id DESC LIMIT ?"
        );
        $stmt->execute($args);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** Moderation queue: pending proofs, oldest first (the longest wait is reviewed first). */
    public static function listPending(int $limit): array
    {
        $stmt = Database::pdo()->prepare(
            self::SELECT . " WHERE p.moderation_status = 'pending' ORDER BY p.created_at ASC LIMIT ?"
        );
        $stmt->execute([$limit]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** Approved proofs with open reports, most reported first, with report_count and reasons. */
    public static function listReported(int $limit): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT x.*, r.report_count, r.reasons
            FROM (" . self::SELECT . " WHERE p.moderation_status = 'approved') x
            JOIN (
                SELECT proof_id, count(*) AS report_count, string_agg(DISTINCT reason_code, ',') AS reasons
                FROM daily_proof_reports WHERE status = 'open' GROUP BY proof_id
            ) r ON r.proof_id = x.id
            ORDER BY r.report_count DESC, x.approved_at DESC
            LIMIT ?
        ");
        $stmt->execute([$limit]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * API shape. Owner-only fields (rejectionReason) need $viewerId to match.
     * myVote comes from DailyVotes::annotate; the ranks exist once the
     * challenge closed (worldRank: top 3 only).
     */
    public static function format(array $row, ?string $viewerId = null): array
    {
        $isMine = $viewerId !== null && $viewerId === $row['user_id'];
        $cityId = $row['city_id'] !== null ? (int) substr((string) $row['city_id'], 5) : null;
        $local  = (int) $row['local_vote_count'];

        return [
            'id'               => $row['id'],
            'challengeId'      => $row['challenge_id'],
            'date'             => $row['challenge_date'],
            'user'             => [
                'id'          => $row['user_id'],
                'username'    => $row['username'],
                'displayName' => $row['display_name'],
                'photoUrl'    => R2Uploader::thumbProxy($row['profile_photo_url']),
            ],
            'city'             => $cityId !== null ? ['id' => $cityId, 'name' => $row['city_name']] : null,
            'isLocal'          => self::bool($row['is_local']),
            'photoUrl'         => $row['photo_url'],
            'thumbUrl'         => R2Uploader::thumbProxy($row['photo_url']),
            'caption'          => $row['caption'],
            'price'            => $row['price_amount'] !== null
                ? ['amount' => (float) $row['price_amount'], 'currency' => $row['price_currency']]
                : null,
            'place'            => $row['place_lat'] !== null
                ? ['lat' => (float) $row['place_lat'], 'lng' => (float) $row['place_lng'], 'name' => $row['place_name']]
                : null,
            'status'           => $row['moderation_status'],
            'rejectionReason'  => $isMine ? $row['rejection_reason'] : null,
            'voteCount'        => (int) $row['vote_count'],
            'localVoteCount'   => $local,
            'validatedByLocal' => $local > 0,
            'myVote'           => (bool) ($row['my_vote'] ?? false),
            'worldRank'        => isset($row['world_rank']) ? (int) $row['world_rank'] : null,
            'cityRank'         => isset($row['city_rank']) ? (int) $row['city_rank'] : null,
            'isMine'           => $isMine,
            'approvedAt'       => self::ts($row['approved_at']),
            'editedAt'         => self::ts($row['edited_at']),
            'createdAt'        => self::ts($row['created_at']),
        ];
    }

    public static function bool(mixed $v): bool
    {
        return $v === true || $v === 't' || $v === 'true' || $v === 1 || $v === '1';
    }

    public static function ts(?string $v): ?int
    {
        return $v === null ? null : strtotime($v);
    }
}
