<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/Ordinal.php';
require_once __DIR__ . '/../src/NotificationI18n.php';

use PHPUnit\Framework\TestCase;

/** A rank is an ordinal in the language, never "#3" (owner's rule 2026-11-26). */
final class OrdinalTest extends TestCase
{
    public function testEnglish(): void
    {
        $expected = [1 => '1st', 2 => '2nd', 3 => '3rd', 4 => '4th', 11 => '11th', 12 => '12th', 13 => '13th',
                     21 => '21st', 22 => '22nd', 101 => '101st', 111 => '111th'];
        foreach ($expected as $n => $s) {
            $this->assertSame($s, Ordinal::format($n, 'en'), (string) $n);
        }
    }

    public function testOtherLanguages(): void
    {
        $this->assertSame('1er', Ordinal::format(1, 'fr'));
        $this->assertSame('2e', Ordinal::format(2, 'fr'));
        $this->assertSame('3.º', Ordinal::format(3, 'es'));
        $this->assertSame('3.', Ordinal::format(3, 'de'));
        $this->assertSame('3位', Ordinal::format(3, 'ja'));
        $this->assertSame('第3名', Ordinal::format(3, 'zh-hans'));
    }

    public function testPushAndSeasonTextsUseOrdinals(): void
    {
        $this->assertSame('Ta photo est 3e dans le monde en ce moment.',
            substr((string) DailyPushText::render('top10', 'fr', ['rank' => 3]), strlen('Tu es dans le top 10 du jour ! ')));
        [, $body] = NotificationI18n::scoring('daily_season_ending', 'en', ['rank' => 5, 'prev' => 4, 'gap' => 12, 'days' => 3]);
        $this->assertSame("You're 5th, 12 pts from 4th place. Play every day to climb.", $body);
        [$title] = NotificationI18n::scoring('daily_season_result', 'fr', ['rank' => 1, 'medal' => '🥇', 'variant' => 'medal']);
        $this->assertSame('🥇 Tu finis 1er de la saison !', $title);
    }
}
