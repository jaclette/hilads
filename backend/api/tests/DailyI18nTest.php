<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Hand-written Daily Challenge translations: locales, picking, import, cards, pushes. */
final class DailyI18nTest extends TestCase
{
    protected function tearDown(): void
    {
        DailyI18n::setCurrent(null);
    }

    public function testNormalize(): void
    {
        $cases = ['fr' => 'fr', 'fr-FR' => 'fr', 'pt-BR' => 'pt-br', 'pt-PT' => 'pt-pt', 'pt' => 'pt-br',
                  'zh-Hans' => 'zh-hans', 'zh-CN' => 'zh-hans', 'zh_TW' => 'zh-hant', 'zh-Hant-HK' => 'zh-hant',
                  'tl' => 'fil', 'fil-PH' => 'fil', 'in' => 'id', 'xx' => 'en', '' => 'en', 'EN-us' => 'en', 'vi-VN' => 'vi'];
        foreach ($cases as $in => $out) {
            $this->assertSame($out, DailyI18n::normalize($in), $in);
        }
        $this->assertSame('en', DailyI18n::normalize(null));
        $this->assertCount(18, DailyI18n::others());
    }

    public function testPickAndLocalize(): void
    {
        $map = ['en' => 'Eat', 'fr' => 'Mange', 'vi' => '  ', '_src' => 'Eat'];
        $this->assertSame('Mange', DailyI18n::pick($map, 'fr'));
        $this->assertNull(DailyI18n::pick($map, 'vi'));       // blank = missing
        $this->assertNull(DailyI18n::pick($map, 'en'));
        $this->assertSame(['Mange', 'Eat'], DailyI18n::localize($map, 'Eat', 'fr'));
        $this->assertSame(['Eat', null], DailyI18n::localize($map, 'Eat', 'de'));
        $this->assertSame(['fr'], DailyI18n::translated($map));
    }

    public function testMergeStampsTheEnglishAndStaleness(): void
    {
        $m = DailyI18n::merge(['en' => 'Old', 'de' => 'Alt'], 'Eat', ['fr' => 'Mange']);
        $this->assertSame(['en' => 'Eat', 'fr' => 'Mange', '_src' => 'Eat'], $m);   // de removed: absent from the form
        $this->assertFalse(DailyI18n::isStale($m, 'Eat'));
        $this->assertTrue(DailyI18n::isStale($m, 'Eat now'));
        $this->assertSame(['en' => 'Eat'], DailyI18n::merge([], 'Eat', []));
        $this->assertFalse(DailyI18n::isStale(['en' => 'x'], 'y'));                 // nothing translated
    }

    public function testBrandTerms(): void
    {
        $en = "Today's Daily Challenge: find the Local Twist";
        $this->assertSame([], DailyI18n::missingBrandTerms($en, 'Le Daily Challenge du jour : trouve le Local Twist'));
        $this->assertSame(['Daily Challenge', 'Local Twist'], DailyI18n::missingBrandTerms($en, 'Le défi du jour : trouve la variante locale'));
        $this->assertSame([], DailyI18n::missingBrandTerms('Eat breakfast', 'Mange'));
        $this->assertSame(['challenge'], DailyI18n::missingBrandTerms('Take the challenge', 'Relève le défi'));
    }

    public function testClean(): void
    {
        $this->assertSame(['fr' => 'Mange', 'pt-br' => 'Coma'],
            DailyI18n::clean(['en' => 'Eat', 'fr' => ' Mange ', 'pt-BR' => 'Coma', 'de' => '', 'xx' => 'zz', 'it' => 5], 120, 'Text'));
        $this->assertSame([], DailyI18n::clean(null, 120, 'Text'));
        $this->expectException(InvalidArgumentException::class);
        DailyI18n::clean(['fr' => str_repeat('a', 121)], 120, 'Text');
    }

