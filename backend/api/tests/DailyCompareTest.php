<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class DailyCompareTest extends TestCase
{
    public function testCleanQuestion(): void
    {
        $this->assertNull(DailyCompare::cleanQuestion(null));
        $q = DailyCompare::cleanQuestion(['type' => 'Word', 'question' => 'How do  locals say cheers?']);
        $this->assertSame('word', $q['type']);
        $this->assertSame(['en' => 'How do locals say cheers?'], $q['question']);
        $this->assertNull($q['unit']);

        $q = DailyCompare::cleanQuestion(['type' => 'number', 'unit' => ['en' => 'years', 'fr' => 'ans'],
                                          'question' => ['en' => 'How many years?', 'fr' => "Depuis combien d'années ?"]]);
        $this->assertSame(['en' => 'years', 'fr' => 'ans', '_src' => 'years'], $q['unit']);
        $this->assertSame("Depuis combien d'années ?", $q['question']['fr']);
        $this->assertSame('How many years?', $q['question']['_src']);

        // A unit only makes sense for numbers.
        $this->assertNull(DailyCompare::cleanQuestion(['type' => 'time', 'unit' => 'h', 'question' => 'Dinner?'])['unit']);
    }

    public function testCleanQuestionRefusals(): void
    {
        foreach ([
            'nope',
            ['type' => 'colour', 'question' => 'Q?'],
            ['type' => 'word'],
            ['type' => 'word', 'question' => ['fr' => 'Seulement en français ?']],
            ['type' => 'word', 'question' => str_repeat('a', 61)],
            ['type' => 'word', 'question' => ['en' => 'Q?', 'fr' => str_repeat('a', 91)]],
        ] as $in) {
            try {
                DailyCompare::cleanQuestion($in);
                $this->fail('accepted: ' . json_encode($in));
            } catch (InvalidArgumentException $e) {
                $this->assertNotSame('', $e->getMessage());
            }
        }
    }

    public function testCleanAnswerByType(): void
    {
        $this->assertSame(['Prost!', null, null], DailyCompare::cleanAnswer('word', "  Prost! "));
        $this->assertSame(['Một, hai, ba, dzô!', null, null], DailyCompare::cleanAnswer('word', 'Một, hai, ba, dzô!'));
        $this->assertNull(DailyCompare::cleanAnswer('word', str_repeat('a', 31)));
        $this->assertNull(DailyCompare::cleanAnswer('word', '   '));
        $this->assertNull(DailyCompare::cleanAnswer('word', 12));
        $this->assertSame([str_repeat('a', 80), null, null], DailyCompare::cleanAnswer('text', str_repeat('a', 80)));
        $this->assertNull(DailyCompare::cleanAnswer('text', str_repeat('a', 81)));

        $this->assertSame([null, 42, null], DailyCompare::cleanAnswer('number', 42));
        $this->assertSame([null, 42, null], DailyCompare::cleanAnswer('number', '42'));
        $this->assertSame([null, 42, null], DailyCompare::cleanAnswer('number', 42.0));
        $this->assertNull(DailyCompare::cleanAnswer('number', 4.5));
        $this->assertNull(DailyCompare::cleanAnswer('number', -1));
        $this->assertNull(DailyCompare::cleanAnswer('number', 'forty'));
        $this->assertNull(DailyCompare::cleanAnswer('number', DailyCompare::NUMBER_MAX + 1));

        $this->assertSame([null, null, 19 * 60 + 30], DailyCompare::cleanAnswer('time', '19:40'));
        $this->assertSame([null, null, 20 * 60], DailyCompare::cleanAnswer('time', '19:45'));
        $this->assertSame([null, null, 0], DailyCompare::cleanAnswer('time', '23:50'));
        $this->assertSame([null, null, 7 * 60], DailyCompare::cleanAnswer('time', 7 * 60 + 10));
        $this->assertNull(DailyCompare::cleanAnswer('time', '24:00'));
        $this->assertNull(DailyCompare::cleanAnswer('time', '7pm'));
        $this->assertNull(DailyCompare::cleanAnswer('time', 1440));
    }

    public function testTimeHelpers(): void
    {
        $this->assertSame(30, DailyCompare::roundTime(15));
        $this->assertSame(0, DailyCompare::roundTime(14));
        $this->assertSame('07:30', DailyCompare::formatTime(450));
        $this->assertSame('22:00', DailyCompare::formatTime(1320));
    }

    private static function findCity(): callable
    {
        return static fn(int $id): ?array => $id === 20 ? ['name' => 'Ho Chi Minh City', 'country' => 'VN'] : null;
    }

    public function testProofInputAnswer(): void
    {
        [$f, $err] = DailyCompare::validateProofInput(['answer' => 'Salud!'], 'word', self::findCity());
        $this->assertNull($err);
        $this->assertSame(['answer_text' => 'Salud!', 'answer_number' => null, 'answer_minutes' => null], $f);
        $this->assertTrue(DailyCompare::hasAnswer($f));

        // No question: the answer is ignored.
        $this->assertSame([[], null], DailyCompare::validateProofInput(['answer' => 'Salud!'], null, self::findCity()));
        $this->assertSame([[], 'invalid_answer'], DailyCompare::validateProofInput(['answer' => 'x'], 'number', self::findCity()));
        // Edit: null clears; absent leaves it.
        [$f] = DailyCompare::validateProofInput(['answer' => null], 'word', self::findCity());
        $this->assertSame(['answer_text' => null, 'answer_number' => null, 'answer_minutes' => null], $f);
        $this->assertFalse(DailyCompare::hasAnswer([]));
    }

    public function testProofInputBackHome(): void
    {
        [$f, $err] = DailyCompare::validateProofInput(['backHome' => [
            'city' => ['name' => 'Paris', 'country' => 'fr'], 'answer' => '20:30',
            'price' => ['amount' => '2.8', 'currency' => 'eur'], 'line' => '  Dinner  starts late at home. ',
        ]], 'time', self::findCity());
        $this->assertNull($err);
        $this->assertSame([null, 'Paris', 'FR'], [$f['home_city_id'], $f['home_city_name'], $f['home_country']]);
        $this->assertSame(1230, $f['home_answer_minutes']);
        $this->assertSame([2.8, 'EUR'], [$f['home_price_amount'], $f['home_price_currency']]);
        $this->assertSame('Dinner starts late at home.', $f['home_line']);

        [$f, $err] = DailyCompare::validateProofInput(['backHome' => ['city' => ['id' => 20], 'line' => 'Same here']], 'word', self::findCity());
        $this->assertNull($err);
        $this->assertSame(['city_20', 'Ho Chi Minh City', 'VN'], [$f['home_city_id'], $f['home_city_name'], $f['home_country']]);
        $this->assertNull($f['home_answer_text']);

        [$f, $err] = DailyCompare::validateProofInput(['backHome' => null], 'word', self::findCity());
        $this->assertNull($err);
        $this->assertNull($f['home_city_name']);

        foreach ([
            ['city' => ['id' => 99], 'line' => 'x'],                          // unknown city
            ['city' => ['name' => 'Paris'], 'line' => 'x'],                   // no country
            ['city' => ['name' => 'Paris', 'country' => 'FR']],               // a city alone
            ['city' => ['name' => 'Paris', 'country' => 'FR'], 'answer' => str_repeat('a', 31)],
            ['city' => ['name' => 'Paris', 'country' => 'FR'], 'price' => ['amount' => 2]],
            ['city' => ['name' => 'Paris', 'country' => 'FR'], 'line' => str_repeat('a', 81)],
            'Paris',
        ] as $b) {
            $this->assertSame([[], 'invalid_back_home'], DailyCompare::validateProofInput(['backHome' => $b], 'word', self::findCity()), json_encode($b));
        }
    }

    public function testPayloads(): void
    {
        $row = ['compare_type' => 'number', 'compare_question_i18n' => json_encode(['en' => 'How many years?', 'fr' => "Combien d'années ?"]),
                'compare_unit_i18n' => json_encode(['en' => 'years', 'fr' => 'ans'])];
        $p = DailyCompare::payload($row, 'fr');
        $this->assertSame(['type' => 'number', 'question' => "Combien d'années ?", 'unit' => 'ans', 'original' => 'How many years?', 'maxLength' => null], $p);
        $this->assertNull(DailyCompare::payload(['compare_type' => null], 'en'));

        $this->assertSame(['type' => 'number', 'value' => 37, 'unit' => 'years'],
            DailyCompare::answerPayload('number', null, '37', null, $row['compare_unit_i18n'], 'en'));
        $this->assertSame(['type' => 'time', 'value' => '19:30', 'unit' => null],
            DailyCompare::answerPayload('time', null, null, '1170', null, 'en'));
        $this->assertNull(DailyCompare::answerPayload('word', null, null, null, null, 'en'));
        $this->assertNull(DailyCompare::answerPayload(null, 'x', null, null, null, 'en'));
    }

    public function testClientSupports(): void
    {
        unset($_SERVER['HTTP_X_COMPARE']);
        $this->assertFalse(DailyCompare::clientSupports());
        $_SERVER['HTTP_X_COMPARE'] = '1';
        $this->assertTrue(DailyCompare::clientSupports());
        unset($_SERVER['HTTP_X_COMPARE']);
    }
}
