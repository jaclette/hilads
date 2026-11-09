<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** "Different Worlds" reaction + ranking format: validation, rows, Pixabay hits (pure). */
final class DwReactionTest extends TestCase
{
    private function rows(int $n = 3): array
    {
        $all = [['Czech Republic', '🇨🇿', 148.8], ['Lithuania', '🇱🇹', 110.6], ['Austria', '🇦🇹', 104.6], ['Ireland', '🇮🇪', 99.0]];
        return array_map(static fn($r, $i) => ['rank' => $i + 1, 'country' => $r[0], 'flag' => $r[1], 'value' => $r[2], 'unit' => 'L'],
            array_slice($all, 0, $n), array_keys(array_slice($all, 0, $n)));
    }

    private function content(): array
    {
        return [
            'format' => 'reaction', 'topic' => 'Beer', 'headline' => 'The 20 biggest beer drinkers 🍺', 'detail' => '#1 has won for 32 years.',
            'rows' => $this->rows(), 'source' => 'Kirin', 'source_url' => 'https://www.kirinholdings.com/x.pdf', 'data_year' => 2024,
            'value_label' => 'Liters per person per year', 'clip_query' => 'shocked face', 'clip' => ['pixabay_id' => 329144],
            'caption' => "Different Worlds by Hilads.\n\nCompare your city\nWhere does your country rank?",
            'outro_question' => 'Where does your country rank?', 'cta_line' => 'Snap your local beer on hilads.live 🍻', 'hashtags' => ['#a', '#b', '#c', '#d', '#e'], 'warnings' => [],
        ];
    }

    public function testAValidPackagePasses(): void
    {
        [$errors, $warn] = DwReaction::validate($this->content(), ['Vietnam']);
        $this->assertSame([], $errors);
        $this->assertCount(1, $warn);
        $this->assertStringContainsString('Vietnam is not in the ranking', $warn[0]);
    }

    public function testRequiredFieldsAndYear(): void
    {
        $c = $this->content();
        unset($c['source'], $c['clip_query']);
        $c['data_year'] = 1800;
        [$errors] = DwReaction::validate($c);
        $this->assertContains('"source" is missing.', $errors);
        $this->assertContains('"clip_query" is missing.', $errors);
        $this->assertNotEmpty(array_filter($errors, fn($e) => str_contains($e, 'data_year')));
    }

    public function testRanksUnitsAndDuplicates(): void
    {
        $rows = $this->rows();
        $rows[1]['rank'] = 5;
        $this->assertNotEmpty(DwReaction::checkRows($rows)[0]);

        $rows = $this->rows();
        $rows[2]['unit'] = 'kg';
        $this->assertStringContainsString('same unit', implode(' ', DwReaction::checkRows($rows)[0]));

        $rows = $this->rows();
        $rows[2]['country'] = 'Lithuania';
        $this->assertContains('A country appears twice.', DwReaction::checkRows($rows)[0]);

        $rows = $this->rows();
        $rows[0]['value'] = 'lots';
        $this->assertNotEmpty(DwReaction::checkRows($rows)[0]);

        $many = array_map(static fn($i) => ['rank' => $i, 'country' => "C{$i}", 'flag' => '🇨🇿', 'value' => 100 - $i, 'unit' => 'L'], range(1, 21));
        $this->assertStringContainsString('At most 20', implode(' ', DwReaction::checkRows($many)[0]));
    }

    public function testEqualValuesShareARank(): void
    {
        $rows = [['rank' => 1, 'country' => 'A', 'flag' => '🇨🇿', 'value' => 54.6, 'unit' => '%'],
                 ['rank' => 2, 'country' => 'B', 'flag' => '🇨🇿', 'value' => 54.5, 'unit' => '%'],
                 ['rank' => 2, 'country' => 'C', 'flag' => '🇨🇿', 'value' => 54.5, 'unit' => '%'],
                 ['rank' => 4, 'country' => 'D', 'flag' => '🇨🇿', 'value' => 54.3, 'unit' => '%'],
                 ['rank' => 125, 'country' => 'Vietnam', 'flag' => '🇻🇳', 'value' => 8.2, 'unit' => '%']];
        $this->assertSame([], DwReaction::checkRows($rows, ['Vietnam'])[0]);

        $rows[2]['value'] = 54.4;   // a shared rank needs the same value
        $this->assertNotEmpty(DwReaction::checkRows($rows, ['Vietnam'])[0]);

        $rows[2]['value'] = 54.5;
        $rows[3]['rank'] = 3;       // after a tie the next rank skips (competition ranking)
        $this->assertNotEmpty(DwReaction::checkRows($rows, ['Vietnam'])[0]);
    }

