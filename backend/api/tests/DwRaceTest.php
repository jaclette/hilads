<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../src/DwSlides.php';
require_once __DIR__ . '/../src/DwReaction.php';
require_once __DIR__ . '/../src/DwRace.php';
require_once __DIR__ . '/../src/DwStudio.php';

final class DwRaceTest extends TestCase
{
    private function content(): array
    {
        $series = [];
        foreach (['France' => '🇫🇷', 'Spain' => '🇪🇸', 'Italy' => '🇮🇹', 'Germany' => '🇩🇪', 'Mexico' => '🇲🇽', 'China' => '🇨🇳',
                  'Austria' => '🇦🇹', 'Greece' => '🇬🇷', 'Canada' => '🇨🇦', 'Poland' => '🇵🇱'] as $i => $flag) {
            $series[] = ['country' => $i, 'flag' => $flag, 'values' => array_combine(array_map('strval', range(2000, 2005)), [10.0, 11.5, 12, 13, 14, 15])];
        }
        return ['format' => 'race', 'topic' => 'Visitors', 'headline' => 'Most visited countries ✈️', 'source' => 'UN Tourism',
                'value_label' => 'Overnight visitors, millions', 'caption' => 'Different Worlds by Hilads.', 'outro_question' => 'Which country did YOU visit last? ✈️',
                'cta_line' => 'Show us your trip on hilads.live 📸', 'series' => $series, 'banner_year' => 2004,
                'hashtags' => ['#a', '#b', '#c', '#d', '#e']];
    }

    public function testAValidRacePasses(): void
    {
        [$errors, $warn] = DwRace::validate($this->content());
        $this->assertSame([], $errors);
        $this->assertSame([], $warn);
        $this->assertSame(range(2000, 2005), DwRace::years($this->content()));
        $this->assertEqualsWithDelta(0.6 + 5 * 0.7 + 2 + 3, DwRace::videoSeconds($this->content()), 1e-9);
        $this->assertTrue(DwRace::isRace($this->content()));
    }

    public function testEveryCountryEveryYear(): void
    {
        $c = $this->content();
        unset($c['series'][3]['values']['2002']);
        $this->assertNotEmpty(array_filter(DwRace::validate($c)[0], fn($e) => str_contains($e, 'Germany: no value for 2002')));
        $c = $this->content();
        $c['banner_year'] = 1999;
        $this->assertContains('"banner_year" must be one of the race\'s years.', DwRace::validate($c)[0]);
        $c = $this->content();
        $c['cta_line'] = 'Show us your trip';
        $this->assertContains('"cta_line" must include hilads.live.', DwRace::validate($c)[0]);
        $c = $this->content();
        $c['series'] = array_slice($c['series'], 0, 4);
        $this->assertNotEmpty(DwRace::validate($c)[0]);
    }

    public function testNormalize(): void
    {
        $c = DwRace::normalize($this->content() + ['detail' => ' 2004: boom ']);
        $this->assertSame('2004: boom', $c['detail']);
        $this->assertSame(11.5, $c['series'][0]['values']['2001']);
        $this->assertSame(2004, $c['banner_year']);
    }

    public function testCountRaceFields(): void
    {
        $c = $this->content() + ['value_prefix' => '👑 x', 'step_seconds' => 0.25, 'slow_from' => 2003, 'slow_step' => 0.6];
        $c['series'][0]['order'] = ['2000' => 2, '2001' => 1];
        $this->assertSame([], DwRace::validate($c)[0]);
        // 2001, 2002 fast (0.25), 2003 to 2005 slow (0.6)
        $this->assertEqualsWithDelta(0.6 + 2 * 0.25 + 3 * 0.6 + 2 + 3, DwRace::videoSeconds($c), 1e-9);
        $n = DwRace::normalize($c);
        $this->assertSame('👑 x', $n['value_prefix']);
        $this->assertSame(2003, $n['slow_from']);
        $this->assertSame(['2000' => 2, '2001' => 1], $n['series'][0]['order']);
        $bad = ['slow_from' => 1990] + $c;
        $this->assertNotEmpty(array_filter(DwRace::validate($bad)[0], fn($e) => str_contains($e, 'slow_from')));
        $bad = ['value_prefix' => 'way too long'] + $c;
        $this->assertNotEmpty(array_filter(DwRace::validate($bad)[0], fn($e) => str_contains($e, 'value_prefix')));
    }

    public function testPaceFields(): void
    {
        $c = $this->content() + ['year_step' => 2, 'hold_first' => true, 'step_seconds' => 1.6, 'hold' => 0.75, 'freeze_seconds' => 2.5, 'bar_scale' => 'step'];
        $c['banner_year'] = 2004;
        $this->assertSame([], DwRace::validate($c)[0]);
        $this->assertSame([2000, 2002, 2004, 2005], DwRace::shownYears($c));
        $this->assertEqualsWithDelta(0.6 + 3 * 1.6 + 2.5 + 3, DwRace::videoSeconds($c), 1e-9);
        $this->assertNotEmpty(DwRace::validate(['banner_year' => 2003] + $c)[0]);
        $this->assertNotEmpty(DwRace::validate(['bar_scale' => 'log'] + $c)[0]);
        $this->assertTrue(DwRace::paceValue('hold_first', 'true'));
        $this->assertSame(2, DwRace::paceValue('year_step', '2'));
        $this->assertNull(DwRace::paceValue('freeze_seconds', ''));
    }
}
