<?php

declare(strict_types=1);

/**
 * Daily Challenge cards in channels: system messages (type='system') with an
 * event and a JSON payload, the pattern World cards already use.
 *
 * daily_proof: posted when a proof is approved, to World and to the owner's
 * city channel if that city is live. The row carries the owner's user_id, so
 * the existing block filtering on feeds hides it for blocked viewers, and an
 * English `content` line that older app versions render as plain text.
 * Re-approval after an edit updates the card in place (same id); delete,
 * reject and removal delete it.
 *
 * Lives in src/ (not routes/) so the back office can call it too.
 */
final class DailyCards
{
    public const EVENT_PROOF = 'daily_proof';

    /** Render data for a daily_proof card, from a DailyProofRepository row. Pure. */
    public static function proofPayload(array $proof, string $challengeText): array
    {
        $cityId = $proof['city_id'] !== null ? (int) substr((string) $proof['city_id'], 5) : null;
        return [
            'proofId'       => $proof['id'],
            'challengeId'   => $proof['challenge_id'],
            'date'          => $proof['challenge_date'],
            'challengeText' => $challengeText,
            'user'          => [
                'id'          => $proof['user_id'],
                'username'    => $proof['username'],
                'displayName' => $proof['display_name'],
                'photoUrl'    => R2Uploader::thumbProxy($proof['profile_photo_url']),
                'localPass'   => DailyProofRepository::bool($proof['author_local_pass'] ?? false),
            ],
            'isLocal'       => DailyProofRepository::bool($proof['is_local']),
            'city'          => $cityId !== null ? ['id' => $cityId, 'name' => $proof['city_name']] : null,
            'photoUrl'      => $proof['photo_url'],
            'thumbUrl'      => R2Uploader::thumbProxy($proof['photo_url']),
            'caption'       => $proof['caption'],
        ];
    }

    /** English fallback line, shown as plain text by app versions without the card. */
    public static function proofContent(array $proof): string
    {
        $name = trim((string) ($proof['display_name'] ?: $proof['username'] ?: 'Someone'));
        return "📸 {$name} completed today's Daily Challenge";
    }

