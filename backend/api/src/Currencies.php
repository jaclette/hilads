<?php

declare(strict_types=1);

/**
 * Currencies and daily reference exchange rates (SPEC 10.5).
 *
 * - Every proof carries a currency: the price's, else its city's (forCity()).
 * - Rates: once a day, fetched by the scheduler tick (refreshIfStale) from
 *   open.er-api.com (free, no key, covers VND, KHR, LAK, AED, which ECB
 *   doesn't), stored in daily_rates as fetched (USD base). A failed fetch
 *   keeps the last good table. Readers get them rebased to EUR, the base
 *   used for medians and for the converted price of a proof (price.eur);
 *   the apps convert to the viewer's currency with GET /daily/rates.
 */
final class Currencies
{
    public const BASE       = 'EUR';
    public const SOURCE     = 'open.er-api.com';
    private const SOURCE_URL = 'https://open.er-api.com/v6/latest/USD';
    private const FALLBACK  = 'USD';

    /** ISO-2 country => the currency people pay in (every country in cities_data.php, and more). */
    public const BY_COUNTRY = [
        'AE' => 'AED', 'AF' => 'AFN', 'AL' => 'ALL', 'AM' => 'AMD', 'AO' => 'AOA', 'AR' => 'ARS', 'AT' => 'EUR',
        'AU' => 'AUD', 'AZ' => 'AZN', 'BA' => 'BAM', 'BD' => 'BDT', 'BE' => 'EUR', 'BF' => 'XOF', 'BG' => 'EUR',
        'BH' => 'BHD', 'BN' => 'BND', 'BO' => 'BOB', 'BR' => 'BRL', 'BY' => 'BYN', 'CA' => 'CAD', 'CD' => 'CDF',
        'CG' => 'XAF', 'CH' => 'CHF', 'CI' => 'XOF', 'CL' => 'CLP', 'CM' => 'XAF', 'CN' => 'CNY', 'CO' => 'COP',
        'CR' => 'CRC', 'CU' => 'CUP', 'CY' => 'EUR', 'CZ' => 'CZK', 'DE' => 'EUR', 'DJ' => 'DJF', 'DK' => 'DKK',
        'DO' => 'DOP', 'DZ' => 'DZD', 'EC' => 'USD', 'EE' => 'EUR', 'EG' => 'EGP', 'ER' => 'ERN', 'ES' => 'EUR',
        'ET' => 'ETB', 'FI' => 'EUR', 'FR' => 'EUR', 'GA' => 'XAF', 'GB' => 'GBP', 'GE' => 'GEL', 'GH' => 'GHS',
        'GN' => 'GNF', 'GR' => 'EUR', 'GT' => 'GTQ', 'HK' => 'HKD', 'HR' => 'EUR', 'HU' => 'HUF', 'ID' => 'IDR',
        'IE' => 'EUR', 'IL' => 'ILS', 'IN' => 'INR', 'IQ' => 'IQD', 'IR' => 'IRR', 'IS' => 'ISK', 'IT' => 'EUR',
        'JO' => 'JOD', 'JP' => 'JPY', 'KE' => 'KES', 'KG' => 'KGS', 'KH' => 'KHR', 'KR' => 'KRW', 'KW' => 'KWD',
        'KZ' => 'KZT', 'LA' => 'LAK', 'LB' => 'LBP', 'LK' => 'LKR', 'LT' => 'EUR', 'LU' => 'EUR', 'LV' => 'EUR',
        'LY' => 'LYD', 'MA' => 'MAD', 'MC' => 'EUR', 'MD' => 'MDL', 'ME' => 'EUR', 'MG' => 'MGA', 'MK' => 'MKD',
        'ML' => 'XOF', 'MM' => 'MMK', 'MN' => 'MNT', 'MO' => 'MOP', 'MT' => 'EUR', 'MU' => 'MUR', 'MV' => 'MVR',
        'MW' => 'MWK', 'MX' => 'MXN', 'MY' => 'MYR', 'MZ' => 'MZN', 'NG' => 'NGN', 'NL' => 'EUR', 'NO' => 'NOK',
        'NP' => 'NPR', 'NZ' => 'NZD', 'OM' => 'OMR', 'PA' => 'USD', 'PE' => 'PEN', 'PH' => 'PHP', 'PK' => 'PKR',
        'PL' => 'PLN', 'PR' => 'USD', 'PT' => 'EUR', 'PY' => 'PYG', 'QA' => 'QAR', 'RO' => 'RON', 'RS' => 'RSD',
        'RU' => 'RUB', 'RW' => 'RWF', 'SA' => 'SAR', 'SD' => 'SDG', 'SE' => 'SEK', 'SG' => 'SGD', 'SI' => 'EUR',
        'SK' => 'EUR', 'SN' => 'XOF', 'SO' => 'SOS', 'SY' => 'SYP', 'TH' => 'THB', 'TN' => 'TND', 'TR' => 'TRY',
        'TW' => 'TWD', 'TZ' => 'TZS', 'UA' => 'UAH', 'UG' => 'UGX', 'US' => 'USD', 'UY' => 'UYU', 'UZ' => 'UZS',
        'VE' => 'VES', 'VN' => 'VND', 'ZA' => 'ZAR', 'ZM' => 'ZMW', 'ZW' => 'USD',
    ];

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /** The currency of a country (ISO-2), else USD. */
    public static function forCountry(?string $country): string
    {
        return self::BY_COUNTRY[strtoupper(trim((string) $country))] ?? self::FALLBACK;
    }