    public function testDataYearsInTheSourceLine(): void
    {
        $c = ['value_label' => '% of women aged 30–34 never married', 'data_year' => 2018, 'data_years' => '2010s', 'source' => 'UN World Marriage Data 2019'];
        $this->assertSame('% of women aged 30–34 never married, 2010s · Source: UN World Marriage Data 2019', DwReaction::sourceLine($c));
        unset($c['data_years']);
        $this->assertStringContainsString(', 2018 · ', DwReaction::sourceLine($c));
        $bad = $this->content();
        $bad['data_years'] = str_repeat('x', 70);
        $this->assertNotEmpty(DwReaction::validate($bad)[0]);
    }

    public function testTheSinglesPackageNov11(): void
    {
        $file = __DIR__ . '/../../../docs/worlds/2026-11-11-reaction.json';
        if (!is_file($file)) {
            $this->markTestSkipped('docs/worlds is untracked');
        }
        $c = json_decode((string) file_get_contents($file), true)['content'];
        $c['cta_line'] ??= 'Show us yours on hilads.live';   // the files predate cta_line
        [$errors, $warn] = DwReaction::validate($c, ['Vietnam']);
        $warn = self::withoutTopTenNote($warn);
        $this->assertSame([], $errors);
        $this->assertSame([], $warn);
        $this->assertSame(DwStudio::fixCaptionEnding($c['caption'], DwSeed::CAPTION_CTA, $c['outro_question']), $c['caption']);
        $this->assertStringEndsWith("\nSingle or taken? 👀", $c['caption']);
    }

    public function testTheNovember10Package(): void
    {
        $file = __DIR__ . '/../../../docs/worlds/2026-11-10-reaction.json';
        if (!is_file($file)) {
            $this->markTestSkipped('docs/worlds is untracked');
        }
        $c = json_decode((string) file_get_contents($file), true)['content'];
        $c['cta_line'] ??= 'Show us yours on hilads.live';   // the files predate cta_line
        [$errors] = DwReaction::validate($c, ['Vietnam']);
        $this->assertSame([], $errors);
        $this->assertCount(15, $c['rows']);
        $this->assertSame(DwStudio::fixCaptionEnding($c['caption'], DwSeed::CAPTION_CTA, $c['outro_question']), $c['caption']);
    }

    public function testTheNoodlesPackageNov9(): void
    {
        $file = __DIR__ . '/../../../docs/worlds/2026-11-09-reaction.json';
        if (!is_file($file)) {
            $this->markTestSkipped('docs/worlds is untracked');
        }
        $c = json_decode((string) file_get_contents($file), true)['content'];
        $c['cta_line'] ??= 'Show us yours on hilads.live';   // the files predate cta_line
        [$errors, $warn] = DwReaction::validate($c, ['Vietnam']);
        $warn = self::withoutTopTenNote($warn);
        $this->assertSame([], $errors);
        $this->assertSame([], $warn);
        $this->assertSame('Vietnam', $c['rows'][0]['country']);
        $this->assertSame(DwStudio::fixCaptionEnding($c['caption'], DwSeed::CAPTION_CTA, $c['outro_question']), $c['caption']);
    }

    public function testASeparatorBeforeTheBottomRows(): void
    {
        $row = static fn($rank, $c, $v, $extra = []) => ['rank' => $rank, 'country' => $c, 'flag' => '🇨🇭', 'value' => $v, 'unit' => '$'] + $extra;
        $rows = [$row(1, 'A', 9.04), $row(2, 'B', 8.94), $row(3, 'US', 8.0, ['highlight' => true]),
                 $row(49, 'Vietnam', 2.89, ['gap_before' => true]), $row(50, 'C', 2.87), $row(51, 'D', 2.38)];
        [$errors, $warn] = DwReaction::checkRows($rows, ['Vietnam']);
        $this->assertSame([], $errors);
        $this->assertSame([], $warn);

        unset($rows[3]['gap_before']);      // a skip needs its separator
        $this->assertNotEmpty(DwReaction::checkRows($rows, ['Vietnam'])[0]);

        $rows[3]['gap_before'] = true;
        $rows[4]['rank'] = 52;              // after the separator the ranks go on 1 by 1
        $this->assertNotEmpty(DwReaction::checkRows($rows, ['Vietnam'])[0]);

        $first = [$row(1, 'A', 9.0, ['gap_before' => true]), $row(2, 'B', 8.0)];
        $this->assertNotEmpty(DwReaction::checkRows($first)[0]);

        $c = DwReaction::normalize(['rows' => [$row(49, 'Vietnam', 2.8946, ['gap_before' => true, 'highlight' => false])]]);
        $this->assertSame(['rank' => 49, 'country' => 'Vietnam', 'flag' => '🇨🇭', 'value' => 2.89, 'unit' => '$', 'gap_before' => true], $c['rows'][0]);
    }

