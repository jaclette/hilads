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
 * Flood control (V2-08): a channel gets at most FLOOD_PER_HOUR individual
 * proof cards per clock hour (UTC). Further proofs that hour join one
 * daily_proof_group card for (channel, hour), updated in place as proofs
 * arrive or leave ("8 new proofs: Saigon, Lisbon and 6 more"); it is deleted
 * when its last proof goes. A proof never moves: once on its own card or in a
 * group, a re-approval updates it there.
 *
 * Lives in src/ (not routes/) so the back office can call it too.
 */
final class DailyCards
{
    public const EVENT_PROOF    = 'daily_proof';
    public const EVENT_GROUP    = 'daily_proof_group';
    public const FLOOD_PER_HOUR = 6;   // individual proof cards per channel and clock hour

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
            'isEarly'       => DailyProofRepository::bool($proof['is_early'] ?? false),
            'city'          => $cityId !== null ? ['id' => $cityId, 'name' => $proof['city_name'], 'country' => $proof['city_country'] ?? null] : null,
            'photoUrl'      => $proof['photo_url'],
            'thumbUrl'      => R2Uploader::thumbProxy($proof['photo_url']),
            // Dual photo: the selfie inset (null: a single photo; older apps ignore it).
            'selfieUrl'      => $proof['selfie_url'] ?? null,
            'selfieThumbUrl' => ($proof['selfie_url'] ?? null) !== null ? R2Uploader::thumbProxy($proof['selfie_url']) : null,
            'caption'       => $proof['caption'],
            // V3-09: the theme chip and the spot on the Chat card.
            'theme'         => DailyThemes::format($proof['challenge_theme'] ?? null, $proof['challenge_date'] ?? null),
            'spot'          => ($proof['place_id'] ?? null) !== null && ($proof['spot_status'] ?? null) === 'approved'
                ? ['id' => $proof['place_id'], 'name' => $proof['spot_name']] : null,
        ];
    }

    /** English fallback line, shown as plain text by app versions without the card. */
    public static function proofContent(array $proof): string
    {
        $name = trim((string) ($proof['display_name'] ?: $proof['username'] ?: 'Someone'));
        return "📸 {$name} completed today's Daily Challenge";
    }

    // ── Flood control: pure helpers (unit-tested) ──────────────────────────────

    /** The clock hour (UTC) a card belongs to: "2026-11-02T09". */
    public static function hourBucket(DateTimeImmutable $at): string
    {
        return $at->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH');
    }

    /** One proof inside a group card. Pure. */
    public static function groupEntry(array $proof): array
    {
        $cityId = $proof['city_id'] !== null ? (int) substr((string) $proof['city_id'], 5) : null;
        return [
            'proofId'  => $proof['id'],
            'date'     => $proof['challenge_date'],
            'thumbUrl' => R2Uploader::thumbProxy($proof['photo_url']),
            'user'     => ['id' => $proof['user_id'], 'username' => $proof['username'], 'displayName' => $proof['display_name']],
            'city'     => $cityId !== null ? ['id' => $cityId, 'name' => $proof['city_name'], 'country' => $proof['city_country'] ?? null] : null,
            'isLocal'  => DailyProofRepository::bool($proof['is_local']),
        ];
    }

    /** Group card payload from its entries (oldest first): proof ids, count, distinct cities. Pure. */
    public static function groupPayload(string $hour, array $entries): array
    {
        $cities = $countries = [];
        foreach ($entries as $e) {
            if ($e['city'] !== null && !in_array($e['city']['name'], $cities, true)) {
                $cities[]    = $e['city']['name'];
                $countries[] = $e['city']['country'] ?? null;
            }
        }
        return [
            'hour'      => $hour,
            'proofIds'  => array_column($entries, 'proofId'),
            'proofs'    => array_values($entries),
            'count'     => count($entries),
            'cities'    => $cities,
            'countries' => $countries,   // same order as cities
        ];
    }

    /** English fallback line: "📸 8 new proofs: Saigon, Lisbon and 6 more". Pure. */
    public static function groupContent(array $payload): string
    {
        $n     = (int) $payload['count'];
        $named = array_slice($payload['cities'], 0, 2);
        $more  = $n - count($named);
        $where = $named === [] ? '' : ': ' . implode(', ', $named) . ($more > 0 ? " and {$more} more" : '');
        return "📸 {$n} new " . ($n === 1 ? 'proof' : 'proofs') . $where;
    }

    /** Add (or replace) a proof's entry, keeping the order. Pure. */
    public static function withEntry(array $entries, array $entry): array
    {
        foreach ($entries as $i => $e) {
            if ($e['proofId'] === $entry['proofId']) {
                $entries[$i] = $entry;
                return array_values($entries);
            }
        }
        $entries[] = $entry;
        return array_values($entries);
    }

    /**
     * Post (or update in place) the cards of an approved proof: World, plus
     * the city channel when the city is live. Idempotent per channel. Past
     * FLOOD_PER_HOUR cards in a channel this hour, the proof joins the hour's
     * group card instead (V2-08).
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
                // Flood control (V2-08): already in a group, or past the hour's cards → the group card.
                if (self::updateInGroup($dbChannel, $proof)) {
                    continue;
                }
                if (self::cardsThisHour($dbChannel) >= self::FLOOD_PER_HOUR) {
                    self::addToGroup($dbChannel, $proof);
                    continue;
                }
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
        $translations = self::translations($challenge, $twist !== null ? $twistI18n : null);
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

    /**
     * {locale: {text, context, twist}} from a challenge row's i18n maps and,
     * when the card has a twist, the twist's text_i18n. Pure.
     */
    public static function translations(array $challenge, ?array $twistI18n): array
    {
        $text    = json_decode((string) $challenge['text_i18n'], true) ?: [];
        $context = json_decode((string) ($challenge['context_i18n'] ?? '{}'), true) ?: [];
        $hasContext = trim((string) ($context['en'] ?? '')) !== '';
        $out = [];
        foreach (DailyI18n::others() as $l) {
            $t  = DailyI18n::pick($text, $l);
            $cx = $hasContext ? DailyI18n::pick($context, $l) : null;
            $tw = $twistI18n !== null ? DailyI18n::pick($twistI18n, $l) : null;
            if ($t !== null || $tw !== null) {
                $out[$l] = array_filter(['text' => $t, 'context' => $cx, 'twist' => $tw], static fn($v) => $v !== null);
            }
        }
        return $out;
    }

    /**
     * daily_challenge cards keep the text of drop time in their payload. On
     * read, refresh the English text and the translations from the challenge
     * and its twist, so cards posted before a translation was written (or
     * edited) show the reader's language. Two small queries per page, only
     * when the page holds a card.
     */
    /**
     * Fill in the country of the cities on Daily cards stored before cards
     * carried it (proof and group cards, the challenge's "Proposed by"), so
     * every card can show the city's flag. Cached city list, no query.
     */
    public static function addCityCountries(array &$messages): void
    {
        $fill = static function (?array &$city): void {
            if (is_array($city) && !array_key_exists('country', $city) && isset($city['id'])) {
                $city['country'] = CityRepository::countryOf((int) $city['id']);
            }
        };
        foreach ($messages as &$m) {
            $event = $m['event'] ?? null;
            if (!isset($m['payload']) || !is_array($m['payload'])) {
                continue;
            }
            if ($event === self::EVENT_PROOF) {
                $fill($m['payload']['city']);
            } elseif ($event === self::EVENT_GROUP) {
                foreach ($m['payload']['proofs'] ?? [] as $i => $e) {
                    $fill($m['payload']['proofs'][$i]['city']);
                }
                if (!isset($m['payload']['countries'])) {
                    $byName = [];
                    foreach ($m['payload']['proofs'] ?? [] as $e) {
                        if (isset($e['city']['name'])) {
                            $byName[$e['city']['name']] = $e['city']['country'] ?? null;
                        }
                    }
                    $m['payload']['countries'] = array_map(static fn($n) => $byName[$n] ?? null, $m['payload']['cities'] ?? []);
                }
            } elseif ($event === 'daily_challenge') {
                if (isset($m['payload']['proposedBy']['city'])) {
                    $fill($m['payload']['proposedBy']['city']);
                }
                foreach ($m['payload']['yesterdayTop3'] ?? [] as $i => $r) {
                    $fill($m['payload']['yesterdayTop3'][$i]['city']);
                }
            }
        }
        unset($m);
    }

    public static function refreshChallengeCards(array &$messages): void
    {
        $ids = $twistIds = [];
        foreach ($messages as $m) {
            if (($m['event'] ?? null) === 'daily_challenge' && !empty($m['payload']['challengeId'])) {
                $ids[] = (string) $m['payload']['challengeId'];
                if (!empty($m['payload']['twist']['id'])) {
                    $twistIds[] = (string) $m['payload']['twist']['id'];
                }
            }
        }
        if ($ids === []) {
            return;
        }
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("SELECT id, text_i18n, context_i18n FROM daily_challenges WHERE id = ANY (string_to_array(?, ','))");
        $stmt->execute([implode(',', array_unique($ids))]);
        $challenges = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $challenges[$r['id']] = $r;
        }
        $twists = [];
        if ($twistIds !== []) {
            $stmt = $pdo->prepare("SELECT id, text_i18n FROM daily_twists WHERE id = ANY (string_to_array(?, ','))");
            $stmt->execute([implode(',', array_unique($twistIds))]);
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $twists[$r['id']] = json_decode((string) $r['text_i18n'], true) ?: [];
            }
        }

        foreach ($messages as &$m) {
            $c = ($m['event'] ?? null) === 'daily_challenge' ? ($challenges[$m['payload']['challengeId'] ?? ''] ?? null) : null;
            if ($c === null) {
                continue;
            }
            $text    = json_decode((string) $c['text_i18n'], true) ?: [];
            $context = json_decode((string) ($c['context_i18n'] ?? '{}'), true) ?: [];
            if (trim((string) ($text['en'] ?? '')) !== '') {
                $m['payload']['text'] = $text['en'];
            }
            $m['payload']['context'] = trim((string) ($context['en'] ?? '')) !== '' ? $context['en'] : null;
            $twistId = $m['payload']['twist']['id'] ?? null;
            $m['payload']['translations'] = (object) self::translations($c, $twistId !== null ? ($twists[$twistId] ?? []) : null);
        }
        unset($m);
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
        $hilads   = self::hiladsId();
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

    /**
     * Delete every card of a proof (reactions cascade), take it out of any
     * group card (deleting a group left empty), and tell connected clients.
     */
    public static function hideProof(string $proofId, ?string $cityId): void
    {
        $pdo = Database::pdo();
        foreach (self::cardRows($proofId, $cityId) as $row) {
            $pdo->prepare("DELETE FROM messages WHERE id = ?")->execute([$row['id']]);
            self::broadcastDeleted($row['channel_id'], $row['id']);
        }
        foreach (array_filter(['world', $cityId]) as $dbChannel) {
            $pdo->beginTransaction();
            try {
                $group = self::lockGroupWith($dbChannel, $proofId);
                if ($group === null) {
                    $pdo->commit();
                    continue;
                }
                $entries = array_values(array_filter($group['entries'], static fn(array $e): bool => $e['proofId'] !== $proofId));
                if ($entries === []) {
                    $pdo->prepare("DELETE FROM messages WHERE id = ?")->execute([$group['id']]);
                    $pdo->commit();
                    self::broadcastDeleted($dbChannel, $group['id']);
                    continue;
                }
                $payload = self::saveGroup($group['id'], $group['hour'], $entries);
                $pdo->commit();
                self::broadcastGroup($dbChannel, $group['id'], $payload, $group['created_at']);
            } catch (\Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
        }
    }

    // ── Flood control (V2-08) ────────────────────────────────────────────────

    /** Individual proof cards posted in a channel since the start of this clock hour (UTC). */
    private static function cardsThisHour(string $dbChannel): int
    {
        $stmt = Database::pdo()->prepare("
            SELECT count(*) FROM messages
            WHERE channel_id = ? AND event = 'daily_proof'
              AND created_at >= date_trunc('hour', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        ");
        $stmt->execute([$dbChannel]);
        return (int) $stmt->fetchColumn();
    }

    /** Add a proof to this hour's group card of a channel (created on first use). */
    private static function addToGroup(string $dbChannel, array $proof): void
    {
        $hour  = self::hourBucket(new DateTimeImmutable('now'));
        $entry = self::groupEntry($proof);
        $pdo   = Database::pdo();
        $pdo->beginTransaction();
        try {
            $payload = self::groupPayload($hour, [$entry]);
            $insert  = $pdo->prepare("
                INSERT INTO messages (id, channel_id, type, event, user_id, nickname, content, payload)
                VALUES (?, ?, 'system', 'daily_proof_group', ?, 'Hilads', ?, ?::jsonb)
                ON CONFLICT DO NOTHING
                RETURNING id, EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at
            ");
            $insert->execute([bin2hex(random_bytes(8)), $dbChannel, self::hiladsId(), self::groupContent($payload),
                              json_encode($payload, JSON_UNESCAPED_UNICODE)]);
            $row = $insert->fetch(PDO::FETCH_ASSOC);
            if ($row === false) {
                // The hour's group exists: add to it under a row lock.
                $stmt = $pdo->prepare("
                    SELECT id, payload, EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at FROM messages
                    WHERE channel_id = ? AND event = 'daily_proof_group' AND payload->>'hour' = ?
                    FOR UPDATE
                ");
                $stmt->execute([$dbChannel, $hour]);
                $g       = $stmt->fetch(PDO::FETCH_ASSOC);
                $entries = json_decode((string) $g['payload'], true)['proofs'] ?? [];
                $payload = self::saveGroup($g['id'], $hour, self::withEntry($entries, $entry));
                $row     = $g;
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        self::broadcastGroup($dbChannel, $row['id'], $payload, (int) $row['created_at']);
    }

    /** Re-approval of a proof already in a group card: update its entry there. True when it was in one. */
    private static function updateInGroup(string $dbChannel, array $proof): bool
    {
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $group = self::lockGroupWith($dbChannel, $proof['id']);
            if ($group === null) {
                $pdo->commit();
                return false;
            }
            $payload = self::saveGroup($group['id'], $group['hour'], self::withEntry($group['entries'], self::groupEntry($proof)));
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        self::broadcastGroup($dbChannel, $group['id'], $payload, $group['created_at']);
        return true;
    }

    /** The group card of a channel holding a proof, locked: {id, hour, entries, created_at}, or null. Call in a transaction. */
    private static function lockGroupWith(string $dbChannel, string $proofId): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT id, payload, EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at FROM messages
            WHERE channel_id = ? AND event = 'daily_proof_group' AND payload->'proofIds' @> jsonb_build_array(?::text)
            FOR UPDATE
        ");
        $stmt->execute([$dbChannel, $proofId]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$r) {
            return null;
        }
        $payload = json_decode((string) $r['payload'], true) ?: [];
        return ['id' => $r['id'], 'hour' => (string) ($payload['hour'] ?? ''), 'entries' => $payload['proofs'] ?? [],
                'created_at' => (int) $r['created_at']];
    }

    /** Write a group card's payload and fallback line. Returns the payload. */
    private static function saveGroup(string $id, string $hour, array $entries): array
    {
        $payload = self::groupPayload($hour, $entries);
        Database::pdo()->prepare("UPDATE messages SET payload = ?::jsonb, content = ? WHERE id = ?")
            ->execute([json_encode($payload, JSON_UNESCAPED_UNICODE), self::groupContent($payload), $id]);
        return $payload;
    }

    /** Same id on every update: clients replace the card. */
    private static function broadcastGroup(string $dbChannel, string $id, array $payload, int $createdAt): void
    {
        self::postToWs('/broadcast/message', [
            'channelId' => self::clientChannel($dbChannel),
            'message'   => [
                'id'        => $id,
                'type'      => 'system',
                'event'     => self::EVENT_GROUP,
                'guestId'   => null,
                'userId'    => self::hiladsId(),
                'nickname'  => 'Hilads',
                'content'   => self::groupContent($payload),
                'payload'   => $payload,
                'createdAt' => $createdAt,
            ],
        ]);
    }

    private static function broadcastDeleted(string $dbChannel, string $id): void
    {
        self::postToWs('/broadcast/message-deleted', [
            'channelId' => self::clientChannel($dbChannel),
            'messageId' => $id,
            'deletedAt' => time(),
        ]);
    }

    /** The seeded @hilads brand account (migrate.php) that posts Daily cards. */
    private static function hiladsId(): string
    {
        return md5('hilads-admin');
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