    /**
     * Post (or update in place) the cards of an approved proof: World, plus
     * the city channel when the city is live. Idempotent per channel.
     */
    public static function postProof(array $proof): void
    {
        $stmt = Database::pdo()->prepare("SELECT text_i18n FROM daily_challenges WHERE id = ?");
        $stmt->execute([$proof['challenge_id']]);
        $text    = json_decode((string) $stmt->fetchColumn(), true)['en'] ?? '';
        $payload = self::proofPayload($proof, $text);
        $content = self::proofContent($proof);

        $channels = ['world'];
        if ($proof['city_id'] !== null && DailyRules::isLive($proof['city_id'])) {
            $channels[] = $proof['city_id'];
        }
        // A card already in a city that is no longer live is still updated.
        foreach (self::cardRows($proof['id'], $proof['city_id']) as $row) {
            if (!in_array($row['channel_id'], $channels, true)) {
                $channels[] = $row['channel_id'];
            }
        }

        $pdo = Database::pdo();
        foreach ($channels as $dbChannel) {
            $find = $pdo->prepare("
                SELECT id, EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at
                FROM messages
                WHERE channel_id = ? AND event = 'daily_proof' AND payload->>'proofId' = ?
            ");
            $find->execute([$dbChannel, $proof['id']]);
            $existing = $find->fetch(PDO::FETCH_ASSOC);

            if ($existing) {
                $pdo->prepare("UPDATE messages SET payload = ?::jsonb, content = ?, nickname = ? WHERE id = ?")
                    ->execute([json_encode($payload, JSON_UNESCAPED_UNICODE), $content, (string) $proof['display_name'], $existing['id']]);
                $id        = $existing['id'];
                $createdAt = (int) $existing['created_at'];
            } else {
                $insert = $pdo->prepare("
                    INSERT INTO messages (id, channel_id, type, event, user_id, nickname, content, payload)
                    VALUES (?, ?, 'system', 'daily_proof', ?, ?, ?, ?::jsonb)
                    ON CONFLICT DO NOTHING
                    RETURNING id
                ");
                $id = bin2hex(random_bytes(8));
                $insert->execute([$id, $dbChannel, $proof['user_id'], (string) $proof['display_name'], $content,
                                  json_encode($payload, JSON_UNESCAPED_UNICODE)]);
                if ($insert->fetchColumn() === false) {
                    continue; // a concurrent approval already posted it
                }
                $createdAt = time();
            }

            // Same id on an update: clients replace the message with that id.
            self::postToWs('/broadcast/message', [
                'channelId' => self::clientChannel($dbChannel),
                'message'   => [
                    'id'        => $id,
                    'type'      => 'system',
                    'event'     => self::EVENT_PROOF,
                    'guestId'   => null,
                    'userId'    => $proof['user_id'],
                    'nickname'  => (string) $proof['display_name'],
                    'content'   => $content,
                    'payload'   => $payload,
                    'createdAt' => $createdAt,
                ],
            ]);
        }
    }

    /**
     * Render data for a daily_challenge card, in English, plus the founder's
     * translations ({locale: {text, context, twist}}) so each app shows its
     * language. $twist only for live city channels, with its text_i18n map. Pure.
     */
    public static function challengePayload(array $challenge, ?array $twist, ?array $yesterday = null, array $twistI18n = []): array
    {
        $c = DailyChallengeRepository::formatChallenge($challenge, null, 'en');
        $text    = json_decode((string) $challenge['text_i18n'], true) ?: [];
        $context = json_decode((string) ($challenge['context_i18n'] ?? '{}'), true) ?: [];
        $translations = [];
        foreach (DailyI18n::others() as $l) {
            $t  = DailyI18n::pick($text, $l);
            $cx = $c['context'] !== null ? DailyI18n::pick($context, $l) : null;
            $tw = $twist !== null ? DailyI18n::pick($twistI18n, $l) : null;
            if ($t !== null || $tw !== null) {
                $translations[$l] = array_filter(['text' => $t, 'context' => $cx, 'twist' => $tw], static fn($v) => $v !== null);
            }
        }
        return [
            'challengeId'   => $c['id'],
            'date'          => $c['date'],
            'text'          => $c['text'],
            'context'       => $c['context'],
            'theme'         => $c['theme'],
            'proposedBy'    => $c['proposedBy'],
            'endsAt'        => $c['endsAt'],
            'twist'         => $twist,
            'yesterday'     => $yesterday !== null ? ['date' => $yesterday['date'], 'text' => $yesterday['text']] : null,
            'yesterdayTop3' => $yesterday['top3'] ?? [],
            'translations'  => (object) $translations,
        ];
    }

    /** Yesterday's challenge and its World top 3 (empty before results), for the World card. */
    private static function yesterday(array $challenge): ?array
    {
        $date = (new DateTimeImmutable((string) $challenge['challenge_date'], new DateTimeZone('UTC')))
            ->modify('-1 day')->format('Y-m-d');
        $prev = DailyChallengeRepository::findPublishedByDate($date);
        if ($prev === null) {
            return null;
        }
        return [
            'date' => $date,
            'text' => DailyChallengeRepository::formatChallenge($prev, null, 'en')['text'],
            'top3' => DailyResults::cardTop3($prev['id']),
        ];
    }

    /**
     * Post today's daily_challenge card to World and every live city channel
     * (with its Local Twist), as the @hilads account. Idempotent per channel.
     * Returns the number of cards actually posted by this call.
     */
    public static function postChallenge(array $challenge): int
    {
        $hilads   = md5('hilads-admin'); // seeded brand account (migrate.php)
        $content  = "🔥 Today's Daily Challenge: " . (json_decode((string) $challenge['text_i18n'], true)['en'] ?? '');
        $channels = array_merge(['world'], DailyRules::liveCityIds());
        $posted   = 0;
        $yesterday = self::yesterday($challenge);

        foreach ($channels as $dbChannel) {
            $twist   = $dbChannel === 'world' ? null : DailyChallengeRepository::twistFor($challenge['id'], $dbChannel, 'en');
            // Yesterday's top 3 rides on the World card only (SPEC 3.7).
            $payload = self::challengePayload($challenge, $twist, $dbChannel === 'world' ? $yesterday : null,
                                              $twist !== null ? DailyChallengeRepository::twistI18n((string) $twist['id']) : []);
            $insert  = Database::pdo()->prepare("
                INSERT INTO messages (id, channel_id, type, event, user_id, nickname, content, payload)
                VALUES (?, ?, 'system', 'daily_challenge', ?, 'Hilads', ?, ?::jsonb)
                ON CONFLICT DO NOTHING
                RETURNING id
            ");
            $id = bin2hex(random_bytes(8));
            $insert->execute([$id, $dbChannel, $hilads, $content, json_encode($payload, JSON_UNESCAPED_UNICODE)]);
            if ($insert->fetchColumn() === false) {
                continue; // already posted by an earlier (retried) run
            }
            $posted++;
            self::postToWs('/broadcast/message', [
                'channelId' => self::clientChannel($dbChannel),
                'message'   => [
                    'id'        => $id,
                    'type'      => 'system',
                    'event'     => 'daily_challenge',
                    'guestId'   => null,
                    'userId'    => $hilads,
                    'nickname'  => 'Hilads',
                    'content'   => $content,
                    'payload'   => $payload,
                    'createdAt' => time(),
                ],
            ]);
        }
        return $posted;
    }

    /** Delete every card of a proof (reactions cascade) and tell connected clients. */
    public static function hideProof(string $proofId, ?string $cityId): void
    {
        $pdo = Database::pdo();
        foreach (self::cardRows($proofId, $cityId) as $row) {
            $pdo->prepare("DELETE FROM messages WHERE id = ?")->execute([$row['id']]);
            self::postToWs('/broadcast/message-deleted', [
                'channelId' => self::clientChannel($row['channel_id']),
                'messageId' => $row['id'],
                'deletedAt' => time(),
            ]);
        }
    }

    /** Card rows of a proof in World and its city (both lookups use the unique index). */
    private static function cardRows(string $proofId, ?string $cityId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT id, channel_id FROM messages
            WHERE channel_id = ANY (string_to_array(?, ',')) AND event = 'daily_proof' AND payload->>'proofId' = ?
        ");
        $stmt->execute([implode(',', array_filter(['world', $cityId])), $proofId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** WS channel key: 'world' stays, 'city_N' becomes N. */
    private static function clientChannel(string $dbChannel): int|string
    {
        return str_starts_with($dbChannel, 'city_') ? (int) substr($dbChannel, 5) : $dbChannel;
    }

    /** Best effort, like WorldRepository: a WS outage never fails the caller. */
    private static function postToWs(string $path, array $body): void
    {
        $wsUrl   = rtrim(getenv('WS_INTERNAL_URL') ?: 'http://localhost:8082', '/');
        $json    = json_encode($body, JSON_UNESCAPED_UNICODE);
        $token   = getenv('WS_INTERNAL_TOKEN') ?: '';
        $headers = "Content-Type: application/json\r\nContent-Length: " . strlen((string) $json) . "\r\n";
        if ($token !== '') {
            $headers .= "X-Internal-Token: {$token}\r\n";
        }
        $ctx = stream_context_create(['http' => [
            'method' => 'POST', 'header' => $headers, 'content' => $json,
            'timeout' => 2, 'ignore_errors' => true,
        ]]);
        @file_get_contents($wsUrl . $path, false, $ctx);
    }
}
