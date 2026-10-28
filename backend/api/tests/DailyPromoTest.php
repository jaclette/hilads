<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class DailyPromoTest extends TestCase
{
    private const BEFORE = '2026-10-29 23:59:00+00';
    private const AFTER  = '2026-10-30 00:00:00+00';

    public function testPhotosFromTheClauseAreUsedEarlierOnesNeedAYes(): void
    {
        $this->assertTrue(DailyPromo::allowed(null, self::AFTER, false));
        $this->assertFalse(DailyPromo::allowed(null, self::BEFORE, false));
        $this->assertTrue(DailyPromo::allowed('yes', self::BEFORE, false));
        $this->assertTrue(DailyPromo::allowed('yes', self::AFTER, false));
    }

    public function testANoOrAnExclusionLeavesThePhotoOut(): void
    {
        $this->assertFalse(DailyPromo::allowed('no', self::AFTER, false));
        $this->assertFalse(DailyPromo::allowed('yes', self::AFTER, true));
        $this->assertFalse(DailyPromo::allowed(null, self::AFTER, true));
    }

    public function testReasons(): void
    {
        $this->assertNull(DailyPromo::reason(null, self::AFTER, false));
        $this->assertSame('before_terms', DailyPromo::reason(null, self::BEFORE, false));
        $this->assertSame('opted_out', DailyPromo::reason('no', self::AFTER, false));
        $this->assertSame('excluded', DailyPromo::reason('no', self::AFTER, true));
    }

    public function testOneCityPerCountryFirstInTourOrder(): void
    {
        $cities = [
            ['id' => 'saigon', 'country' => 'vn'], ['id' => 'hanoi', 'country' => 'vn'], ['id' => 'paris', 'country' => 'fr'],
            ['id' => 'danang', 'country' => 'vn'], ['id' => 'lyon', 'country' => 'fr'], ['id' => 'berlin', 'country' => 'de'],
        ];
        $this->assertSame(['saigon', 'paris', 'berlin', 'hanoi', 'lyon', 'danang'], array_column(DailyPromo::byCountry($cities), 'id'));
    }

    public function testACityWithoutCountryStaysInTheFirstRound(): void
    {
        $cities = [['id' => 'a', 'country' => 'vn'], ['id' => 'b', 'country' => 'vn'], ['id' => 'c', 'country' => null], ['id' => 'd', 'country' => null]];
        $this->assertSame(['a', 'c', 'd', 'b'], array_column(DailyPromo::byCountry($cities), 'id'));
    }

    public function testTheAskIsShownOnceToPlayersWithEarlierPhotos(): void
    {
        $this->assertTrue(DailyPromo::shouldAsk(null, null, true));
        $this->assertFalse(DailyPromo::shouldAsk(null, null, false));
        $this->assertFalse(DailyPromo::shouldAsk(null, '2026-10-30 10:00:00+00', true));
        $this->assertFalse(DailyPromo::shouldAsk('yes', null, true));
        $this->assertFalse(DailyPromo::shouldAsk('no', null, true));
    }

    public function testNoAskBeforeTheMigration(): void
    {
        $this->assertFalse(DailyPromo::asks(['id' => 'u1']));
        $this->assertFalse(DailyPromo::asks(['id' => 'u1', 'promo_consent' => 'yes', 'promo_asked_at' => null]));
    }
}
