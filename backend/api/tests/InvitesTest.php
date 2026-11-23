<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../src/Request.php';
require_once __DIR__ . '/../src/Invites.php';

/** Invitations: codes, the install id header, the hashed IP. */
final class InvitesTest extends TestCase
{
    protected function tearDown(): void
    {
        unset($_SERVER['HTTP_X_INSTALL_ID'], $_SERVER['HTTP_CF_CONNECTING_IP']);
    }

    public function testCodesAreNormalized(): void
    {
        self::assertSame('UP52UCV', Invites::normalize(' up52ucv '));
        self::assertNull(Invites::normalize('bad code'));
        self::assertNull(Invites::normalize('ab'));
        self::assertNull(Invites::normalize(null));
    }

    public function testInstallIdHeader(): void
    {
        self::assertNull(Invites::installId());
        $_SERVER['HTTP_X_INSTALL_ID'] = '3f1c2a9e-7b4d-4c1e-9a55-0d2f6b8e1c77';
        self::assertSame('3f1c2a9e-7b4d-4c1e-9a55-0d2f6b8e1c77', Invites::installId());
        $_SERVER['HTTP_X_INSTALL_ID'] = "x'; DROP TABLE users; --";
        self::assertNull(Invites::installId());
    }

    public function testIpIsHashedNeverStoredReadable(): void
    {
        $a = Invites::ipHash('203.0.113.7');
        self::assertSame(32, strlen((string) $a));
        self::assertStringNotContainsString('203', (string) $a);
        self::assertSame($a, Invites::ipHash('203.0.113.7'));
        self::assertNotSame($a, Invites::ipHash('203.0.113.8'));
        self::assertNull(Invites::ipHash('unknown'));
    }
}