    public function testFormatChallengeInTheViewerLanguage(): void
    {
        $row = ['id' => 'c1', 'challenge_date' => '2026-11-02',
                'text_i18n' => '{"en":"Eat","fr":"Mange","_src":"Eat"}', 'context_i18n' => '{"en":"Why","fr":"Pourquoi"}'];
        $fr = DailyChallengeRepository::formatChallenge($row, null, 'fr');
        $this->assertSame(['Mange', 'Pourquoi', ['text' => 'Eat', 'context' => 'Why'], 'fr'],
                          [$fr['text'], $fr['context'], $fr['original'], $fr['lang']]);
        $de = DailyChallengeRepository::formatChallenge($row, null, 'de');
        $this->assertSame(['Eat', 'Why', null, null], [$de['text'], $de['context'], $de['original'], $de['lang']]);
        DailyI18n::setCurrent('fr-FR');
        $this->assertSame('Mange', DailyChallengeRepository::formatChallenge($row)['text']);
    }

    public function testChallengeCardCarriesTranslations(): void
    {
        $row = ['id' => 'c1', 'challenge_date' => '2026-11-02',
                'text_i18n' => '{"en":"Eat","fr":"Mange","vi":"Ăn"}', 'context_i18n' => '{"en":"Why","fr":"Pourquoi"}'];
        DailyI18n::setCurrent('fr');   // the card itself stays English
        $p = DailyCards::challengePayload($row, ['id' => 't', 'text' => 'Pho', 'author' => null, 'credit' => null], null,
                                          ['fr' => 'Un phở', '_src' => 'Pho']);
        $this->assertSame('Eat', $p['text']);
        $tr = (array) $p['translations'];
        $this->assertSame(['text' => 'Mange', 'context' => 'Pourquoi', 'twist' => 'Un phở'], $tr['fr']);
        $this->assertSame(['text' => 'Ăn'], $tr['vi']);
        $this->assertArrayNotHasKey('de', $tr);
    }

    public function testImportAcceptsTranslations(): void
    {
        $doc = ['challenges' => [[
            'date' => '2099-01-01',
            'text' => ['en' => 'Eat', 'fr' => 'Mange', 'vi' => 'Ăn'],
            'context' => ['en' => 'Why', 'fr' => 'Pourquoi'],
            'twists' => [
                ['city' => 'saigon', 'text' => ['en' => 'Pho', 'fr' => 'Un phở']],
                ['city' => 'saigon', 'text' => 'Plain'],
            ],
        ], [
            'date' => '2099-01-02',
            'text' => ['en' => 'Eat', 'fr' => str_repeat('a', DailyAdminService::TEXT_MAX + 1)],
        ]]];
        $r = DailyAdminService::validateImport($doc, fn(string $s) => 'city_5');
        $this->assertSame(['#2: text (fr) is longer than ' . DailyAdminService::TEXT_MAX . ' characters.'], $r['errors']);
        $e = $r['entries'][0];
        $this->assertSame(['fr' => 'Mange', 'vi' => 'Ăn'], $e['textTranslations']);
        $this->assertSame(['fr' => 'Pourquoi'], $e['contextTranslations']);
        $this->assertCount(16, $e['missingLocales']);
        $this->assertSame([['Pho', ['fr' => 'Un phở']], ['Plain', []]],
                          array_map(fn($t) => [$t['text'], $t['translations']], $e['twists']));
    }

    // ── Pushes ───────────────────────────────────────────────────────────────

