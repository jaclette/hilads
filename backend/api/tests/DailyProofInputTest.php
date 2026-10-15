<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class DailyProofInputTest extends TestCase
{
    private const PHOTO = 'https://media.hilads.test/0123456789abcdef0123456789abcdef.jpg';

    protected function setUp(): void
    {
        putenv('R2_PUBLIC_URL=https://media.hilads.test');
    }

    protected function tearDown(): void
    {
        putenv('R2_PUBLIC_URL');
    }

    public function testFullValidCreate(): void
    {
        [$f, $err] = DailyProofRepository::validateInput([
            'photoUrl' => self::PHOTO,
            'caption'  => "  Cơm tấm\nbefore 8am  ",
            'price'    => ['amount' => '45000', 'currency' => 'vnd'],
            'place'    => ['lat' => 10.77, 'lng' => 106.7, 'name' => 'Corner stall'],
        ], false);
        $this->assertNull($err);
        $this->assertSame(self::PHOTO, $f['photo_url']);
        $this->assertSame('Cơm tấm before 8am', $f['caption']);
        $this->assertSame(45000.0, $f['price_amount']);
        $this->assertSame('VND', $f['price_currency']);
        $this->assertSame('Corner stall', $f['place_name']);
    }

    public function testPhotoMustBeOurUpload(): void
    {
        foreach ([null, '', 'https://evil.test/0123456789abcdef0123456789abcdef.jpg',
                  'https://media.hilads.test/thumb_0123456789abcdef0123456789abcdef.jpg',
                  'https://media.hilads.test/../x.jpg'] as $url) {
            [, $err] = DailyProofRepository::validateInput(['photoUrl' => $url], false);
            $this->assertSame('invalid_photo', $err, var_export($url, true));
        }
    }

    public function testCaptionLimit(): void
    {
        [, $ok]  = DailyProofRepository::validateInput(['photoUrl' => self::PHOTO, 'caption' => str_repeat('é', 140)], false);
        [, $err] = DailyProofRepository::validateInput(['photoUrl' => self::PHOTO, 'caption' => str_repeat('é', 141)], false);
        $this->assertNull($ok);
        $this->assertSame('invalid_caption', $err);
    }

    public function testPriceAndPlaceValidation(): void
    {
        $bad = [
            [['price' => ['amount' => -1, 'currency' => 'VND']], 'invalid_price'],
            [['price' => ['amount' => 10, 'currency' => 'dong']], 'invalid_price'],
            [['price' => ['amount' => 'ten', 'currency' => 'USD']], 'invalid_price'],
            [['place' => ['lat' => 91, 'lng' => 0]], 'invalid_place'],
            [['place' => ['lat' => 10]], 'invalid_place'],
            [['place' => ['lat' => 1, 'lng' => 1, 'name' => str_repeat('x', 81)]], 'invalid_place'],
        ];
        foreach ($bad as [$field, $code]) {
            [, $err] = DailyProofRepository::validateInput(['photoUrl' => self::PHOTO] + $field, false);
            $this->assertSame($code, $err, json_encode($field));
        }
    }

    public function testPartialEditOnlyTouchesSentFieldsAndNullClears(): void
    {
        [$f, $err] = DailyProofRepository::validateInput(['caption' => 'New', 'place' => null], true);
        $this->assertNull($err);
        $this->assertSame(['caption' => 'New', 'place_lat' => null, 'place_lng' => null, 'place_name' => null], $f);
    }
}
