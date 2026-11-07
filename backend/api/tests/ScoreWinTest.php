<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../src/ScoreWin.php';

/** The points reward's victory screen: a player's rank before the reward (the ▲ movement). */
final class ScoreWinTest extends TestCase
{
    private function rank(array $rows, string $me, int $delta): ?array
    {
        $m = new ReflectionMethod(ScoreWin::class, 'playerRank');
        return $m->invoke(null, $rows, $me, $delta);
    }

    private function rows(array $points): array
    {
        $out = [];
        foreach ($points as $id => $p) $out[] = ['id' => $id, 'points' => $p, 'username' => "u{$id}", 'display_name' => "U {$id}"];
        return $out;
    }

    public function testClimbToFirst(): void
    {
        // Before +10 I had 25: b (30) and c (28) were above me.
        $r = $this->rank($this->rows(['me' => 35, 'b' => 30, 'c' => 28]), 'me', 10);
        $this->assertSame(1, $r['rank']);
        $this->assertSame(3, $r['prevRank']);
        $this->assertArrayNotHasKey('gap', $r);
    }

    public function testGapAndNextPlayer(): void
    {
        $r = $this->rank($this->rows(['a' => 50, 'me' => 40, 'c' => 5]), 'me', 10);
        $this->assertSame(2, $r['rank']);
        $this->assertSame(2, $r['prevRank']);
        $this->assertSame(11, $r['gap']);
        $this->assertSame('ua', $r['next']['username']);
    }

    public function testNewOnTheBoard(): void
    {
        $r = $this->rank($this->rows(['a' => 50, 'me' => 10]), 'me', 10);
        $this->assertSame(2, $r['rank']);
        $this->assertNull($r['prevRank']);
    }

    public function testNotRanked(): void
    {
        $this->assertNull($this->rank($this->rows(['a' => 50]), 'me', 10));
    }
}
