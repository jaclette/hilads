<?php

declare(strict_types=1);

/**
 * The Hi chat's "question of the day" (docs/mockups/hilads_hi_chat_mockup.html): once a day,
 * in each channel, Hilads asks one question to get people talking. A city channel gets a
 * local tip question ("Where's the best coffee in Saigon?"), the World channel a question
 * comparing cities ("What do people in your city eat for breakfast?").
 *
 * Source: the back office's list (hi_questions, Admin › Hi questions), else the rotating
 * defaults below. The same question for every city on a given day (by date), so a city's
 * day is easy to talk about across channels. {city} becomes the channel's short name.
 * Switch: app_settings hi_question_enabled ('0' turns it off; on by default).
 */
final class HiQuestions
{
    /** Rotating defaults, a city channel: local tips. */
    public const CITY = [
        "Where's the best coffee in {city}?",
        "What's one dish everyone should try in {city}?",
        "Best spot in {city} to watch the sunset?",
        "Where do locals go on a Friday night in {city}?",
        "What's the most underrated neighborhood in {city}?",
        "Best street food stall in {city} right now?",
        "Where would you take a friend visiting {city} for one day?",
        "What's your favorite quiet place in {city}?",
        "Best place in {city} to work from a laptop?",
        "Which market in {city} is worth the trip?",
        "Where's the best view in {city}?",
        "What should a newcomer to {city} know on day one?",
        "Best late-night food in {city}?",
        "Where do you go for live music in {city}?",
        "What's the best way to get around {city}?",
        "Favorite breakfast spot in {city}?",
        "Where's the best park in {city} for a walk?",
        "What's a local habit in {city} visitors don't expect?",
        "Best rooftop in {city}?",
        "Where do you buy fresh fruit in {city}?",
        "What's happening in {city} this weekend?",
        "Best cheap eat in {city} under 3 dollars?",
        "Which street in {city} has the best vibe at night?",
        "Where's the best place in {city} to meet new people?",
        "Favorite dessert in {city}?",
    ];

    /** Rotating defaults, the World channel: compare cities. */
    public const WORLD = [
        "What do people in your city eat for breakfast?",
        "What time does your city wake up?",
        "What's the weather like in your city right now?",
        "How do people get around in your city?",
        "What's the one word that sums up your city?",
        "What's your city's most famous snack?",
        "What's a coffee in your city like, and how much?",
        "What do people do on Sunday in your city?",
        "What sound do you hear the most in your city?",
        "What's the best time of year to visit your city?",
        "What's your city's late-night food?",
        "How do people say hi in your city?",
        "What's a must-see in your city that tourists miss?",
        "What's the local drink in your city?",
        "What's your city's favorite sport?",
        "What does a beer cost in your city?",
        "What's the busiest street in your city?",
        "What's your city famous for that it shouldn't be?",
        "What's on the menu for lunch today where you are?",
        "Which song sounds like your city?",
    ];

    public static function enabled(): bool
    {
        return (AppConfig::settings()['hi_question_enabled'] ?? '1') !== '0';
    }

    /** The question's text for a channel scope ('city' | 'world') on a date, {city} still in it. */
    public static function textFor(string $scope, string $date): string
    {
        $list = [];
        try {
            $stmt = Database::pdo()->prepare("SELECT text FROM hi_questions WHERE scope = ? AND active ORDER BY position, id");
            $stmt->execute([$scope]);
            $list = $stmt->fetchAll(PDO::FETCH_COLUMN);
        } catch (\Throwable) {
            // before the migration: the defaults
        }
        if ($list === []) $list = $scope === 'world' ? self::WORLD : self::CITY;
        $day = (int) floor(strtotime($date . ' 00:00:00 UTC') / 86400);
        return (string) $list[$day % count($list)];
    }

    /** The question with the channel's city in it. */
    public static function render(string $text, ?string $cityName): string
    {
        return str_replace('{city}', $cityName !== null && $cityName !== '' ? $cityName : 'your city', $text);
    }

    /** The Hi chat's reads ask for chat rows only (?chat=1, the rebuilt Hi screen). */
    public static function chatMode(): bool
    {
        return ($_GET['chat'] ?? '') === '1';
    }

