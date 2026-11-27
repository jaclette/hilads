<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** One push per (recipient, event): the guard, the "just played" push through it, the admin alert's text. */
final class PushOnceTest extends TestCase
{
    protected function setUp(): void
    {
        $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec('CREATE TABLE push_once (event_key TEXT NOT NULL, recipient_key TEXT NOT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (event_key, recipient_key))');
        Database::setInstance($pdo);
    }

    protected function tearDown(): void
    {
        Database::reset();
    }

    public function testTheSameEventNeverClaimsTheSameRecipientTwice(): void
    {
        $this->assertSame(['u:a', 'u:b'], PushOnce::claim('new_photo:p1', ['u:a', 'u:b', 'u:a']));
        $this->assertSame([], PushOnce::claim('new_photo:p1', ['u:a', 'u:b']), 'a second call pushes nobody');
        $this->assertSame(['g:c'], PushOnce::claim('new_photo:p1', ['u:a', 'g:c']), 'only the new recipient');
        $this->assertSame(['u:a'], PushOnce::claim('new_photo:p2', ['u:a']), 'another event is another push');
        $this->assertSame([], PushOnce::claim('new_photo:p3', []));
    }

    public function testManyRecipientsInChunks(): void
    {
        $all = array_map(static fn($i) => "u:{$i}", range(1, 1203));
        $this->assertCount(1203, PushOnce::claim('new_photo:big', $all));
        $this->assertSame([], PushOnce::claim('new_photo:big', $all));
    }

    public function testFailsOpenWithoutTheTable(): void
    {
        Database::setInstance(new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]));
        $this->assertSame(['u:a'], PushOnce::claim('new_photo:p1', ['u:a']));
    }

    /** "📸 X just played": each person's devices once per photo, however often it is sent. */
    public function testJustPlayedReachesEachPersonOncePerPhoto(): void
    {
        $devices = [
            'u:lan'  => ['en', ['ExponentPushToken[lan-phone]', 'ExponentPushToken[lan-tablet]']],
            'u:minh' => ['vi', ['ExponentPushToken[minh]']],
            'g:anon' => ['en', ['ExponentPushToken[anon]']],
        ];
        $this->assertSame([
            'en' => ['ExponentPushToken[lan-phone]', 'ExponentPushToken[lan-tablet]', 'ExponentPushToken[anon]'],
            'vi' => ['ExponentPushToken[minh]'],
        ], DailyPushes::newPhotoTokens('proof1', $devices));
        $this->assertSame([], DailyPushes::newPhotoTokens('proof1', $devices), 'the same photo again: no push');
        $this->assertSame(['vi' => ['ExponentPushToken[minh]']],
            DailyPushes::newPhotoTokens('proof2', ['u:minh' => $devices['u:minh']]), 'the next photo pushes');
    }

    public function testAdminAlertIsLabelledAndOpensTheModerationQueue(): void
    {
        $this->assertSame(['[Admin] New photo to check · Berlin', '@clemskramz · Daily photo'],
            PhotoWatch::alertText('daily', '@clemskramz', 'Berlin', 1));
        $this->assertSame(['[Admin] New photo to check · Saigon', '@linh · Chat photo · 3 new'],
            PhotoWatch::alertText('chat', '@linh', 'Ho Chi Minh City', 3));
        $this->assertSame(['[Admin] New photo to check', 'Lan · Profile photo'],
            PhotoWatch::alertText('avatar', 'Lan', null, 0));
        $url = PhotoWatch::queueUrl('abc123');
        $this->assertStringEndsWith('/admin/photos?tab=all&q=abc123', $url);
    }
}