    public function testTheNovember12Package(): void
    {
        $file = __DIR__ . '/../../../docs/worlds/2026-11-12-reaction.json';
        if (!is_file($file)) {
            $this->markTestSkipped('docs/worlds is untracked');
        }
        $c = json_decode((string) file_get_contents($file), true)['content'];
        $c['cta_line'] ??= 'Show us yours on hilads.live';   // the files predate cta_line
        [$errors, $warn] = DwReaction::validate($c, ['Vietnam']);
        $warn = self::withoutTopTenNote($warn);
        $this->assertSame([], $errors);
        $this->assertSame(['The detail is 10 words (max 8).'], $warn);   // "1 Big Mac in Switzerland = almost 4 in Indonesia", as asked
        $this->assertSame(DwStudio::fixCaptionEnding($c['caption'], DwSeed::CAPTION_CTA, $c['outro_question']), $c['caption']);
    }

    public function testTheNovember13Package(): void
    {
        $file = __DIR__ . '/../../../docs/worlds/2026-11-13-reaction.json';
        if (!is_file($file)) {
            $this->markTestSkipped('docs/worlds is untracked');
        }
        $c = json_decode((string) file_get_contents($file), true)['content'];
        $c['cta_line'] ??= 'Show us yours on hilads.live';   // the files predate cta_line
        [$errors, $warn] = DwReaction::validate($c, ['Vietnam']);
        $warn = self::withoutTopTenNote($warn);
        $this->assertSame([], $errors);
        $this->assertSame([], $warn);
        $this->assertCount(20, $c['rows']);
        $this->assertSame(DwStudio::fixCaptionEnding($c['caption'], DwSeed::CAPTION_CTA, $c['outro_question']), $c['caption']);
    }

    public function testTheNovember14Package(): void
    {
        $file = __DIR__ . '/../../../docs/worlds/2026-11-14-reaction.json';
        if (!is_file($file)) {
            $this->markTestSkipped('docs/worlds is untracked');
        }
        $c = json_decode((string) file_get_contents($file), true)['content'];
        $c['cta_line'] ??= 'Show us yours on hilads.live';   // the files predate cta_line
        [$errors, $warn] = DwReaction::validate($c, ['Vietnam']);
        $warn = self::withoutTopTenNote($warn);
        $this->assertSame([], $errors);
        $this->assertSame(['Vietnam is not in the ranking: add its row with its real rank only if the same source ranks it.'], $warn);
        $this->assertSame('International tourists per resident, countries & territories, 2019, last year before the pandemic · Sources: UN Tourism, UN World Population Prospects',
            DwReaction::sourceLine($c));
        $this->assertSame('ratio', DwReaction::normalize($c)['value_format']);
        $bad = $c;
        $bad['value_format'] = 'money';
        $this->assertNotEmpty(DwReaction::validate($bad)[0]);
    }

    public function testTheNovember15Package(): void
    {
        $file = __DIR__ . '/../../../docs/worlds/2026-11-15-reaction.json';
        if (!is_file($file)) {
            $this->markTestSkipped('docs/worlds is untracked');
        }
        $c = json_decode((string) file_get_contents($file), true)['content'];
        $c['cta_line'] ??= 'Show us yours on hilads.live';   // the files predate cta_line
        [$errors, $warn] = DwReaction::validate($c, ['Vietnam']);
        $warn = self::withoutTopTenNote($warn);
        $this->assertSame([], $errors);
        $this->assertSame(['The detail is 9 words (max 8).'], $warn);   // "UAE: 2 in 3 adults are dating their sofa", as asked
        $this->assertSame(['rank' => 73, 'country' => 'Vietnam'], array_intersect_key(end($c['rows']), ['rank' => 1, 'country' => 1]));
        $this->assertSame('one_decimal', DwReaction::normalize($c)['value_format']);
        $this->assertSame('% of adults not physically active enough, 2022 · Source: WHO', DwReaction::sourceLine($c));
    }

    /** The package tests predate the top 10 cut: its note is tested on its own (testMoreThanTenRowsAreNoted). */
    private static function withoutTopTenNote(array $warn): array
    {
        return array_values(array_filter($warn, static fn($w) => !str_contains($w, 'the video shows the top')));
    }

