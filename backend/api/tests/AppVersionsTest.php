<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Admin › App versions: per-platform versions, and the 426 for apps from before the update screen. */
final class AppVersionsTest extends TestCase
{
    private array $server;

    protected function setUp(): void
    {
        $this->server = $_SERVER;
        unset($_SERVER['HTTP_X_PLATFORM'], $_SERVER['HTTP_X_APP_VERSION'], $_SERVER['HTTP_ACCEPT_LANGUAGE']);
        Response::reset();
    }

    protected function tearDown(): void
    {
        $_SERVER = $this->server;
        putenv('APP_MIN_VERSION');
        putenv('APP_LATEST_VERSION');
        AppConfig::setSettings(null);
    }

    public function testVersionsPerPlatform(): void
    {
        putenv('APP_MIN_VERSION=1.7.0');
        AppConfig::setSettings(['ios_min_version' => '1.8.1', 'android_min_version' => '', 'android_latest_version' => '1.8.2']);
        $this->assertSame('1.8.1', AppConfig::payload('ios')['minVersion']);
        $this->assertSame('1.7.0', AppConfig::payload('android')['minVersion'], 'empty = the environment');
        $this->assertSame('1.8.2', AppConfig::payload('android')['latestVersion']);
        $this->assertNull(AppConfig::payload('ios')['latestVersion']);
        $this->assertSame('1.8.1', AppConfig::payload('unknown')['minVersion'], 'no platform: the stricter one');
        $this->assertSame('1.8.2', AppConfig::payload(null)['latestVersion']);
    }

    public function testOnlyAppsWithoutAVersionAreOld(): void
    {
        $cases = [
            // [X-Platform, X-App-Version, old?]
            [null,      null,    false],   // crawlers, Vercel functions, the app's raw uploads
            ['web',     null,    false],   // the web app
            ['ios',     '1.8.0', false],   // has the update screen
            ['android', '1.8.2', false],
            ['ios',     null,    true],    // 1.6.x / 1.7.x
            ['android', '',      true],
        ];
        foreach ($cases as [$platform, $version, $old]) {
            unset($_SERVER['HTTP_X_PLATFORM'], $_SERVER['HTTP_X_APP_VERSION']);
            if ($platform !== null) $_SERVER['HTTP_X_PLATFORM'] = $platform;
            if ($version !== null) $_SERVER['HTTP_X_APP_VERSION'] = $version;
            $this->assertSame($old, AppConfig::isOldApp(), var_export([$platform, $version], true));
        }
    }

    public function testOldAppsGet426OnlyWhenSwitchedOn(): void
    {
        $_SERVER['HTTP_X_PLATFORM'] = 'android';
        $_SERVER['HTTP_ACCEPT_LANGUAGE'] = 'fr-FR,fr;q=0.9';

        AppConfig::setSettings(['block_old_apps' => '0']);
        AppConfig::guardOldApp('/api/v1/channels/1/messages');
        $this->assertNull(Response::$lastStatus, 'off by default');

        AppConfig::setSettings(['block_old_apps' => '1']);
        AppConfig::guardOldApp('/api/v1/app/config');
        $this->assertNull(Response::$lastStatus, '/app/config is never blocked');
        AppConfig::guardOldApp('/health');
        $this->assertNull(Response::$lastStatus);

        try {
            AppConfig::guardOldApp('/api/v1/channels/1/messages');
            $this->fail('expected a 426');
        } catch (\RuntimeException $e) {
            $this->assertSame(426, Response::$lastStatus);
            $this->assertSame('update_required', Response::$lastPayload['code']);
            $this->assertStringContainsString('Google Play', Response::$lastPayload['error']);
            $this->assertStringContainsString('Mets à jour', Response::$lastPayload['error'], "the device's language");
            $this->assertStringContainsString('com.hilads.app', Response::$lastPayload['storeUrl']);
        }
    }

    public function testNewAppsAndTheWebAreNeverBlocked(): void
    {
        AppConfig::setSettings(['block_old_apps' => '1', 'ios_min_version' => '9.0.0']);
        foreach ([['ios', '1.8.0'], ['web', null], [null, null]] as [$platform, $version]) {
            unset($_SERVER['HTTP_X_PLATFORM'], $_SERVER['HTTP_X_APP_VERSION']);
            if ($platform !== null) $_SERVER['HTTP_X_PLATFORM'] = $platform;
            if ($version !== null) $_SERVER['HTTP_X_APP_VERSION'] = $version;
            AppConfig::guardOldApp('/api/v1/daily/today');
            $this->assertNull(Response::$lastStatus, var_export([$platform, $version], true));
        }
    }

    public function testUpdateMessageInEveryLocale(): void
    {
        $this->assertEqualsCanonicalizing(DailyI18n::LOCALES, array_keys(AppConfig::UPDATE_MESSAGES));
        foreach (DailyI18n::LOCALES as $l) {
            foreach (['ios' => 'App Store', 'android' => 'Google Play'] as $p => $store) {
                $m = AppConfig::updateMessage($l, $p);
                $this->assertStringContainsString($store, $m, "{$l} {$p}");
                $this->assertStringContainsString('Hilads', $m);
                $this->assertStringNotContainsString('{store}', $m);
            }
        }
        $this->assertSame("Une nouvelle version de Hilads est là. Mets à jour l'app sur l'App Store pour continuer.", AppConfig::updateMessage('fr-FR', 'ios'));
        $this->assertStringContainsString('from the App Store', AppConfig::updateMessage('xx', 'ios'), 'unknown = English');
    }

    public function testSettingsRejectNonVersions(): void
    {
        $this->expectException(InvalidArgumentException::class);
        AppConfig::saveSettings(['ios_min_version' => '1.8.1-beta'], 'test');
    }

    public function testDualPhotoIsOffUntilSwitchedOn(): void
    {
        AppConfig::setSettings([]);
        $this->assertFalse(AppConfig::payload('ios')['dualPhoto'], 'off by default: the previous camera');
        AppConfig::setSettings(['dual_photo' => '1']);
        $this->assertTrue(AppConfig::payload('android')['dualPhoto']);
    }

    public function testDualPhotoTestersAllowlist(): void
    {
        $tester = 'dc46c6caf828962a4caf13c7c1c4680e';
        $this->assertSame([$tester, '343dc4925a36383b6db84419b2440453'],
            AppConfig::parseTesters(" DC46C6CAF828962A4CAF13C7C1C4680E,\n343dc4925a36383b6db84419b2440453 nope @lan $tester"));
        AppConfig::setSettings(['dual_photo' => '0', 'dual_photo_testers' => $tester]);
        $this->assertTrue(AppConfig::payload('ios', $tester)['dualPhoto'], 'a tester gets it while the switch is off');
        $this->assertFalse(AppConfig::payload('ios', '343dc4925a36383b6db84419b2440453')['dualPhoto']);
        $this->assertFalse(AppConfig::payload('ios', null)['dualPhoto'], 'guests: the previous capture');
    }
}