    public function testPushCatalogIsComplete(): void
    {
        $expected = [
            'world' => ['{rank}'], 'city_best' => ['{city}'], 'city_rank' => ['{city}', '{rank}'],
            'votes' => ['{n}'], 'winner' => ['{city}', '{name}', '{n}'], 'winner_nocity' => ['{name}', '{n}'],
            'digest_votes' => ['{n}'], 'digest_twist' => ['{n}'],
            'picked_tomorrow' => ['{city}'], 'picked_today' => ['{city}'], 'top10' => ['{rank}'],
            'first_vote' => [],
            'bell_vote' => ['{name}'], 'bell_twist' => ['{city}', '{name}'], 'proposal_approved' => ['{date}'],
            'proposal_reserve' => [], 'proposal_day' => [], 'proposal_result' => ['{n}'], 'proposal_result_one' => [],
            'title_today' => ['{theme}'], 'title_reminder' => ['{h}', '{theme}'], 'did_count' => ['{n}'], 'did_count_one' => [],
            'did_friend' => ['{name}'], 'did_friend_others' => ['{name}', '{n}'], 'did_friend_others_one' => ['{name}'],
            'theme_hidden_gem' => [], 'theme_taste' => [], 'theme_ask_local' => [], 'theme_local_find' => [],
            'theme_night_out' => [], 'theme_sip' => [], 'theme_only_here' => [], 'theme_special' => [], 'city_streak' => ['{city}'],
        ];
        $catalog = DailyPushText::catalog();
        $this->assertSame(DailyI18n::others(), array_keys($catalog));
        foreach ($catalog as $locale => $phrases) {
            $this->assertSame(DailyPushText::KEYS, array_keys($phrases), $locale);
            foreach ($phrases as $key => $tpl) {
                preg_match_all('/\{[a-z]+\}/', $tpl, $m);
                $found = array_values(array_unique($m[0]));
                sort($found);
                $this->assertSame($expected[$key], $found, "{$locale}.{$key}");
            }
            $this->assertStringContainsString('Local Twist', $phrases['digest_twist'], $locale);
        }
    }

    public function testMorningPushInTheRecipientLanguage(): void
    {
        $c = ['challenge_date' => '2026-11-02', 'text_i18n' => '{"en":"Eat","fr":"Mange"}'];
        $this->assertSame('fr', DailyPushes::morningLocale($c, 'fr'));
        $this->assertSame('en', DailyPushes::morningLocale($c, 'vi'));   // not translated: all English, no mix
        $line = DailyPushes::outcomeLine(['worldRank' => 2, 'cityRank' => 1, 'cityBest' => true, 'votes' => 9, 'cityName' => 'Paris'], null, 'fr');
        $this->assertSame('Hier, ta preuve était #2 dans le monde.', $line);
        $fr = DailyPushes::morningMessage($c + ['theme' => 'taste'], $line, 'fr');
        $this->assertSame("🍜 Aujourd'hui : Saveur", $fr['title']);
        $this->assertSame('Mange Hier, ta preuve était #2 dans le monde.', $fr['body']);
        $this->assertSame('Eat', DailyPushes::morningMessage($c, null, 'en')['body']);
        $this->assertSame("Gagnant d'hier : Anh · ♥ 1.",
                          DailyPushes::outcomeLine(null, ['name' => 'Anh', 'cityName' => null, 'votes' => 1], 'fr'));
    }

    public function testReminderAndDigestInTheRecipientLanguage(): void
    {
        $vi = DailyPushes::reminderMessage(['challenge_date' => '2026-11-02', 'theme' => 'sip', 'text_i18n' => '{"en":"Order a coffee","vi":"Gọi một ly cà phê"}'],
                                           6 * 3600 + 5, 'vi', null, 6);
        $this->assertSame('🍹 Nhâm nhi · còn 6 giờ', $vi['title']);
        $this->assertSame('Gọi một ly cà phê 6 người đã làm rồi.', $vi['body']);
        $this->assertSame('Votes pour ta preuve : 3. Ont relevé ton Local Twist : 1.', DailyPushes::digestMessage('2026-11-02', 3, 1, 'fr')['body']);
        $this->assertSame('1 person voted for your proof.', DailyPushes::digestMessage('2026-11-02', 1, 0, 'en')['body']);
        $this->assertNull(DailyPushes::digestMessage('2026-11-02', 0, 0, 'fr'));
    }

    public function testMapPin(): void
    {
        putenv('R2_PUBLIC_URL=https://media.test');
        $pin = DailyChallengeRepository::formatPin([
            'id' => 'p1', 'user_id' => 'u1', 'place_lat' => '10.78', 'place_lng' => '106.7', 'place_name' => null,
            'photo_url' => 'https://media.test/' . str_repeat('a', 32) . '.jpg', 'username' => 'anh', 'display_name' => 'Anh',
        ]);
        $this->assertSame(['p1', 10.78, 106.7, null, ['id' => 'u1', 'username' => 'anh', 'displayName' => 'Anh']],
                          [$pin['proofId'], $pin['lat'], $pin['lng'], $pin['name'], $pin['user']]);
        $this->assertArrayHasKey('thumbUrl', $pin);
    }
}