    public function testMoreThanTenRowsAreNoted(): void
    {
        $file = __DIR__ . '/../../../docs/worlds/2026-11-15-reaction.json';
        if (!is_file($file)) {
            $this->markTestSkipped('docs/worlds is untracked');
        }
        $c = json_decode((string) file_get_contents($file), true)['content'];
        $c['cta_line'] ??= 'Show us yours on hilads.live';   // the files predate cta_line
        [, $warn] = DwReaction::validate($c, ['Vietnam']);
        $this->assertContains('21 rows: the video shows the top 10 ("Top 10" in its source line); the others are for the caption only.', $warn);
        $c['rows'] = array_slice($c['rows'], 0, 10);
        $this->assertSame([], array_values(array_filter(DwReaction::validate($c, ['Vietnam'])[1], fn($w) => str_contains($w, 'the video shows the top'))));
    }

    public function testTheClosingSlideNeedsItsInvitation(): void
    {
        $file = __DIR__ . '/../../../docs/worlds/2026-11-09-reaction.json';
        if (!is_file($file)) {
            $this->markTestSkipped('docs/worlds is untracked');
        }
        $c = json_decode((string) file_get_contents($file), true)['content'];
        unset($c['cta_line']);
        $this->assertContains('"cta_line" is missing.', DwReaction::validate($c, ['Vietnam'])[0]);
        $c['cta_line'] = 'Show the world your bowl 🍜';
        $this->assertNotEmpty(array_filter(DwReaction::validate($c, ['Vietnam'])[0], fn($e) => str_contains($e, 'hilads.live')));
        $c['cta_line'] = 'Show the world your bowl on hilads.live 🍜';
        [$errors, $warn] = DwReaction::validate($c, ['Vietnam']);
        $this->assertSame([], $errors);
        $this->assertSame([], array_values(array_filter($warn, fn($w) => str_contains($w, 'cta_line'))));
        $this->assertSame('Show the world your bowl on hilads.live 🍜', DwReaction::normalize($c)['cta_line']);
    }

    public function testQuizMode(): void
    {
        $c = $this->content();
        $this->assertSame('classic', DwReaction::mode($c));
        $this->assertSame(11.0, (float) DwReaction::videoSeconds($c));
        $c['mode'] = 'quiz';
        $this->assertContains('Quiz mode needs a "quiz_question" (its answer is the #1).', DwReaction::validate($c, ['Vietnam'])[0]);
        $this->assertSame('classic', DwReaction::mode($c), 'no quiz without its question');
        $c['quiz_question'] = 'Which country drinks the most beer? 🍺';
        [$errors, $warn] = DwReaction::validate($c, ['Vietnam']);
        $this->assertSame([], $errors);
        $this->assertSame([], array_values(array_filter($warn, fn($w) => str_contains($w, 'quiz'))));
        $this->assertSame('quiz', DwReaction::mode($c));
        $this->assertSame(12.0, (float) DwReaction::videoSeconds($c));
        $c['quiz_question'] = 'Which country in the whole wide world drinks the most beer';
        $warn = DwReaction::validate($c, ['Vietnam'])[1];
        $this->assertNotEmpty(array_filter($warn, fn($w) => str_contains($w, 'quiz question is')));
        $this->assertNotEmpty(array_filter($warn, fn($w) => str_contains($w, 'end with an emoji')));
        $c['mode'] = 'trivia';
        $this->assertContains('"mode" is "classic" or "quiz".', DwReaction::validate($c, ['Vietnam'])[0]);
    }

    public function testOneExtraHighlightedRowWithItsRealRank(): void
    {
        $rows = $this->rows();
        $rows[] = ['rank' => 34, 'country' => 'Vietnam', 'flag' => '🇻🇳', 'value' => 56.0, 'unit' => 'L'];
        [$errors, $warn] = DwReaction::checkRows($rows, ['Vietnam']);
        $this->assertSame([], $errors);
        $this->assertSame([], $warn);

        $rows[3]['country'] = 'Japan';
        [, $warn] = DwReaction::checkRows($rows, ['Vietnam']);
        $this->assertNotEmpty(array_filter($warn, fn($w) => str_contains($w, 'only a highlighted country')));

        $rows[] = ['rank' => 40, 'country' => 'Laos', 'flag' => '🇱🇦', 'value' => 50.0, 'unit' => 'L'];
        $this->assertNotEmpty(DwReaction::checkRows($rows, ['Vietnam'])[0], 'only one extra row, the last');
    }

