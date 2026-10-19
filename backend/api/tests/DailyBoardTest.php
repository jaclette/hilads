<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class DailyBoardTest extends TestCase
{
    private static function p(string $id, string $city, int $votes, array $extra = []): array
    {
        return $extra + [
            'id' => $id, 'user_id' => 'u' . $id, 'city_id' => $city, 'city_name' => ucfirst(substr($city, 5)), 'country' => 'XX',
            'vote_count' => $votes, 'local_vote_count' => 0, 'approved_at' => '2026-10-19 03:00:00',
            'answer_text' => null, 'answer_number' => null, 'answer_minutes' => null, 'price_eur' => null,
        ];
    }

    public function testMedian(): void
    {
        $this->assertNull(DailyBoard::median([]));
        $this->assertSame(2.0, DailyBoard::median([3, 1, 2]));
        $this->assertSame(2.5, DailyBoard::median([4, 1, 2, 3]));
        $this->assertSame(1.5, DailyBoard::median([null, 1.5]));
    }

    public function testGroupPicksTheBestProofWithAnAnswer(): void
    {
        $rows = DailyBoard::group([
            self::p('a', 'city_1', 5),                                              // best, but no answer (old app)
            self::p('b', 'city_1', 2, ['answer_text' => 'Santé !', 'price_eur' => 3.0]),
            self::p('c', 'city_1', 1, ['answer_text' => 'Tchin', 'price_eur' => 1.0]),
            self::p('d', 'city_2', 0, ['answer_text' => 'Prost!']),
        ], 'word');
        $this->assertSame(['city_1', 'city_2'], array_column($rows, 'cityId'));   // most proofs first
        $this->assertSame('b', $rows[0]['best']['id']);
        $this->assertSame(3, $rows[0]['count']);
        $this->assertSame([3.0, 1.0], $rows[0]['prices']);

        // Without a question, the best proof is the city's best.
        $this->assertSame('a', DailyBoard::group([self::p('a', 'city_1', 5), self::p('b', 'city_1', 2)], null)[0]['best']['id']);
    }

    public function testRange(): void
    {
        $rows = DailyBoard::group([
            self::p('a', 'city_1', 0, ['answer_minutes' => 1110]),   // 18:30
            self::p('b', 'city_2', 0, ['answer_minutes' => 1320]),   // 22:00
            self::p('c', 'city_3', 0, ['answer_minutes' => 1200]),
            self::p('d', 'city_4', 0),
        ], 'time');
        [$min, $max] = DailyBoard::range($rows, 'time');
        $this->assertSame(['city_1', 'city_2'], [$min['cityId'], $max['cityId']]);
        $this->assertNull(DailyBoard::range($rows, 'word'));
        $same = DailyBoard::group([self::p('a', 'city_1', 0, ['answer_number' => 3]), self::p('b', 'city_2', 0, ['answer_number' => 3])], 'number');
        $this->assertNull(DailyBoard::range($same, 'number'));
    }

    public function testTeaserPutsOtherCitiesFirst(): void
    {
        $rows = DailyBoard::group([
            self::p('a', 'city_1', 0, ['answer_text' => 'Một, hai, ba, dzô!']),
            self::p('a2', 'city_1', 0, ['answer_text' => 'Dzô!']),
            self::p('b', 'city_2', 0, ['answer_text' => 'Prost!']),
            self::p('c', 'city_3', 0, ['answer_text' => 'Salud!']),
            self::p('d', 'city_4', 0, ['answer_text' => 'Kanpai']),
            self::p('e', 'city_5', 0),
        ], 'word');
        $pick = array_column(DailyBoard::teaserPick($rows, 'city_1'), 'cityId');
        $this->assertCount(3, $pick);
        $this->assertNotContains('city_1', $pick);
        $this->assertNotContains('city_5', $pick);
        $this->assertSame('city_1', DailyBoard::teaserPick($rows, 'city_1', 5)[3]['cityId']);
    }
}
