<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../src/AdminAuth.php';

/** Back office accounts: TOTP codes (RFC 6238 vectors), recovery code hashing, role permissions. */
final class AdminAuthTest extends TestCase
{
    // RFC 6238 appendix B, SHA-1 seed "12345678901234567890" (base32 below), last 6 digits.
    private const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

    public function testBase32RoundTrip(): void
    {
        $bin = random_bytes(20);
        self::assertSame($bin, AdminTotp::base32Decode(AdminTotp::base32Encode($bin)));
        self::assertSame('12345678901234567890', AdminTotp::base32Decode(self::RFC_SECRET));
    }

    public function testRfc6238Vectors(): void
    {
        foreach ([59 => '287082', 1111111109 => '081804', 1111111111 => '050471', 1234567890 => '005924', 2000000000 => '279037'] as $t => $code) {
            self::assertSame($code, AdminTotp::code(self::RFC_SECRET, intdiv($t, 30)), "t={$t}");
        }
    }

    public function testVerifyAcceptsOneStepEitherSideAndRefusesReplay(): void
    {
        $now = 1_800_000_000;
        $step = intdiv($now, 30);
        $s = AdminTotp::newSecret();
        self::assertSame($step, AdminTotp::verify($s, AdminTotp::code($s, $step), null, $now));
        self::assertSame($step - 1, AdminTotp::verify($s, AdminTotp::code($s, $step - 1), null, $now));
        self::assertNull(AdminTotp::verify($s, AdminTotp::code($s, $step - 2), null, $now));
        self::assertNull(AdminTotp::verify($s, AdminTotp::code($s, $step), $step, $now), 'a used code is refused');
        self::assertSame($step, AdminTotp::verify($s, substr(AdminTotp::code($s, $step), 0, 3) . ' ' . substr(AdminTotp::code($s, $step), 3), null, $now), 'spaces ignored');
        self::assertNull(AdminTotp::verify($s, '12345', null, $now));
    }

    public function testRecoveryCodeHashIgnoresCaseAndDashes(): void
    {
        self::assertSame(AdminAuth::codeHash('abcd-efgh-2345'), AdminAuth::codeHash('ABCD EFGH 2345'));
        self::assertNotSame(AdminAuth::codeHash('abcd-efgh-2345'), AdminAuth::codeHash('abcd-efgh-2346'));
    }

    public function testAreas(): void
    {
        self::assertSame('danger', AdminAuth::area('/admin/scores/reset-all'));
        self::assertSame('danger', AdminAuth::area('/admin/cities/city_12/merge'));
        self::assertSame('community', AdminAuth::area('/admin/cities/city_12'));
        self::assertSame('live', AdminAuth::area('/admin/daily/today'));
        self::assertSame('places', AdminAuth::area('/admin/daily/spots/abc'));
        self::assertSame('content', AdminAuth::area('/admin/daily/2026-11-25'));
        self::assertSame('archive', AdminAuth::area('/admin/campaigns/create'));
        self::assertSame('moderation', AdminAuth::area('/admin/arrivals'), 'Arrivals is a working page again (bans from it)');
        self::assertSame('any', AdminAuth::area('/admin'));
        self::assertSame('settings', AdminAuth::area('/admin/something-new'), 'unmapped pages are super admin only');
    }

    public function testRoles(): void
    {
        self::assertTrue(AdminAuth::canEdit('super_admin', 'danger'));
        self::assertFalse(AdminAuth::canEdit('super_admin', 'archive'), 'the archive is read-only for everyone');
        self::assertTrue(AdminAuth::canView('super_admin', 'archive'));

        self::assertFalse(AdminAuth::canView('moderator', 'danger'));
        self::assertFalse(AdminAuth::canView('moderator', 'settings'));
        self::assertTrue(AdminAuth::canEdit('moderator', 'moderation'));
        self::assertTrue(AdminAuth::canEdit('moderator', 'live'));
        self::assertFalse(AdminAuth::canEdit('moderator', 'content'));
        self::assertFalse(AdminAuth::canEdit('moderator', 'growth'));

        self::assertTrue(AdminAuth::canEdit('editor', 'content'));
        self::assertTrue(AdminAuth::canEdit('editor', 'studio'));
        self::assertFalse(AdminAuth::canEdit('editor', 'moderation'));
        self::assertTrue(AdminAuth::canView('editor', 'moderation'));

        self::assertTrue(AdminAuth::canView('viewer', 'content'));
        self::assertFalse(AdminAuth::canEdit('viewer', 'content'));
        self::assertTrue(AdminAuth::canEdit('viewer', 'self'), 'everyone manages their own account');
        self::assertFalse(AdminAuth::canView(null, 'any'));
    }

    public function testPasswordRules(): void
    {
        self::assertNotNull(AdminAuth::passwordProblem('short'));
        self::assertNotNull(AdminAuth::passwordProblem('aaaaaaaaaaaaaaaa'));
        self::assertNotNull(AdminAuth::passwordProblem('jacques-long-secret', 'jacques@example.com'));
        self::assertNull(AdminAuth::passwordProblem('blue-otter-lamp-42', 'jacques@example.com'));
    }
}