    public function testWordLimitsAreWarnings(): void
    {
        $c = $this->content();
        $c['headline'] = 'One two three four five six seven';
        $c['detail'] = 'One two three four five six seven eight nine';
        [$errors, $warn] = DwReaction::validate($c);
        $this->assertSame([], $errors);
        $this->assertNotEmpty(array_filter($warn, fn($w) => str_contains($w, 'headline is 7 words')));
        $this->assertNotEmpty(array_filter($warn, fn($w) => str_contains($w, 'detail is 9 words')));
    }

    public function testNormalizeSourceLineAndCredit(): void
    {
        $c = DwReaction::normalize(['rows' => [['rank' => '1', 'country' => ' Czech Republic ', 'flag' => '🇨🇿', 'value' => '148.8', 'unit' => 'L']],
                                    'hashtags' => ['beer'], 'data_year' => '2024', 'value_label' => 'Liters per person per year', 'source' => 'Kirin']);
        $this->assertSame('reaction', $c['format']);
        $this->assertSame(['rank' => 1, 'country' => 'Czech Republic', 'flag' => '🇨🇿', 'value' => 148.8, 'unit' => 'L'], $c['rows'][0]);
        $this->assertSame(['#beer'], $c['hashtags']);
        $this->assertSame('Liters per person per year, 2024 · Source: Kirin', DwReaction::sourceLine($c));
        $this->assertSame('Video: Solarselle77 / Pixabay', DwReaction::clipCredit(['author' => 'Solarselle77']));
        $this->assertSame('', DwReaction::clipCredit(null));
        $this->assertSame('', DwReaction::clipCredit(['source' => 'upload', 'credit' => 'AI video: Google Flow (Veo)', 'ai_generated' => true]), 'our own clip: no credit on screen');
    }

    public function testPixabayHit(): void
    {
        $hit = DwPixabay::hit(['id' => 329144, 'pageURL' => 'https://pixabay.com/videos/id-329144/', 'user' => 'Solarselle77', 'duration' => 10,
            'tags' => 'monkey, surprised, ai generated', 'videos' => [
                'large' => ['url' => 'https://cdn.pixabay.com/video/l.mp4', 'width' => 2560, 'height' => 1440, 'thumbnail' => 't'],
                'medium' => ['url' => 'https://cdn.pixabay.com/video/m.mp4', 'width' => 1920, 'height' => 1080, 'thumbnail' => 't'],
                'small' => ['url' => 'https://cdn.pixabay.com/video/s.mp4', 'width' => 1280, 'height' => 720, 'thumbnail' => 't'],
                'tiny' => ['url' => 'https://cdn.pixabay.com/video/t.mp4', 'width' => 960, 'height' => 540, 'thumbnail' => 't'],
            ]]);
        $this->assertSame('https://cdn.pixabay.com/video/s.mp4', $hit['url'], 'the smallest rendition covering 1080 × 640');
        $this->assertTrue($hit['ai']);
        $this->assertNull(DwPixabay::hit(['id' => 1, 'videos' => []]));
        $this->assertFalse(DwPixabay::aiTagged('maintain, aircraft'));
        $this->assertTrue(DwPixabay::fileOk('https://cdn.pixabay.com/video/2025/01/01/x_large.mp4?download'));
        $this->assertFalse(DwPixabay::fileOk('https://evil.example/video.mp4'));

        $clip = DwReaction::clipOf($hit, 'https://media.example/dw/1/v1/clip.mp4');
        $this->assertSame(['pixabay_id' => 329144, 'url' => 'https://media.example/dw/1/v1/clip.mp4', 'source_url' => 'https://pixabay.com/videos/id-329144/',
            'author' => 'Solarselle77', 'license' => 'Pixabay Content License', 'license_url' => 'https://pixabay.com/service/license-summary/',
            'ai_generated' => true, 'duration' => 10], $clip);
    }

    public function testTheNovember8Package(): void
    {
        $file = __DIR__ . '/../../../docs/worlds/2026-11-08-reaction.json';
        if (!is_file($file)) {
            $this->markTestSkipped('docs/worlds is untracked');
        }
        $c = json_decode((string) file_get_contents($file), true)['content'];
        $c['cta_line'] ??= 'Show us yours on hilads.live';   // the files predate cta_line
        [$errors, $warn] = DwReaction::validate($c, ['Vietnam']);
        $warn = self::withoutTopTenNote($warn);
        $this->assertSame([], $errors);
        $this->assertSame(['Vietnam is not in the ranking: add its row with its real rank only if the same source ranks it.'], $warn);
        $this->assertSame(DwStudio::fixCaptionEnding($c['caption'], DwSeed::CAPTION_CTA, $c['outro_question']), $c['caption']);
    }
}