    public static function isCode(mixed $code): bool
    {
        return is_string($code) && preg_match('/^[A-Z]{3}$/', $code) === 1;
    }

    /** Rates of any base ("1 base = r units") rebased to $base, or [] when $base is missing. */
    public static function rebase(array $rates, string $base): array
    {
        $b = (float) ($rates[$base] ?? 0);
        if ($b <= 0) {
            return [];
        }
        $out = [];
        foreach ($rates as $code => $r) {
            if (self::isCode($code) && (float) $r > 0) {
                $out[$code] = round((float) $r / $b, 8);
            }
        }
        $out[$base] = 1.0;
        ksort($out);
        return $out;
    }

    /** $amount in $from converted to $to with a rates table of any base, or null when a currency is unknown. */
    public static function convertWith(array $rates, float $amount, string $from, string $to): ?float
    {
        if ($from === $to) {
            return $amount;
        }
        $f = (float) ($rates[$from] ?? 0);
        $t = (float) ($rates[$to] ?? 0);
        return $f > 0 && $t > 0 ? $amount / $f * $t : null;
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    /** The currency of a city ('city_N'), else USD. */
    public static function forCity(?string $cityId): string
    {
        return self::forCountry(CityRepository::countryOf($cityId));
    }

    /** @var ?array per request */
    private static ?array $latest = null;

    /** The latest rates rebased to EUR: {base, date, rates}, or null before the first fetch. Cached. */
    public static function rates(): ?array
    {
        if (self::$latest !== null) {
            return self::$latest ?: null;
        }
        $row = Cache::remember('daily_rates_v1', 600, static function (): ?array {
            try {
                $r = Database::pdo()->query("SELECT date::text AS date, rates FROM daily_rates ORDER BY date DESC LIMIT 1")
                    ->fetch(PDO::FETCH_ASSOC);
            } catch (\Throwable $e) {
                return null;   // before the migration
            }
            if (!$r) {
                return null;
            }
            $rates = self::rebase(json_decode((string) $r['rates'], true) ?: [], self::BASE);
            return $rates === [] ? null : ['base' => self::BASE, 'date' => $r['date'], 'rates' => $rates];
        });
        self::$latest = $row ?? [];
        return $row;
    }

    /** $amount converted from $from to $to with the latest rates, or null. */
    public static function convert(float $amount, string $from, string $to): ?float
    {
        $rates = self::rates();
        return $rates !== null ? self::convertWith($rates['rates'], $amount, $from, $to) : null;
    }

    /** $amount in EUR (the base of medians), 4 decimals (VND and IDR need them to convert back), or null. */
    public static function toBase(float $amount, string $from): ?float
    {
        $v = self::convert($amount, $from, self::BASE);
        return $v === null ? null : round($v, 4);
    }

    // ── The daily fetch ──────────────────────────────────────────────────────

    /**
     * Fetch today's rates (UTC date) unless they are stored. Called by every
     * scheduler tick: a cache flag keeps it to one query an hour, and a failed
     * fetch waits 30 minutes before the next try. Never throws.
     */
    public static function refreshIfStale(?DateTimeImmutable $now = null): array
    {
        $date = ($now ?? new DateTimeImmutable('now'))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d');
        if (Cache::get('daily_rates_fresh_' . $date) !== null) {
            return ['status' => 'fresh'];
        }
        if (Cache::get('daily_rates_wait') !== null) {
            return ['status' => 'waiting'];
        }
        try {
            $pdo  = Database::pdo();
            $stmt = $pdo->prepare("SELECT 1 FROM daily_rates WHERE date = ?");
            $stmt->execute([$date]);
            if ($stmt->fetchColumn() === false) {
                $rates = self::fetch();
                if ($rates === null) {
                    Cache::set('daily_rates_wait', ['at' => time()], 1800);
                    error_log('[rates] fetch failed, keeping the last table');
                    return ['status' => 'failed'];
                }
                $pdo->prepare("
                    INSERT INTO daily_rates (date, base, rates, source) VALUES (?, 'USD', ?::jsonb, ?)
                    ON CONFLICT (date) DO NOTHING
                ")->execute([$date, json_encode($rates), self::SOURCE]);
                Cache::forget('daily_rates_v1');
                self::$latest = null;
            }
            Cache::set('daily_rates_fresh_' . $date, ['at' => time()], 3600);
            return ['status' => 'stored'];
        } catch (\Throwable $e) {
            error_log('[rates] refresh failed: ' . $e->getMessage());
            return ['status' => 'error', 'error' => $e->getMessage()];
        }
    }

    /** USD-based rates from the source, or null. */
    private static function fetch(): ?array
    {
        $ch = curl_init(self::SOURCE_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT_MS     => 5000,
            CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($body === false || $code !== 200) {
            return null;
        }
        $data = json_decode((string) $body, true);
        if (!is_array($data) || ($data['result'] ?? null) !== 'success' || !is_array($data['rates'] ?? null)) {
            return null;
        }
        $rates = self::rebase($data['rates'], 'USD');
        return isset($rates['EUR'], $rates['VND']) ? $rates : null;
    }
}
