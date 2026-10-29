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

    public function testSelfieIsOptionalOurUploadAndNullRemovesIt(): void
    {
        $selfie = 'https://media.hilads.test/fedcba9876543210fedcba9876543210.jpg';
        [$f, $err] = DailyProofRepository::validateInput(['photoUrl' => self::PHOTO], false);
        $this->assertNull($err);
        $this->assertArrayNotHasKey('selfie_url', $f, 'no selfie: a single photo, as from older apps');

        [$f, $err] = DailyProofRepository::validateInput(['photoUrl' => self::PHOTO, 'selfieUrl' => $selfie], false);
        $this->assertNull($err);
        $this->assertSame($selfie, $f['selfie_url']);

        [$f, $err] = DailyProofRepository::validateInput(['selfieUrl' => null], true);
        $this->assertNull($err);
        $this->assertSame(['selfie_url' => null], $f);

        foreach (['', 'https://evil.test/fedcba9876543210fedcba9876543210.jpg', 42] as $bad) {
            [, $err] = DailyProofRepository::validateInput(['photoUrl' => self::PHOTO, 'selfieUrl' => $bad], false);
            $this->assertSame('invalid_selfie', $err);
        }
    }

    public function testFormatCarriesTheSelfie(): void
    {
        $row = ['id' => 'p1', 'challenge_id' => 'c1', 'challenge_date' => '2026-10-29', 'user_id' => 'u1', 'username' => 'anh',
                'display_name' => 'Anh', 'profile_photo_url' => null, 'city_id' => null, 'is_local' => 't', 'photo_url' => self::PHOTO,
                'caption' => null, 'price_amount' => null, 'price_currency' => null, 'place_lat' => null, 'moderation_status' => 'approved',
                'rejection_reason' => null, 'vote_count' => 0, 'local_vote_count' => 0, 'approved_at' => null, 'edited_at' => null,
                'created_at' => '2026-10-29 10:00:00+00'];
        $this->assertNull(DailyProofRepository::format($row)['selfieUrl']);
        $p = DailyProofRepository::format($row + ['selfie_url' => 'https://media.hilads.test/fedcba9876543210fedcba9876543210.jpg']);
        $this->assertSame('https://media.hilads.test/fedcba9876543210fedcba9876543210.jpg', $p['selfieUrl']);
        $this->assertNotNull($p['selfieThumbUrl']);
    }
}
