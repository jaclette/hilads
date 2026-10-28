<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Weekly themes (v2, 2026-10-19): weekday defaults, names, v1 keys, specials, payload fallback. */
final class DailyThemesTest extends TestCase
{
    private const CMP = ['type' => 'word', 'question' => 'Q?'];

    protected function tearDown(): void
    {
        unset($_SERVER['REQUEST_METHOD'], $_SERVER['HTTP_X_THEMES'], $_SERVER['HTTP_X_THEMES_REV']);
    }

    public function testEveryWeekdayHasItsTheme(): void
    {
        // 2026-11-02 is a Monday.
        $expected = ['hidden_gem', 'taste', 'get_around', 'local_find', 'night_out', 'sip', 'only_here'];
        foreach ($expected as $i => $key) {
            $date = (new DateTimeImmutable('2026-11-02'))->modify("+{$i} days")->format('Y-m-d');
            $this->assertSame($key, DailyThemes::forDate($date), $date);
        }
    }

    public function testNormalizeAcceptsKeysAndNames(): void
    {
        $this->assertSame('get_around', DailyThemes::normalize('get_around'));
        $this->assertSame('get_around', DailyThemes::normalize('Get around'));
        // Renamed: Ask a local became Join in, then Get around.
        $this->assertSame('get_around', DailyThemes::normalize('join_in'));
        $this->assertSame('get_around', DailyThemes::normalize('Join in'));
        $this->assertSame('get_around', DailyThemes::normalize('ask_local'));
        $this->assertSame('get_around', DailyThemes::normalize('Ask a local'));
        $this->assertSame('get_around', DailyThemes::effective('ask_local', null));
        $this->assertSame('get_around', DailyThemes::effective('join_in', null));
        $this->assertSame('hidden_gem', DailyThemes::normalize(' hidden GEM '));
        $this->assertSame('night_out', DailyThemes::normalize('Night out'));
        // v1 keys and names map to their v2 theme.
        $this->assertSame('taste', DailyThemes::normalize('Street food'));
        $this->assertSame('sip', DailyThemes::normalize('coffee'));
        $this->assertSame('only_here', DailyThemes::normalize('Traditions'));
        $this->assertNull(DailyThemes::normalize('Special'));          // not a weekly theme
        $this->assertSame('special', DailyThemes::normalizeAny('Special'));
        $this->assertNull(DailyThemes::normalize('Brunch'));
        $this->assertNull(DailyThemes::normalize(null));
        $this->assertNull(DailyThemes::normalize(3));
    }

    public function testFormatFallsBackToTheWeekday(): void
    {
        $this->assertSame(['key' => 'sip', 'name' => 'Drinks'], DailyThemes::format('sip', '2026-11-02'));
        $this->assertSame(['key' => 'sip', 'name' => 'Drinks'], DailyThemes::format('coffee', '2026-11-02'));   // unmigrated row
        $this->assertSame(['key' => 'hidden_gem', 'name' => 'Hidden gem'], DailyThemes::format(null, '2026-11-02'));
        $this->assertSame(['key' => 'hidden_gem', 'name' => 'Hidden gem'], DailyThemes::format('gone', '2026-11-02'));
        $this->assertSame(['key' => 'special', 'name' => 'Special'], DailyThemes::format('special', '2026-10-31'));
        $this->assertNull(DailyThemes::format(null, null));
    }

    public function testAnAppBeforeThemesV2GetsTheV1Keys(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $this->assertTrue(DailyThemes::legacyClient());
        $this->assertSame(['key' => 'coffee', 'name' => 'Coffee'], DailyThemes::format('sip', '2026-11-02'));
        $this->assertSame(['key' => 'language', 'name' => 'Language'], DailyThemes::format('get_around', null));
        // A special: the v1 key of its weekday's theme (2026-10-31 is a Saturday: Drinks, v1 coffee).
        $this->assertSame('coffee', DailyThemes::format('special', '2026-10-31')['key']);
        $this->assertSame(['coffee', 'neighborhood'], DailyThemes::clientList(['sip', 'hidden_gem', 'special']));
        $_SERVER['HTTP_X_THEMES'] = '2';
        $this->assertFalse(DailyThemes::legacyClient());
        $this->assertSame(['key' => 'sip', 'name' => 'Drinks'], DailyThemes::format('sip', '2026-11-02'));
        // Each app gets the Wednesday key it knows: v2 Ask a local, rev 3 Join in, rev 4 the current one.
        $this->assertSame('ask_local', DailyThemes::format('get_around', null)['key']);
        $this->assertSame('ask_local', DailyThemes::client('join_in'));
        $_SERVER['HTTP_X_THEMES_REV'] = '3';
        $this->assertSame(['key' => 'join_in', 'name' => 'Get around'], DailyThemes::format('ask_local', null));
        $this->assertSame(['join_in', 'sip'], DailyThemes::clientList(['get_around', 'sip', 'special']));
        $_SERVER['HTTP_X_THEMES_REV'] = '4';
        $this->assertSame(['key' => 'get_around', 'name' => 'Get around'], DailyThemes::format('join_in', null));
        $this->assertSame(['get_around', 'sip'], DailyThemes::clientList(['join_in', 'get_around', 'sip']));
    }

