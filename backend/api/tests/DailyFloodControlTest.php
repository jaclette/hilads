<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Channel flood control (V2-08): hour buckets, group payload and fallback line. */
final class DailyFloodControlTest extends TestCase
{
    private static function entry(string $id, ?string $city): array
    {
        return ['proofId' => $id, 'date' => '2026-11-02', 'thumbUrl' => null,
                'user' => ['id' => 'u' . $id, 'username' => $id, 'displayName' => null],
                'city' => $city !== null ? ['id' => 1, 'name' => $city] : null, 'isLocal' => false];
    }

    public function testHourBucketIsTheUtcClockHour(): void
    {
        $this->assertSame('2026-11-02T09', DailyCards::hourBucket(new DateTimeImmutable('2026-11-02 09:59:59', new DateTimeZone('UTC'))));
        $this->assertSame('2026-11-02T02', DailyCards::hourBucket(new DateTimeImmutable('2026-11-02 09:30:00', new DateTimeZone('Asia/Ho_Chi_Minh'))));
    }

    public function testGroupPayloadAndLine(): void
    {
        $entries = [self::entry('a', 'Saigon'), self::entry('b', 'Lisbon'), self::entry('c', 'Saigon'), self::entry('d', null)];
        for ($i = 0; $i < 4; $i++) {
            $entries[] = self::entry('x' . $i, 'Paris');
        }
        $p = DailyCards::groupPayload('2026-11-02T09', $entries);
        $this->assertSame(8, $p['count']);
        $this->assertSame(['Saigon', 'Lisbon', 'Paris'], $p['cities']);
        $this->assertSame(['a', 'b', 'c', 'd', 'x0', 'x1', 'x2', 'x3'], $p['proofIds']);
        $this->assertSame('📸 8 new proofs: Saigon, Lisbon and 6 more', DailyCards::groupContent($p));

        $this->assertSame('📸 1 new proof: Saigon', DailyCards::groupContent(DailyCards::groupPayload('h', [self::entry('a', 'Saigon')])));
        $this->assertSame('📸 2 new proofs', DailyCards::groupContent(DailyCards::groupPayload('h', [self::entry('a', null), self::entry('b', null)])));
    }

    public function testWithEntryReplacesInPlaceOrAppends(): void
    {
        $entries = [self::entry('a', 'Saigon'), self::entry('b', 'Lisbon')];
        $updated = DailyCards::withEntry($entries, self::entry('a', 'Hanoi'));
        $this->assertSame(['a', 'b'], array_column($updated, 'proofId'));
        $this->assertSame('Hanoi', $updated[0]['city']['name']);
        $this->assertSame(['a', 'b', 'c'], array_column(DailyCards::withEntry($entries, self::entry('c', null)), 'proofId'));
    }
}
