<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** The web pages of past challenges: their URL slug and the answers by country. */
final class DailyWebTest extends TestCase
{
    public function testSlugFromTheQuestionElseTheText(): void
    {
        $this->assertSame('how-do-locals-say-cheers', DailyWeb::slug('How do locals say cheers?', 'Raise a glass with locals.'));
        $this->assertSame('find-a-shrine-altar-or-memorial', DailyWeb::slug(null, 'Find a shrine, altar or memorial'));
        $this->assertSame('ou-est-le-cafe', DailyWeb::slug('Où est le café ?', null));
        $this->assertSame('wheres-the-party-tonight', DailyWeb::slug('Where’s the party tonight?', null));
        $this->assertSame('whats-the-one-rule', DailyWeb::slug("What's the one rule?", null));
        $this->assertSame('challenge', DailyWeb::slug('', '?!'));
        $long = DailyWeb::slug('Find the oldest shop on your street, and ask how long it has been open for business', null);
        $this->assertLessThanOrEqual(60, strlen($long));
        $this->assertSame('find-the-oldest-shop-on-your-street-and-ask-how-long-it-has', $long);
    }

    public function testCountriesMostPhotosFirstWithTheirBestAnsweredPhoto(): void
    {
        $p = static fn(string $id, string $city, string $name, ?string $cc, int $votes, ?string $answer = null) => [
            'id' => $id, 'city_id' => $city, 'city_name' => $name, 'country' => $cc, 'vote_count' => $votes,
            'created_at' => '2026-10-24 10:00:00', 'answer_text' => $answer, 'answer_number' => null, 'answer_minutes' => null,
        ];
        $groups = DailyWeb::byCountry([
            $p('a', 'city_1', 'Paris', 'FR', 1, 'Santé'),
            $p('b', 'city_9', 'Lyon', 'FR', 3),
            $p('c', 'city_17', 'Berlin', 'DE', 0, 'Prost!'),
            $p('d', 'city_1', 'Paris', 'FR', 0),
        ]);
        $this->assertSame(['FR', 'DE'], array_column($groups, 'country'));
        $this->assertSame('b', $groups[0]['best']['id']);
        $this->assertSame('a', $groups[0]['answered']['id']);
        $this->assertSame([['name' => 'Paris', 'count' => 2], ['name' => 'Lyon', 'count' => 1]], $groups[0]['cities']);
        $this->assertCount(3, $groups[0]['rows']);
    }
}
