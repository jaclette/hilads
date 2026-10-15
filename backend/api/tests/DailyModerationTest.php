<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class DailyModerationTest extends TestCase
{
    private static function proofRow(array $over = []): array
    {
        return $over + [
            'id' => 'p1', 'challenge_id' => 'c1', 'challenge_date' => '2026-11-02',
            'user_id' => 'u1', 'username' => 'anh', 'display_name' => 'Anh', 'profile_photo_url' => null,
            'is_local' => 't', 'city_id' => 'city_20', 'city_name' => 'Ho Chi Minh City',
            'photo_url' => 'https://media.test/0123456789abcdef0123456789abcdef.jpg', 'caption' => 'Cơm tấm',
        ];
    }

    public function testProofCardPayload(): void
    {
        $p = DailyCards::proofPayload(self::proofRow(), 'Eat what locals eat');
        $this->assertSame('p1', $p['proofId']);
        $this->assertSame('Eat what locals eat', $p['challengeText']);
        $this->assertSame(['id' => 20, 'name' => 'Ho Chi Minh City'], $p['city']);
        $this->assertTrue($p['isLocal']);
        $this->assertSame('Cơm tấm', $p['caption']);
        $this->assertSame('anh', $p['user']['username']);
    }

    public function testCardWithoutCity(): void
    {
        $p = DailyCards::proofPayload(self::proofRow(['city_id' => null, 'city_name' => null, 'is_local' => 'f']), 'x');
        $this->assertNull($p['city']);
        $this->assertFalse($p['isLocal']);
    }

    public function testFallbackContentLine(): void
    {
        $this->assertSame("📸 Anh completed today's Daily Challenge", DailyCards::proofContent(self::proofRow()));
        $this->assertSame("📸 anh completed today's Daily Challenge", DailyCards::proofContent(self::proofRow(['display_name' => ''])));
    }

    public function testReportThreshold(): void
    {
        $this->assertFalse(DailyModerationService::shouldHide(2));
        $this->assertTrue(DailyModerationService::shouldHide(3));
    }

    public function testInvalidReportReasonIsRefusedBeforeAnyQuery(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('invalid_reason');
        DailyModerationService::report(self::proofRow(), 'u2', null, 'meh', null);
    }

    public function testCannotReportOwnProof(): void
    {
        $this->expectExceptionMessage('own_proof');
        DailyModerationService::report(self::proofRow(), 'u1', null, 'spam', null);
    }

    public function testAutoApproveFlag(): void
    {
        putenv('DAILY_AUTO_APPROVE');
        $this->assertFalse(DailyModerationService::autoApproveEnabled());
        putenv('DAILY_AUTO_APPROVE=true');
        $this->assertTrue(DailyModerationService::autoApproveEnabled());
        putenv('DAILY_AUTO_APPROVE');
    }
}
