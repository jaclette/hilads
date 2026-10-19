<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class CurrenciesTest extends TestCase
{
    public function testForCountry(): void
    {
        $this->assertSame('VND', Currencies::forCountry('VN'));
        $this->assertSame('EUR', Currencies::forCountry('fr'));
        $this->assertSame('EUR', Currencies::forCountry('BG'));   // euro since 2026
        $this->assertSame('USD', Currencies::forCountry('XX'));
        $this->assertSame('USD', Currencies::forCountry(null));
    }

    public function testEveryCityCountryHasACurrency(): void
    {
        $cities = require __DIR__ . '/../src/cities_data.php';
        $missing = [];
        foreach ($cities as $c) {
            if (isset($c['country']) && !isset(Currencies::BY_COUNTRY[$c['country']])) {
                $missing[$c['country']] = true;
            }
        }
        $this->assertSame([], array_keys($missing));
    }

    public function testRebaseAndConvert(): void
    {
        $usd = ['USD' => 1, 'EUR' => 0.8, 'VND' => 25000, 'bad' => 3, 'XYZ' => 0];
        $eur = Currencies::rebase($usd, 'EUR');
        $this->assertSame(1.0, $eur['EUR']);
        $this->assertSame(1.25, $eur['USD']);
        $this->assertSame(31250.0, $eur['VND']);
        $this->assertArrayNotHasKey('bad', $eur);
        $this->assertArrayNotHasKey('XYZ', $eur);
        $this->assertSame([], Currencies::rebase($usd, 'GBP'));

        $this->assertEqualsWithDelta(1.44, Currencies::convertWith($eur, 45000, 'VND', 'EUR'), 0.0001);
        $this->assertEqualsWithDelta(36000.0, Currencies::convertWith($usd, 1.44, 'USD', 'VND'), 0.0001);
        $this->assertSame(5.0, Currencies::convertWith([], 5.0, 'EUR', 'EUR'));
        $this->assertNull(Currencies::convertWith($eur, 5.0, 'EUR', 'GBP'));
    }
}
