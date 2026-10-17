<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Spots back office (V3-05): pasted positions and merge rules. */
final class SpotsAdminTest extends TestCase
{
    public function testPositionTypedOrPasted(): void
    {
        $expect = [10.7769, 106.7009];
        foreach ([
            '10.7769, 106.7009',
            ' 10.7769 106.7009 ',
            '10.7769;106.7009',
            'https://www.google.com/maps/place/Ben+Thanh/@10.7769,106.7009,17z/data=x',
            'https://maps.apple.com/?ll=10.7769,106.7009&q=Stall',
            'https://maps.apple.com/?q=10.7769,106.7009',
            'https://www.openstreetmap.org/?mlat=10.7769&mlon=106.7009#map=18/10.7769/106.7009',
            'https://www.openstreetmap.org/#map=18/10.7769/106.7009',
            'geo:0,0?q=10.7769,106.7009',
        ] as $raw) {
            $this->assertSame($expect, SpotsAdmin::parsePosition($raw), $raw);
        }
        $this->assertSame([-33.8688, 151.2093], SpotsAdmin::parsePosition('-33.8688, 151.2093'));
    }

    public function testPositionRefusals(): void
    {
        foreach (['', 'Ben Thanh market', '91, 10', '10, 181', '0, 0', '10.77', 'https://maps.app.goo.gl/abc'] as $raw) {
            $this->assertNull(SpotsAdmin::parsePosition($raw), $raw);
        }
    }

    public function testMergeRules(): void
    {
        $place = static fn(string $id, array $o = []): array => $o + [
            'id' => $id, 'status' => 'approved', 'hidden' => false, 'merged_into' => null,
        ];
        $this->assertNull(SpotsAdmin::mergeError($place('a'), $place('b')));
        $this->assertNull(SpotsAdmin::mergeError($place('a', ['status' => 'pending']), $place('b', ['status' => 'pending'])));
        $this->assertNotNull(SpotsAdmin::mergeError($place('a'), null));
        $this->assertNotNull(SpotsAdmin::mergeError($place('a'), $place('a')), 'not into itself');
        $this->assertNotNull(SpotsAdmin::mergeError($place('a', ['merged_into' => 'c']), $place('b')), 'already merged');
        $this->assertNotNull(SpotsAdmin::mergeError($place('a'), $place('b', ['merged_into' => 'c'])), 'into a merged spot');
        $this->assertNotNull(SpotsAdmin::mergeError($place('a'), $place('b', ['status' => 'rejected'])), 'into a rejected place');
        $this->assertNotNull(SpotsAdmin::mergeError($place('a'), $place('b', ['hidden' => 't'])), 'into a hidden spot');
    }
}
