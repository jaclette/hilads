<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class DailyComparisonsTest extends TestCase
{
    public function testRowsNeedThreeAnswersPerCity(): void
    {
        $rows = DailyComparisons::rows('price', ['city_1' => [3.0, 2.0, 2.5], 'city_2' => [1.0, 1.2], 'city_3' => [0.9, 1.1, 1.0, 1.4]]);
        $this->assertSame([
            ['cityId' => 'city_3', 'value' => 1.05, 'count' => 4],
            ['cityId' => 'city_1', 'value' => 2.5, 'count' => 3],
        ], $rows);
    }

    public function testTimesRoundToHalfHours(): void
    {
        $rows = DailyComparisons::rows('time', ['city_1' => [1170.0, 1200.0, 1215.0], 'city_2' => [1320.0, 1350.0, 1330.0]]);
        $this->assertSame([1200.0, 1320.0], array_column($rows, 'value'));
    }

    public function testWordsKeepTheUsualAnswer(): void
    {
        $this->assertSame('Salud!', DailyComparisons::usualWord(['Salud!', 'salud', 'Salud!', 'Chin chin', ' SALUD ']));
        $rows = DailyComparisons::rows('word', ['city_1' => ['Kanpai', 'kanpai!', 'Kanpai'], 'city_2' => ['Prost', 'Prost', 'Prost', 'Prosit']]);
        $this->assertSame([['cityId' => 'city_2', 'value' => 'Prost', 'count' => 4], ['cityId' => 'city_1', 'value' => 'Kanpai', 'count' => 3]], $rows);
    }

    public function testFunFactFromTwiceThePrice(): void
    {
        $rows = [['cityId' => 'city_1', 'value' => 1.0, 'count' => 3], ['cityId' => 'city_2', 'value' => 1.9, 'count' => 3]];
        $this->assertNull(DailyComparisons::funFact($rows));
        $rows[1]['value'] = 5.9;
        $this->assertSame(['ratio' => 5.9, 'hi' => 'city_2', 'lo' => 'city_1'], DailyComparisons::funFact($rows));
    }

    public function testCleanQuestionTakesTheIndexKeys(): void
    {
        $q = DailyCompare::cleanQuestion(['type' => 'word', 'question' => 'How do locals say cheers?', 'key' => 'Cheers_Word',
                                          'title' => ['en' => 'How does the world say cheers?'],
                                          'price' => ['key' => 'drink_price', 'label' => ['en' => 'a drink', 'fr' => 'un verre']]]);
        $this->assertSame('cheers_word', $q['key']);
        $this->assertSame('drink_price', $q['price']['key']);
        $c = DailyCompare::columns($q);
        $this->assertSame('cheers_word', $c['compare_key']);
        $this->assertSame('un verre', json_decode($c['price_label_i18n'], true)['fr']);
        $this->expectException(InvalidArgumentException::class);
        DailyCompare::cleanQuestion(['type' => 'word', 'question' => 'Q?', 'key' => 'bad key!']);
    }
}
