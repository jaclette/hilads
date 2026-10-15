<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class DailyRulesTest extends TestCase
{
    public function testLocalNeedsLocalModeAndOwnCity(): void
    {
        // Declared local, home city matches the proof city (case and punctuation ignored).
        $this->assertTrue(DailyRules::isLocalFor('local', 'Ho Chi Minh City', 'Ho Chi Minh City'));
        $this->assertTrue(DailyRules::isLocalFor('local', ' ho chi minh city ', 'Ho Chi Minh City'));
        // No home city on file: trust the declared mode.
        $this->assertTrue(DailyRules::isLocalFor('local', null, 'Bangkok'));
        $this->assertTrue(DailyRules::isLocalFor('local', '', 'Bangkok'));
        // A Saigon local posting from Bangkok is a traveler there.
        $this->assertFalse(DailyRules::isLocalFor('local', 'Ho Chi Minh City', 'Bangkok'));
        // Not declared local, or no city: never local.
        $this->assertFalse(DailyRules::isLocalFor('exploring', 'Bangkok', 'Bangkok'));
        $this->assertFalse(DailyRules::isLocalFor(null, 'Bangkok', 'Bangkok'));
        $this->assertFalse(DailyRules::isLocalFor('local', 'Bangkok', null));
    }

    public function testTimezoneValidation(): void
    {
        $this->assertTrue(DailyRules::isValidTimezone('Asia/Ho_Chi_Minh'));
        $this->assertTrue(DailyRules::isValidTimezone('UTC'));
        $this->assertFalse(DailyRules::isValidTimezone('GMT+7'));
        $this->assertFalse(DailyRules::isValidTimezone('Mars/Olympus'));
        $this->assertFalse(DailyRules::isValidTimezone(''));
    }

    public function testSlugMatchesCityUrls(): void
    {
        $this->assertSame('ho-chi-minh-city', DailyRules::slug('Ho Chi Minh City'));
        $this->assertSame('sao-paulo', DailyRules::slug('Sao Paulo'));
        $this->assertSame('new-york', DailyRules::slug(' New York! '));
    }
}
