<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** V3-04: app config (versions, retired creation), people count gating, tonight's plans. */
final class V3SwitchesTest extends TestCase
{
    protected function tearDown(): void
    {
        putenv('CHALLENGE_CREATION_CLOSED');
        putenv('APP_MIN_VERSION');
        putenv('APP_LATEST_VERSION');
    }

    public function testVersions(): void
    {
        $this->assertSame('1.8.0', AppConfig::parseVersion('1.8'));
        $this->assertSame('1.8.0', AppConfig::parseVersion(' 1.8.0 '));
        $this->assertSame('10.0.3', AppConfig::parseVersion('10.0.3'));
        foreach ([null, '', 'v1.8', '1', '1.8.0-beta', '1.8.0.1', 'latest'] as $bad) {
            $this->assertNull(AppConfig::parseVersion($bad), var_export($bad, true));
        }
        $this->assertTrue(AppConfig::isOlder('1.7.1', '1.8.0'));
        $this->assertTrue(AppConfig::isOlder('1.9.2', '1.10.0'), 'numeric, not alphabetical');
        $this->assertFalse(AppConfig::isOlder('1.8.0', '1.8.0'));
        $this->assertFalse(AppConfig::isOlder('2.0.0', '1.10.0'));
    }

    public function testConfigIsOffByDefault(): void
    {
        $c = AppConfig::payload();
        $this->assertNull($c['minVersion']);
        $this->assertNull($c['latestVersion']);
        $this->assertFalse($c['challengeCreationClosed']);
        $this->assertStringContainsString('id6768905591', $c['storeUrls']['ios']);
        $this->assertStringContainsString('com.hilads.app', $c['storeUrls']['android']);
    }

    public function testConfigFromEnvironment(): void
    {
        putenv('CHALLENGE_CREATION_CLOSED=1');
        putenv('APP_MIN_VERSION=1.8');
        putenv('APP_LATEST_VERSION=garbage');
        $c = AppConfig::payload();
        $this->assertTrue($c['challengeCreationClosed']);
        $this->assertSame('1.8.0', $c['minVersion']);
        $this->assertNull($c['latestVersion'], 'an invalid version is ignored');
        putenv('CHALLENGE_CREATION_CLOSED=0');
        $this->assertFalse(AppConfig::challengeCreationClosed());
    }

    public function testClosedMessageIsAPlainSentence(): void
    {
        // Older apps show `error` as is under the create form.
        $this->assertStringContainsString('Update Hilads', AppConfig::CHALLENGE_CLOSED_MESSAGE);
        $this->assertStringNotContainsString('_', AppConfig::CHALLENGE_CLOSED_MESSAGE);
    }

    public function testCountsBelowTheThresholdAreHidden(): void
    {
        $this->assertNull(PeopleCounts::gate(0));
        $this->assertNull(PeopleCounts::gate(PeopleCounts::MIN - 1));
        $this->assertSame(PeopleCounts::MIN, PeopleCounts::gate(PeopleCounts::MIN));
        $this->assertSame(12, PeopleCounts::gate(12));
    }

    public function testTonight(): void
    {
        $now = 1792202400;
        $end = $now + 10 * 3600;
        $ev  = static fn(string $id, int $start, int $going, array $extra = []): array => $extra + [
            'id' => $id, 'title' => strtoupper($id), 'source' => 'hilads', 'is_venue' => false,
            'starts_at' => $start, 'ends_at' => $start + 7200, 'participant_count' => $going,
        ];
        $plans = PeopleCounts::tonight([
            $ev('a', $now + 3600, 2),
            $ev('b', $now + 7200, 6),
            $ev('c', $now - 3600, 4),                                  // ongoing
            $ev('d', $now - 9000, 9),                                  // over
            $ev('e', $end + 60, 9),                                    // tomorrow
            $ev('f', $now + 600, 9, ['source' => 'ticketmaster']),
            $ev('g', $now + 600, 9, ['is_venue' => true]),
            $ev('h', $now + 900, 1),
            $ev('b', $now + 7200, 6),                                  // duplicate
        ], $now, $end);
        $this->assertSame(['b', 'c', 'a'], array_column($plans, 'id'), 'most joined first, 3 max');
        $this->assertSame([6, 4, null], array_column($plans, 'going'), 'below the threshold: no count');
        $keys = array_keys($plans[0]);
        sort($keys);
        $this->assertSame(['going', 'id', 'startsAt', 'title'], $keys);
    }
}
