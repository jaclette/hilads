<?php

declare(strict_types=1);

/**
 * Demo content for today's Daily Challenge (scripts/daily_demo.php): a few
 * clearly named demo accounts post approved proofs, from several cities, as
 * locals and travelers, with prices and demo spots, and vote for each other.
 *
 * Visible like real content (Today, the challenge sheet, the Top 10, Chat
 * cards, the Map), never durable:
 *  - rows are written directly (no moderation path), so no points, Local
 *    Pass, digests or notifications at seed time;
 *  - accounts are is_demo + is_fake + hidden_from_rankings, with no device,
 *    so they get no push and never send PostHog events;
 *  - results, close points, streaks, Local Pass, the top 10 push, twist
 *    digests and proposal results skip is_demo proofs (safety net);
 *  - cleanup() deletes everything and runs at the start of the next drop
 *    (DailyDrop), before results and points.
 */
final class DailyDemo
{
    /**
     * The demo players, in photo order. Captions fit today's challenge; edit
     * them before seeding another day. lat/lng = the demo spot.
     */
    public const PLAYERS = [
        ['key' => 'linh',   'name' => 'Linh',   'city' => 'Ho Chi Minh City', 'local' => true,
         'spot' => 'Thien Hau Temple',        'lat' => 10.7533, 'lng' => 106.6612,
         'caption' => 'Lady Thiên Hậu protects sailors and travelers: the coils of incense burn for weeks.',
         'price' => [10000, 'VND']],
        ['key' => 'marco',  'name' => 'Marco',  'city' => 'Hanoi', 'local' => false,
         'spot' => 'Ngoc Son Temple',         'lat' => 21.0307, 'lng' => 105.8524,
         'caption' => 'A local told me the turtle in the lake is the guardian of the city.',
         'price' => [30000, 'VND']],
        ['key' => 'ploy',   'name' => 'Ploy',   'city' => 'Bangkok', 'local' => true,
         'spot' => 'Erawan Shrine',           'lat' => 13.7443, 'lng' => 100.5404,
         'caption' => 'People hire dancers here to say thank you when a wish comes true.',
         'price' => [40, 'THB']],
        ['key' => 'sofia',  'name' => 'Sofia',  'city' => 'Lisbon', 'local' => false,
         'spot' => 'Santo António street altar', 'lat' => 38.7108, 'lng' => -9.1306,
         'caption' => 'Neighbours keep this little altar for Saint Anthony, the matchmaker of Lisbon.',
         'price' => null],
        ['key' => 'kenji',  'name' => 'Kenji',  'city' => 'Tokyo', 'local' => true,
         'spot' => 'Jizo statues at Zojo-ji', 'lat' => 35.6575, 'lng' => 139.7486,
         'caption' => 'Jizō watches over children; parents dress the statues in red hats and bibs.',
         'price' => [100, 'JPY']],
        ['key' => 'lucia',  'name' => 'Lucía',  'city' => 'Mexico City', 'local' => false,
         'spot' => 'Coyoacán market altar',  'lat' => 19.3504, 'lng' => -99.1626,
         'caption' => 'The stall owners light a candle every morning for a good day of sales.',
         'price' => [15, 'MXN']],
    ];

    /** Who votes for whom (player keys): a clear Top 10 with ties. */
    public const VOTES = [
        ['marco', 'linh'], ['ploy', 'linh'], ['sofia', 'linh'],
        ['linh', 'ploy'], ['kenji', 'ploy'],
        ['lucia', 'kenji'], ['linh', 'kenji'],
        ['marco', 'sofia'],
    ];

    /**
     * Upload one local photo like the app does: metadata stripped (no GPS
     * EXIF ever stored), random name, thumbnail. Returns its URL.
     */
    public static function uploadPhoto(string $path): string
    {
        $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
        $mime    = (new finfo(FILEINFO_MIME_TYPE))->file($path);
        $info    = @getimagesize($path);
        if (!isset($allowed[$mime]) || $info === false || $info[0] > 6000 || $info[1] > 6000 || filesize($path) > 10 * 1024 * 1024) {
            throw new InvalidArgumentException(basename($path) . ': must be a JPEG, PNG or WebP under 10 MB and 6000 px.');
        }
        $clean = ImageProcessor::stripMetadata($path, $mime);
        if ($clean === null) {
            throw new RuntimeException(basename($path) . ': could not strip its metadata (' . ImageProcessor::$lastError . ').');
        }
        $filename = bin2hex(random_bytes(16)) . '.' . $allowed[$mime];
        try {
            $url = R2Uploader::put($clean, $filename, $mime);
            $thumb = ImageProcessor::generateAvatarThumbnail($clean, $mime);
            if ($thumb !== null) {
                try {
                    R2Uploader::put($thumb, 'thumb_' . pathinfo($filename, PATHINFO_FILENAME) . '.jpg', 'image/jpeg');
                } catch (RuntimeException) {
                    // Not fatal: the app falls back to the full photo.
                } finally {
                    @unlink($thumb);
                }
            }
        } finally {
            @unlink($clean);
        }
        return $url;
    }