    /**
     * Today's question in a channel, posted once (by the Hilads account, a system row
     * event 'hi_question', payload {date, scope, text}). Idempotent: a unique index on
     * (channel, date) keeps it at one even when two first readers race. Never throws.
     */
    public static function ensure(int|string $channelId, ?string $cityName): void
    {
        if (!self::enabled()) return;
        try {
            $date  = DailyClock::currentDate();
            $scope = $channelId === 'world' ? 'world' : 'city';
            $dbKey = is_int($channelId) ? 'city_' . $channelId : (string) $channelId;
            $stmt  = Database::pdo()->prepare("SELECT 1 FROM messages WHERE channel_id = ? AND type = 'system' AND event = 'hi_question' AND payload->>'date' = ? LIMIT 1");
            $stmt->execute([$dbKey, $date]);
            if ($stmt->fetchColumn() !== false) return;
            $text = self::render(self::textFor($scope, $date), $cityName);
            Database::pdo()->prepare("
                INSERT INTO messages (id, channel_id, type, event, content, nickname, user_id, payload, created_at)
                VALUES (?, ?, 'system', 'hi_question', ?, 'Hilads', (SELECT id FROM users WHERE is_admin ORDER BY created_at LIMIT 1), ?::jsonb, ?::timestamptz)
                ON CONFLICT DO NOTHING
            ")->execute([bin2hex(random_bytes(8)), $dbKey, $text, json_encode(['date' => $date, 'scope' => $scope, 'text' => $text]),
                         // Dated at the day's drop: the question opens the day's conversation.
                         DailyClock::window($date)[0]->format(DATE_ATOM)]);
        } catch (\Throwable $e) {
            error_log('[hi] question failed: ' . $e->getMessage());
        }
    }

    /** Adds each question's answers count (replies to it) into its payload. */
    public static function decorate(array &$messages): void
    {
        $ids = [];
        foreach ($messages as $m) {
            if (($m['type'] ?? null) === 'system' && ($m['event'] ?? null) === 'hi_question' && isset($m['id'])) $ids[] = $m['id'];
        }
        if ($ids === []) return;
        $in   = implode(',', array_fill(0, count($ids), '?'));
        $stmt = Database::pdo()->prepare("SELECT reply_to_id, count(*) FROM messages WHERE reply_to_id IN ({$in}) AND deleted_at IS NULL GROUP BY reply_to_id");
        $stmt->execute($ids);
        $counts = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
        foreach ($messages as &$m) {
            if (isset($m['id']) && in_array($m['id'], $ids, true)) {
                $m['payload'] = (array) ($m['payload'] ?? []) + ['answers' => (int) ($counts[$m['id']] ?? 0)];
                $m['payload']['answers'] = (int) ($counts[$m['id']] ?? 0);
            }
        }
        unset($m);
    }

    /** The Hi header's live counts: a city {here, members}, the World {here, cities}. */
    public static function header(int|string $channelId): array
    {
        try {
            if ($channelId === 'world') {
                $a = WorldRepository::activity();
                return ['here' => (int) ($a['online'] ?? 0), 'cities' => (int) ($a['cities'] ?? 0)];
            }
            $stmt = Database::pdo()->prepare("SELECT count(*) FROM users WHERE deleted_at IS NULL AND current_city_id = ?");
            $stmt->execute(['city_' . (int) $channelId]);
            return ['here' => PresenceRepository::getCount((int) $channelId), 'members' => (int) $stmt->fetchColumn()];
        } catch (\Throwable) {
            return [];
        }
    }

    /** "🎉 maxime created a plan · Coffee at Cheo Leo, Sat 10:00": a tappable line in the plan's city chat. */
    public static function planCreated(int $channelId, array $event, string $nickname, ?string $userId): ?array
    {
        try {
            $payload = ['eventId' => $event['id'], 'title' => $event['title'] ?? '', 'startsAt' => (int) ($event['starts_at'] ?? 0)];
            $id = bin2hex(random_bytes(8));
            Database::pdo()->prepare("
                INSERT INTO messages (id, channel_id, type, event, content, nickname, user_id, payload)
                VALUES (?, ?, 'system', 'plan_created', ?, ?, ?, ?::jsonb)
            ")->execute([$id, 'city_' . $channelId, (string) ($event['title'] ?? ''), $nickname, $userId, json_encode($payload)]);
            return ['id' => $id, 'type' => 'system', 'event' => 'plan_created', 'nickname' => $nickname, 'userId' => $userId,
                    'content' => $event['title'] ?? '', 'payload' => $payload, 'createdAt' => time()];
        } catch (\Throwable $e) {
            error_log('[hi] plan line failed: ' . $e->getMessage());
            return null;
        }
    }
}
