<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class R2UploaderTest extends TestCase
{
    protected function tearDown(): void
    {
        unset($_SERVER['HTTP_X_FORWARDED_PROTO'], $_SERVER['HTTPS'], $_SERVER['HTTP_HOST']);
    }

    public function testThumbProxyUsesTheRequestScheme(): void
    {
        $_SERVER['HTTP_HOST'] = 'api.hilads.live';
        $_SERVER['HTTP_X_FORWARDED_PROTO'] = 'https';
        $this->assertSame('https://api.hilads.live/api/v1/img-thumb?f=0123456789abcdef0123456789abcdef.jpg',
            R2Uploader::thumbProxy('https://media.hilads.live/0123456789ABCDEF0123456789abcdef.jpg'));

        unset($_SERVER['HTTP_X_FORWARDED_PROTO']);
        $_SERVER['HTTP_HOST'] = '127.0.0.1:8099';
        $this->assertSame('http://127.0.0.1:8099/api/v1/img-thumb?f=0123456789abcdef0123456789abcdef.jpg',
            R2Uploader::thumbProxy('https://media.test/0123456789abcdef0123456789abcdef.jpg'));
    }

    public function testThumbProxyLeavesOtherUrls(): void
    {
        $this->assertSame('https://picsum.photos/id/1/600', R2Uploader::thumbProxy('https://picsum.photos/id/1/600'));
        $this->assertNull(R2Uploader::thumbProxy(null));
    }
}
