<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class DailyImportValidationTest extends TestCase
{
    private const CMP = ['type' => 'word', 'question' => ['en' => 'How do locals say cheers?']];

    private static function resolver(): callable
    {
        return fn(string $slug): ?string => $slug === 'ho-chi-minh-city' ? 'city_20' : null;
    }

    public function testExampleFileIsValid(): void
    {
        $doc = json_decode((string) file_get_contents(__DIR__ . '/../../../docs/daily-challenge/daily-challenges.example.json'), true);
        if (!is_array($doc)) {
            $this->markTestSkipped('example file not found');
        }
        $r = DailyAdminService::validateImport($doc, self::resolver());
        $this->assertSame([], $r['errors']);
        $this->assertCount(4, $r['entries']);
        $this->assertSame('2026-11-03', $r['entries'][0]['date']);
        $this->assertSame('taste', $r['entries'][0]['theme']);
        $this->assertSame('special', $r['entries'][2]['theme']);
        $this->assertSame('halloween', $r['entries'][2]['special']['id']);
        $this->assertSame('Halloween', $r['entries'][2]['special']['names']['en']);
        $this->assertSame('hidden_gem', $r['entries'][3]['theme']);
        $this->assertSame('city_20', $r['entries'][0]['twists'][0]['cityId']);
        $this->assertTrue($r['entries'][3]['reserve']);
        $this->assertNull($r['entries'][3]['date']);
        $this->assertSame('word', $r['entries'][0]['compare']['type']);
        $this->assertSame('text', $r['entries'][2]['compare']['type']);
        $this->assertCount(18, $r['entries'][0]['compareMissingLocales']);
    }

    public function testCompareIsRequiredAndChecked(): void
    {
        $doc = ['challenges' => [
            ['date' => '2026-11-05', 'text' => ['en' => 'a']],
            ['date' => '2026-11-06', 'text' => ['en' => 'b'], 'compare' => ['type' => 'colour', 'question' => ['en' => 'Q?']]],
            ['date' => '2026-11-07', 'text' => ['en' => 'c'], 'compare' => ['type' => 'word', 'question' => ['en' => str_repeat('q', 61)]]],
            ['date' => '2026-11-08', 'text' => ['en' => 'd'], 'compare' => ['type' => 'number', 'unit' => 'years',
                'question' => ['en' => 'How many years has it been open?', 'fr' => "Ouverte depuis combien d'années ?", 'zh-CN' => '开了多少年？']]],
        ]];
        $r = DailyAdminService::validateImport($doc, self::resolver());
        $this->assertCount(3, $r['errors']);
        $this->assertStringContainsString('#1: compare is required', $r['errors'][0]);
        $this->assertStringContainsString('#2: compare: type', $r['errors'][1]);
        $this->assertStringContainsString('#3: compare: question (en) is longer than 60', $r['errors'][2]);
        $c = $r['entries'][3]['compare'];
        $this->assertSame('number', $c['type']);
        $this->assertSame('开了多少年？', $c['question']['zh-hans']);
        $this->assertSame(['en' => 'years'], $c['unit']);
        $this->assertNotContains('fr', $r['entries'][3]['compareMissingLocales']);
    }

    public function testErrorsAreCollectedPerEntry(): void
    {
        $doc = ['challenges' => [
            ['date' => '2026-02-30', 'text' => ['en' => 'x'], 'compare' => self::CMP],
            ['date' => '2026-11-05', 'text' => ['fr' => 'pas en anglais'], 'compare' => self::CMP],
            ['date' => '2026-11-06', 'text' => ['en' => 'a'], 'twists' => [['city' => 'atlantis', 'text' => 't']], 'compare' => self::CMP],
            ['date' => '2026-11-06', 'text' => ['en' => 'b'], 'compare' => self::CMP],
            ['reserve' => true, 'date' => '2026-11-07', 'text' => ['en' => 'c'], 'compare' => self::CMP],
        ]];
        $errors = DailyAdminService::validateImport($doc, self::resolver())['errors'];
        $this->assertCount(5, $errors);
        $this->assertStringContainsString('#1: date', $errors[0]);
        $this->assertStringContainsString('#2: text.en', $errors[1]);
        $this->assertStringContainsString('unknown city "atlantis"', $errors[2]);
        $this->assertStringContainsString('appears twice', $errors[3]);
        $this->assertStringContainsString('reserve challenge has no date', $errors[4]);
    }

    public function testRejectsMissingChallengesArray(): void
    {
        $this->assertNotSame([], DailyAdminService::validateImport(['foo' => 1], self::resolver())['errors']);
        $this->assertNotSame([], DailyAdminService::validateImport('nope', self::resolver())['errors']);
    }
}
