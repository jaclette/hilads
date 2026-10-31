<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** "Different Worlds" packages (Admin › Worlds): validation, slides, safe illustrations. */
final class DwStudioTest extends TestCase
{
    private function content(int $countries = 6): array
    {
        $names = [['Vietnam', '🇻🇳'], ['Mexico', '🇲🇽'], ['Japan', '🇯🇵'], ['Ireland', '🇮🇪'], ['Philippines', '🇵🇭'], ['United States', '🇺🇸'], ['Germany', '🇩🇪'], ['Brazil', '🇧🇷'], ['Kenya', '🇰🇪']];
        $slides = [];
        foreach (array_slice($names, 0, $countries) as [$n, $f]) {
            $slides[] = ['country' => $n, 'flag' => $f, 'on_screen_text' => "Halloween in {$n}", 'caption_detail' => 'Detail.',
                         'illustration_brief' => 'A lantern.', 'source_url' => 'https://example.org/' . rawurlencode(strtolower($n)),
                         'illustration_svg' => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080"><rect width="1080" height="1080" fill="#f80"/></svg>'];
        }
        return [
            'topic' => 'Halloween around the world', 'why_today' => 'It is October 31.',
            'hook' => ['on_screen_text' => 'Halloween looks different everywhere', 'illustration_brief' => 'Pumpkins.', 'illustration_svg' => '<svg viewBox="0 0 10 10"/>'],
            'slides' => $slides,
            'outro' => ['question' => 'How does your city celebrate?', 'illustration_brief' => 'A map.'],
            'caption' => 'Different Worlds by Hilads. How does your city celebrate?',
            'hashtags' => ['halloween', '#travel', '#culture', '#differentworlds', '#hilads'],
            'ai_disclosure' => 'Illustrations made with AI.', 'follow_up_idea' => 'Day of the Dead.', 'warnings' => [],
        ];
    }

    public function testAValidPackagePasses(): void
    {
        [$errors, $warnings] = DwStudio::validate($this->content(), ['Vietnam']);
        $this->assertSame([], $errors);
        $this->assertSame([], $warnings);
    }

    public function testCountriesRules(): void
    {
        [$errors] = DwStudio::validate($this->content(5), ['Vietnam']);
        $this->assertContains('There must be 6 to 8 countries (5).', $errors);

        [$errors] = DwStudio::validate($this->content(6), ['Kenya']);
        $this->assertContains('Kenya must be one of the countries.', $errors);

        $c = $this->content();
        $c['slides'][1]['country'] = 'vietnam';
        unset($c['slides'][2]['source_url']);
        $c['slides'][3]['source_url'] = 'not a url';
        [$errors] = DwStudio::validate($c, []);
        $this->assertContains('A country appears twice.', $errors);
        $this->assertContains('Country 3: "source_url" is missing.', $errors);
        $this->assertContains('Country 4: source_url is not a URL.', $errors);
    }

    public function testLongTextsAreWarningsNotErrors(): void
    {
        $c = $this->content();
        $c['slides'][0]['on_screen_text'] = 'one two three four five six seven eight nine ten eleven twelve thirteen';
        $c['caption'] = 'A caption without the series name.';
        [$errors, $warnings] = DwStudio::validate($c, ['Vietnam']);
        $this->assertSame([], $errors);
        $this->assertContains('Country 1 (Vietnam): on-screen text is 13 words (max 12).', $warnings);
        $this->assertContains('The caption does not mention "Different Worlds by Hilads".', $warnings);
    }

    public function testSplitSvgsAndPlan(): void
    {
        [$c, $svgs] = DwStudio::splitSvgs($this->content(7));
        $this->assertArrayNotHasKey('illustration_svg', $c['hook']);
        $this->assertArrayNotHasKey('illustration_svg', $c['slides'][0]);
        $this->assertSame(['#halloween', '#travel', '#culture', '#differentworlds', '#hilads'], $c['hashtags']);
        $this->assertCount(9, $svgs);
        $this->assertNull($svgs[9]);                       // the outro had none
        $plan = DwStudio::slidePlan($c);
        $this->assertSame([1, 'hook'], [$plan[0]['position'], $plan[0]['kind']]);
        $this->assertSame([2, 'country', 'Vietnam'], [$plan[1]['position'], $plan[1]['kind'], $plan[1]['country']]);
        $this->assertSame([9, 'outro', 'How does your city celebrate?'], [$plan[8]['position'], $plan[8]['kind'], $plan[8]['text']]);
    }

    public function testEditTargets(): void
    {
        $c = $this->content(6);
        $this->assertSame(['slide' => 1], DwStudio::editTarget($c, 'hook.on_screen_text'));
        $this->assertSame(['slide' => null], DwStudio::editTarget($c, 'hook.illustration_brief'));
        $this->assertSame(['slide' => 3], DwStudio::editTarget($c, 'slides.1.on_screen_text'));
        $this->assertSame(['slide' => 3], DwStudio::editTarget($c, 'slides.1.flag'));
        $this->assertSame(['slide' => null], DwStudio::editTarget($c, 'slides.1.caption_detail'));
        $this->assertSame(['slide' => 8], DwStudio::editTarget($c, 'outro.question'));
        $this->assertSame(['slide' => null], DwStudio::editTarget($c, 'caption'));
        $this->assertNull(DwStudio::editTarget($c, 'slides.6.country'));   // no 7th country
        $this->assertNull(DwStudio::editTarget($c, 'model'));
    }

    public function testFullCaption(): void
    {
        [$c] = DwStudio::splitSvgs($this->content());
        $this->assertSame("Different Worlds by Hilads. How does your city celebrate?\n\n#halloween #travel #culture #differentworlds #hilads\n\nIllustrations made with AI.",
            DwStudio::fullCaption($c));
    }

    public function testSanitizeRemovesWhatLoadsOrRuns(): void
    {
        $svg = '```svg
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="800" height="600" onload="x()">
  <script>alert(1)</script>
  <style>@import url(https://evil.example/a.css);</style>
  <defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><circle id="c" r="5"/></defs>
  <image href="file:///etc/passwd" width="10" height="10"/>
  <use xlink:href="https://evil.example/x.svg#a"/>
  <use href="#c"/>
  <rect width="10" height="10" fill="url(#g)" onclick="y()"/>
  <rect width="10" height="10" style="fill:url(https://evil.example/p.png)"/>
  <foreignObject><div>hi</div></foreignObject>
  <text x="1" y="1">LOGO</text>
</svg>
```';
        $out = DwSlides::sanitizeSvg($svg);
        $this->assertNotNull($out);
        foreach (['script', 'onload', 'onclick', '@import', 'evil.example', 'file://', '<image', 'foreignObject', 'LOGO'] as $bad) {
            $this->assertStringNotContainsString($bad, $out, $bad);
        }
        $this->assertStringContainsString('viewBox="0 0 800 600"', $out);
        $this->assertStringContainsString('fill="url(#g)"', $out);
        $this->assertStringContainsString('href="#c"', $out);
        $this->assertStringNotContainsString('width="800"', $out);
    }

    public function testSanitizeRejects(): void
    {
        $this->assertNull(DwSlides::sanitizeSvg('no svg here'));
        $this->assertNull(DwSlides::sanitizeSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>'));
        $this->assertNull(DwSlides::sanitizeSvg('<svg><g></svg>'));
    }

    public function testFlagsAndNames(): void
    {
        $this->assertStringEndsWith('/1f1fb-1f1f3.svg', (string) DwSlides::flagFile('🇻🇳'));
        $this->assertNotNull(DwSlides::flagFile('🏴󠁧󠁢󠁳󠁣󠁴󠁿'));    // Scotland (tag sequence)
        $this->assertNull(DwSlides::flagFile('🎃'));
        $this->assertSame('01_hook.png', DwSlides::fileName(1, 'hook', null));
        $this->assertSame('02_vietnam.png', DwSlides::fileName(2, 'country', 'Vietnam'));
        $this->assertSame('05_united_states.png', DwSlides::fileName(5, 'country', 'United States'));
        $this->assertSame('06_cote_d_ivoire.png', DwSlides::fileName(6, 'country', "Côte d'Ivoire"));
        $this->assertSame('09_outro.png', DwSlides::fileName(9, 'outro', null));
    }

    public function testWrapAndFitStayInTheBox(): void
    {
        $font = DwSlides::font();
        $text = 'Kids go trick-or-treating door to door in their costumes';
        [$px, $lines] = DwSlides::fit($text, 100, 60, 838, 3, $font);
        $this->assertLessThanOrEqual(3, count($lines));
        $this->assertSame($text, implode(' ', $lines));
        foreach ($lines as $l) {
            $this->assertLessThanOrEqual(838, DwSlides::measure($l, $px, $font));
        }
        $this->assertSame('Halloween in Saigon', DwSlides::plain("Halloween 🎃 in\n Saigon 👻"));
    }

    public function testComposeIsOneSafeSvg(): void
    {
        $svg = DwSlides::compose(['kind' => 'country', 'text' => 'Kids & "pumpkins" <3', 'country' => 'Vietnam', 'flag' => '🇻🇳'],
            DwSlides::sanitizeSvg('<svg viewBox="0 0 1080 1080"><circle cx="5" cy="5" r="5"/></svg>'));
        $doc = new DOMDocument();
        $this->assertTrue($doc->loadXML($svg));
        $this->assertSame('Kids & "pumpkins" <3', implode(' ', array_map(fn($n) => $n->textContent,
            iterator_to_array($doc->getElementsByTagName('tspan')))));
        $this->assertStringContainsString('DIFFERENT WORLDS', $svg);
        $this->assertStringContainsString('Vietnam', $svg);
        $this->assertStringContainsString('width="1080" height="1080" preserveAspectRatio', $svg);

        $plain = DwSlides::compose(['kind' => 'outro', 'text' => 'Your city?'], null);
        $this->assertStringContainsString('url(#dwPlain)', $plain);
        $this->assertStringContainsString('YOUR TURN', $plain);
    }
}
