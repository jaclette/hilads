<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../src/NotificationCategory.php';

/** V6 notifications: categories, dedupe keys, grouping, actors, deep links. */
final class NotificationCategoryTest extends TestCase
{
    public function testCategories(): void
    {
        $cases = [
            'photo_comment' => 'social', 'daily_vote' => 'social', 'mention' => 'social', 'profile_view' => 'social',
            'daily_result' => 'game', 'daily_local_pass' => 'game', 'daily_twist_picked' => 'game', 'challenge_invitation' => 'game',
            'new_event' => 'plans', 'event_join' => 'plans', 'join_request' => 'plans',
            'city_join' => 'city', 'world_arrival' => 'city',
            'admin_announcement' => 'hilads', 'daily_admin' => 'hilads', 'something_new' => 'hilads',
        ];
        foreach ($cases as $type => $cat) {
            $this->assertSame($cat, NotificationCategory::of($type), $type);
        }
    }

    public function testCaseSqlMatchesOf(): void
    {
        $sql = NotificationCategory::caseSql('type');
        $this->assertStringContainsString("WHEN 'photo_comment' THEN 'social'", $sql);
        $this->assertStringContainsString("WHEN 'world_arrival' THEN 'city'", $sql);
        $this->assertStringContainsString("THEN 'game' ELSE 'hilads'", $sql);
    }

    public function testArrivalDedupeIsPerPersonCityAndDay(): void
    {
        $day = new DateTimeImmutable('2026-11-06 10:00', new DateTimeZone('UTC'));
        $a = NotificationCategory::dedupeKey('city_join', ['arriverName' => 'Kitty_3', 'channelId' => 'city_1'], $day);
        $b = NotificationCategory::dedupeKey('city_join', ['arriverName' => 'kitty_3 ', 'channelId' => 'city_1'], $day->modify('+5 hours'));
        $c = NotificationCategory::dedupeKey('city_join', ['arriverName' => 'kitty_3', 'channelId' => 'city_1'], $day->modify('+1 day'));
        $this->assertSame($a, $b);
        $this->assertNotSame($a, $c);
        $this->assertNull(NotificationCategory::dedupeKey('event_message', ['eventId' => 'e']));
        $this->assertSame('vote:p1:u2', NotificationCategory::dedupeKey('daily_vote', ['proofId' => 'p1', 'voterId' => 'u2']));
        $this->assertSame('result:2026-11-05', NotificationCategory::dedupeKey('daily_result', ['date' => '2026-11-05']));
    }

    public function testGroupKeys(): void
    {
        $this->assertSame('vote:p1', NotificationCategory::groupKey('daily_vote', ['proofId' => 'p1', 'voterId' => 'a']));
        $this->assertSame(NotificationCategory::groupKey('city_join', ['channelId' => 'city_1', 'arriverName' => 'a']),
                          NotificationCategory::groupKey('city_join', ['channelId' => 'city_1', 'arriverName' => 'b']));
        $this->assertNull(NotificationCategory::groupKey('mention', ['senderUserId' => 'x']));
    }

    public function testActorAndDeepLink(): void
    {
        $this->assertSame(['v1', 'Lan'], NotificationCategory::actor(['voterId' => 'v1', 'voterName' => 'Lan']));
        $this->assertSame([null, 'kitty_3'], NotificationCategory::actor(['arriverName' => 'kitty_3']));
        $this->assertSame('/daily/2026-11-05?proof=p1&comment=9',
            NotificationCategory::deepLink('photo_comment', ['proofId' => 'p1', 'date' => '2026-11-05', 'commentId' => 9]));
        $this->assertSame('/event/e1', NotificationCategory::deepLink('event_join', ['eventId' => 'e1']));
        $this->assertSame('/user/u9', NotificationCategory::deepLink('profile_view', ['viewerId' => 'u9']));
        $this->assertStringStartsWith('/ranks?', NotificationCategory::deepLink('daily_result', ['date' => '2026-11-05']));
    }
}