    /** Counts of demo rows still in the database. */
    public static function status(): array
    {
        $pdo = Database::pdo();
        return [
            'accounts' => (int) $pdo->query("SELECT count(*) FROM users WHERE is_demo")->fetchColumn(),
            'proofs'   => (int) $pdo->query("SELECT count(*) FROM daily_proofs WHERE is_demo")->fetchColumn(),
            'votes'    => (int) $pdo->query("
                SELECT count(*) FROM daily_votes v
                WHERE v.proof_id IN (SELECT id FROM daily_proofs WHERE is_demo)
                   OR v.voter_user_id IN (SELECT id FROM users WHERE is_demo)
            ")->fetchColumn(),
            'cards'    => (int) $pdo->query("
                SELECT count(*) FROM messages
                WHERE event = 'daily_proof' AND payload->>'proofId' IN (SELECT id FROM daily_proofs WHERE is_demo)
            ")->fetchColumn(),
            'spots'    => (int) $pdo->query("SELECT count(*) FROM places WHERE is_demo")->fetchColumn(),
        ];
    }

    /**
     * Check what a seed needs: today's published challenge, no demo content
     * left, the cities, one photo per player. Returns [challenge, cityIds] or
     * throws with the reason.
     */
    public static function prepare(int $photoCount): array
    {
        $challenge = DailyChallengeRepository::findPublishedByDate(DailyClock::currentDate());
        if ($challenge === null) {
            throw new RuntimeException('No published challenge right now: run the drop first.');
        }
        $left = self::status();
        if ($left['accounts'] > 0 || $left['proofs'] > 0 || $left['spots'] > 0) {
            throw new RuntimeException('Demo content is already there (' . json_encode($left) . '): run cleanup first.');
        }
        $cityIds = [];
        $missing = [];
        foreach (self::PLAYERS as $p) {
            $id = CityRepository::findChannelIdByName($p['city']);
            $id === null ? $missing[] = $p['city'] : $cityIds[$p['key']] = $id;
        }
        if ($missing !== []) {
            throw new RuntimeException('Unknown cities: ' . implode(', ', $missing));
        }
        if ($photoCount < count(self::PLAYERS)) {
            throw new RuntimeException('Need ' . count(self::PLAYERS) . " photos, got {$photoCount}.");
        }
        return [$challenge, $cityIds];
    }

    /**
     * Seed today's demo content with these photo URLs (one per player, in
     * order). Returns what was created. Chat cards are posted after the
     * commit (best effort, like any approval).
     */
    public static function seed(array $photoUrls): array
    {
        [$challenge, $cityIds] = self::prepare(count($photoUrls));
        $pdo   = Database::pdo();
        $now   = time();
        $users = $proofs = [];

        $pdo->beginTransaction();
        try {
            foreach (array_values(self::PLAYERS) as $i => $p) {
                $userId = bin2hex(random_bytes(16));
                $cityId = $cityIds[$p['key']];
                $pdo->prepare("
                    INSERT INTO users (id, username, display_name, is_demo, is_fake, hidden_from_rankings,
                                       mode, home_city, current_city_id, locale, created_at, updated_at)
                    VALUES (?, ?, ?, true, true, true, ?, ?, ?, 'en', ?, ?)
                ")->execute([$userId, 'demo_' . $p['key'] . '_' . substr($userId, 0, 4), 'Demo · ' . $p['name'],
                             $p['local'] ? 'local' : 'traveler', $p['local'] ? $p['city'] : null, $cityId, $now, $now]);
                $users[$p['key']] = $userId;

                $placeId = bin2hex(random_bytes(8));
                $pdo->prepare("
                    INSERT INTO places (id, city_id, name, lat, lng, created_by, status, is_demo)
                    VALUES (?, ?, ?, ?, ?, ?, 'approved', true)
                ")->execute([$placeId, $cityId, $p['spot'], $p['lat'], $p['lng'], $userId]);

                $proofId = bin2hex(random_bytes(8));
                $pdo->prepare("
                    INSERT INTO daily_proofs (id, challenge_id, user_id, city_id, photo_url, caption,
                                              price_amount, price_currency, place_lat, place_lng, place_name, place_id, distance_m,
                                              is_local, is_early, moderation_status, approved_at, moderated_at, is_demo)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, false, 'approved',
                            now() - make_interval(mins => ?), now(), true)
                ")->execute([$proofId, $challenge['id'], $userId, $cityId, $photoUrls[$i], $p['caption'],
                             $p['price'][0] ?? null, $p['price'][1] ?? null, $p['lat'], $p['lng'], $p['spot'], $placeId,
                             $p['local'] ? 'true' : 'false', (count(self::PLAYERS) - $i) * 7]);
                $proofs[$p['key']] = $proofId;
            }

            $slots = [];
            foreach (self::VOTES as [$voter, $author]) {
                $slot = ($slots[$voter] ?? 0) + 1;
                $slots[$voter] = $slot;
                $pdo->prepare("
                    INSERT INTO daily_votes (challenge_id, proof_id, voter_user_id, voter_is_local, vote_slot)
                    VALUES (?, ?, ?, ?, ?)
                ")->execute([$challenge['id'], $proofs[$author], $users[$voter],
                             self::player($voter)['local'] ? 'true' : 'false', $slot]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        $cards = 0;
        foreach ($proofs as $proofId) {
            try {
                DailyCards::postProof(DailyProofRepository::findById($proofId));
                $cards++;
            } catch (\Throwable $e) {
                error_log('[daily-demo] card failed: ' . $e->getMessage());
            }
        }
        return ['challenge' => $challenge['challenge_date'], 'accounts' => count($users), 'proofs' => count($proofs),
                'votes' => count(self::VOTES), 'cardsPosted' => $cards];
    }

    /**
     * Delete every demo proof (and its chat cards, from the group cards too),
     * vote, spot, notification and account. A demo spot a real proof has used
     * since is kept and becomes a regular spot. Safe to run any time; returns
     * the counts. With $dry, only reports.
     */
    public static function cleanup(bool $dry = false): array
    {
        $pdo   = Database::pdo();
        $count = self::status();
        if ($dry) {
            return $count;
        }

        $proofs = $pdo->query("SELECT id, city_id, photo_url FROM daily_proofs WHERE is_demo")->fetchAll(PDO::FETCH_ASSOC);
        foreach ($proofs as $p) {
            DailyCards::hideProof((string) $p['id'], $p['city_id'] !== null ? (string) $p['city_id'] : null);
        }

        $pdo->beginTransaction();
        try {
            $pdo->exec("
                DELETE FROM daily_votes
                WHERE proof_id IN (SELECT id FROM daily_proofs WHERE is_demo)
                   OR voter_user_id IN (SELECT id FROM users WHERE is_demo)
            ");
            // Never expected (nothing awards them), removed if a path ever did.
            $pdo->exec("
                DELETE FROM score_events
                WHERE daily_proof_id IN (SELECT id FROM daily_proofs WHERE is_demo)
                   OR user_id IN (SELECT id FROM users WHERE is_demo)
            ");
            $pdo->exec("DELETE FROM daily_results WHERE proof_id IN (SELECT id FROM daily_proofs WHERE is_demo)");
            $pdo->exec("DELETE FROM daily_proofs WHERE is_demo");
            // A demo spot a real proof points to stays, as a regular spot.
            $pdo->exec("
                UPDATE places SET is_demo = false, updated_at = now()
                WHERE is_demo AND EXISTS (SELECT 1 FROM daily_proofs p WHERE p.place_id = places.id)
            ");
            $pdo->exec("DELETE FROM places WHERE is_demo");
            $pdo->exec("DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE is_demo)");
            $pdo->exec("DELETE FROM messages WHERE user_id IN (SELECT id FROM users WHERE is_demo)");
            $pdo->exec("DELETE FROM users WHERE is_demo");
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        // Photos uploaded by the seed, and their thumbnails (best effort: the
        // rows are already gone). Only demo proofs ever used them.
        foreach ($proofs as $p) {
            $key = R2Uploader::ownUploadFilename((string) $p['photo_url']);
            if ($key === null) {
                continue;
            }
            foreach ([$key, 'thumb_' . pathinfo($key, PATHINFO_FILENAME) . '.jpg'] as $k) {
                try {
                    R2Uploader::delete($k);
                } catch (\Throwable $e) {
                    error_log('[daily-demo] photo delete failed: ' . $e->getMessage());
                }
            }
        }
        return $count;
    }

    private static function player(string $key): array
    {
        foreach (self::PLAYERS as $p) {
            if ($p['key'] === $key) {
                return $p;
            }
        }
        throw new InvalidArgumentException("Unknown demo player {$key}");
    }
}