    public function testImportThemes(): void
    {
        $doc = ['challenges' => [
            ['date' => '2026-11-03', 'theme' => 'Drinks', 'text' => ['en' => 'A'], 'compare' => self::CMP],
            ['date' => '2026-11-04', 'text' => ['en' => 'B'], 'compare' => self::CMP],
            ['date' => null, 'reserve' => true, 'text' => ['en' => 'C'], 'compare' => self::CMP],
            ['date' => '2026-11-05', 'theme' => 'Brunch', 'text' => ['en' => 'D'], 'compare' => self::CMP],
            ['date' => '2026-10-31', 'theme' => 'Special', 'special' => ['id' => 'halloween', 'name' => ['en' => 'Halloween', 'zh-CN' => '万圣节']], 'text' => ['en' => 'E'], 'compare' => self::CMP],
            ['date' => '2026-11-06', 'theme' => 'Special', 'text' => ['en' => 'F'], 'compare' => self::CMP],
            ['date' => '2026-11-07', 'theme' => 'Sip', 'special' => ['id' => 'x', 'name' => 'X'], 'text' => ['en' => 'G'], 'compare' => self::CMP],
        ]];
        $r = DailyAdminService::validateImport($doc, fn(string $slug): ?string => null);
        $this->assertSame('sip', $r['entries'][0]['theme']);         // given (a name), even off its weekday
        $this->assertSame('get_around', $r['entries'][1]['theme']);   // Wednesday default
        $this->assertNull($r['entries'][2]['theme']);                // reserve: themed when used
        $this->assertSame('special', $r['entries'][4]['theme']);
        $this->assertSame(['id' => 'halloween', 'names' => ['en' => 'Halloween', 'zh-hans' => '万圣节']], $r['entries'][4]['special']);
        $this->assertCount(3, $r['errors']);
        $this->assertStringContainsString('#4: unknown theme "Brunch"', $r['errors'][0]);
        $this->assertStringContainsString('#6: special.id is required', $r['errors'][1]);
        $this->assertStringContainsString('#7: "special" needs "theme": "Special"', $r['errors'][2]);
    }

    public function testCalendarDays(): void
    {
        $days = DailyChallengeRepository::calendarDays('2026-11-02', '2026-11-05', [
            ['challenge_date' => '2026-11-02', 'theme' => 'sip', 'status' => 'published', 'my_status' => 'approved'],
            ['challenge_date' => '2026-11-03', 'theme' => null, 'status' => 'published', 'my_status' => null],
            ['challenge_date' => '2026-11-05', 'theme' => 'local_find', 'status' => 'scheduled', 'my_status' => null],
        ]);
        $this->assertCount(4, $days);
        $this->assertSame(['date' => '2026-11-02', 'theme' => ['key' => 'sip', 'name' => 'Drinks'], 'special' => null,
                           'published' => true, 'myStatus' => 'approved'], $days[0]);
        $this->assertSame('taste', $days[1]['theme']['key']);   // Tuesday default
        $this->assertFalse($days[2]['published']);              // nothing that day
        $this->assertSame('get_around', $days[2]['theme']['key']);
        $this->assertFalse($days[3]['published']);              // scheduled: theme only
        $this->assertSame('local_find', $days[3]['theme']['key']);
        $this->assertNull($days[3]['myStatus']);
    }

    public function testSpecialInput(): void
    {
        $s = DailySpecials::clean(['id' => 'halloween', 'date' => '2026-10-31', 'names' => ['en' => 'Halloween', 'pt-BR' => 'Halloween']]);
        $this->assertSame('world', $s['scope']);
        $this->assertSame('🎃', $s['emoji']);                   // known default
        $this->assertSame('skull-outline', $s['icon']);
        $this->assertSame(['en' => 'Halloween', 'pt-br' => 'Halloween'], $s['names']);
        $this->assertSame('Halloween', DailySpecials::nameOf(['id' => 'halloween', 'name_i18n' => '{"en":"Halloween","ja":"ハロウィン"}'], 'fr'));
        $this->assertSame('ハロウィン', DailySpecials::nameOf(['id' => 'halloween', 'name_i18n' => '{"en":"Halloween","ja":"ハロウィン"}'], 'ja'));
        $this->expectException(InvalidArgumentException::class);
        DailySpecials::clean(['id' => 'tet', 'date' => '2027-02-06', 'names' => ['en' => 'Tết'], 'scope' => 'country']);
    }
}
