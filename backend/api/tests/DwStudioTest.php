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
        $this->assertSame(['The outro: no photo, plain background.'], $warnings);   // the fixture's outro has no picture
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
        $this->assertSame(1, DwStudio::editTarget($c, 'hook.on_screen_text')['slide']);
        $this->assertSame(null, DwStudio::editTarget($c, 'hook.illustration_brief')['slide']);
        $this->assertSame(3, DwStudio::editTarget($c, 'slides.1.on_screen_text')['slide']);
        $this->assertSame(3, DwStudio::editTarget($c, 'slides.1.flag')['slide']);
        $this->assertSame(null, DwStudio::editTarget($c, 'slides.1.caption_detail')['slide']);
        $this->assertSame(8, DwStudio::editTarget($c, 'outro.question')['slide']);
        $this->assertSame(null, DwStudio::editTarget($c, 'caption')['slide']);
        $this->assertNull(DwStudio::editTarget($c, 'slides.6.country'));   // no 7th country
        $this->assertNull(DwStudio::editTarget($c, 'model'));
    }

    public function testPhotoRules(): void
    {
        $c = $this->content();
        $c['hook'] = ['on_screen_text' => 'Hook', 'photo_url' => 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/A.jpg/1920px-A.jpg',
                      'photo_credit' => 'Photo: A, CC0, Wikimedia Commons'];
        $c['slides'][0]['photo_url'] = 'https://example.com/a.jpg';
        $c['slides'][1]['photo_url'] = 'https://upload.wikimedia.org/wikipedia/commons/b/bb/B.jpg';
        [$errors, $warnings] = DwStudio::validate($c, ['Vietnam']);
        $this->assertContains('Country 1: photo_url must be an image file on https://upload.wikimedia.org.', $errors);
        $this->assertContains('Country 2: the photo needs a photo_credit (author and license).', $errors);
        $this->assertNotContains('The hook: the photo needs a photo_credit (author and license).', $errors);
        $this->assertContains('The outro: no photo, plain background.', $warnings);

        $this->assertTrue(DwStudio::photoSourceOk('https://upload.wikimedia.org/wikipedia/commons/3/30/Traditional_Irish_halloween_Jack-o%27-lantern.jpg'));
        $this->assertFalse(DwStudio::photoSourceOk('http://upload.wikimedia.org/a.jpg'));
        $this->assertFalse(DwStudio::photoSourceOk('https://upload.wikimedia.org.evil.test/a.jpg'));
        $this->assertFalse(DwStudio::photoSourceOk('https://upload.wikimedia.org/a.svg'));

        $plan = DwStudio::slidePlan($c);
        $this->assertSame('Photo: A, CC0, Wikimedia Commons', $plan[0]['credit']);
        $this->assertSame('', end($plan)['photo_src']);
        $this->assertSame(['slide' => 3, 'photo' => false], DwStudio::editTarget($c, 'slides.1.photo_credit'));
        $this->assertSame(['slide' => 1, 'photo' => true], DwStudio::editTarget($c, 'hook.photo_url'));
    }

    public function testCaptionEnding(): void
    {
        $cta = 'Compare your city with the world on hilads.live 🌍 (link in bio)';
        $q = 'What does October 31 look like in your city?';
        $want = "Same night, different worlds. This is Different Worlds by Hilads.\n\n{$cta}\n{$q}";

        // The question at the end of the last paragraph (how captions used to be written).
        $this->assertSame($want, DwStudio::fixCaptionEnding("Same night, different worlds. This is Different Worlds by Hilads. {$q}", $cta, $q));
        // Already right: unchanged; the CTA alone, or written after the question: fixed.
        $this->assertSame($want, DwStudio::fixCaptionEnding($want, $cta, $q));
        $this->assertSame($want, DwStudio::fixCaptionEnding("Same night, different worlds. This is Different Worlds by Hilads.\n{$cta}", $cta, $q));
        $this->assertSame($want, DwStudio::fixCaptionEnding("Same night, different worlds. This is Different Worlds by Hilads.\n\n{$q}\n{$cta}", $cta, $q));
        // A new question replaces the old one; a new CTA replaces the previous one.
        $this->assertSame("Body.\n\n{$cta}\nYour city?", DwStudio::fixCaptionEnding("Body.\n\n{$cta}\n{$q}", $cta, 'Your city?', ['questions' => [$q]]));
        $this->assertSame("Body.\n\nSee hilads.live\n{$q}", DwStudio::fixCaptionEnding("Body.\n\n{$cta}\n{$q}", 'See hilads.live', $q, ['ctas' => [$cta]]));
        $this->assertSame("{$cta}\n{$q}", DwStudio::fixCaptionEnding('', $cta, $q));
    }

    public function testFullCaptionOrder(): void
    {
        $cta = 'Compare your city with the world on hilads.live 🌍 (link in bio)';
        $c = ['caption' => "Body text.\n\n{$cta}\nYour city?", 'outro' => ['question' => 'Your city?'],
              'hashtags' => ['#a', '#b'], 'ai_disclosure' => 'Made with AI help.'];
        $this->assertSame("Body text.\n\nMade with AI help.\n\n{$cta}\nYour city?\n\n#a #b", DwStudio::fullCaption($c, $cta));
        $c['caption'] = 'Body text. Your city?';   // an old caption: the ending is added
        $this->assertSame("Body text.\n\nMade with AI help.\n\n{$cta}\nYour city?\n\n#a #b", DwStudio::fullCaption($c, $cta));
    }

    public function testOutroCta(): void
    {
        $with = DwSlides::compose(['kind' => 'outro', 'text' => 'What does October 31 look like in your city?', 'cta' => 'Compare your city on hilads.live'], null);
        $this->assertStringContainsString('>Compare your city on </tspan>', $with);
        $this->assertStringContainsString('fill="#FF7A3D">hilads.live</tspan>', $with);
        $this->assertStringContainsString('viewBox="0 0 64 64"', $with);   // the logo
        $doc = new DOMDocument();
        $this->assertTrue($doc->loadXML($with));
        // The question ends above the line, and stays at least twice its size.
        preg_match('/font-size="(\d+)" fill="#FFFFFF"><tspan/', $with, $q);
        preg_match('/<text x="\d+" y="(\d+)" font-family="Be Vietnam Pro" font-size="(\d+)" xml:space="preserve"><tspan font-weight/', $with, $cta);
        $this->assertGreaterThanOrEqual(2 * (int) $cta[2], (int) $q[1]);
        preg_match_all('/<tspan x="72" y="(\d+)">/', $with, $ys);
        $this->assertLessThan(1472, max(array_map('intval', $ys[1])));
        $this->assertStringNotContainsString('hilads.live', DwSlides::compose(['kind' => 'outro', 'text' => 'Q?'], null));
    }

    public function testSquarePhoto(): void
    {
        $im = imagecreatetruecolor(1600, 1000);
        imagefill($im, 0, 0, imagecolorallocate($im, 200, 120, 40));
        ob_start();
        imagejpeg($im);
        $jpeg = DwSlides::squarePhoto((string) ob_get_clean());
        $this->assertSame([1080, 1080], array_slice(getimagesizefromstring($jpeg), 0, 2));

        $small = imagecreatetruecolor(500, 400);
        ob_start();
        imagepng($small);
        $this->expectException(InvalidArgumentException::class);
        DwSlides::squarePhoto((string) ob_get_clean());
    }

    public function testComposeWithAPhotoAndItsCredit(): void
    {
        $svg = DwSlides::compose(['kind' => 'hook', 'text' => 'Hi', 'credit' => 'Photo: A, CC BY 4.0, Wikimedia Commons'], null, 'JPEGBYTES');
        $this->assertStringContainsString('href="data:image/jpeg;base64,' . base64_encode('JPEGBYTES') . '"', $svg);
        $this->assertStringContainsString('Photo: A, CC BY 4.0, Wikimedia Commons', $svg);
        $this->assertStringNotContainsString('Photo:', DwSlides::compose(['kind' => 'hook', 'text' => 'Hi', 'credit' => 'Photo: A'], null, null));
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
