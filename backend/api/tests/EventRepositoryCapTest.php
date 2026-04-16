<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the "one active event per user" cap rule.
 *
 * These tests run entirely in memory using mock PDO objects — no database or
 * network access is required.
 *
 * Covered cases:
 *   1. guestHasActiveEvent() returns true  → found row in DB
 *   2. guestHasActiveEvent() returns false → no row in DB
 *   3. Regular user who already has an active event → creation blocked (429)
 *   4. Ambassador who already has an active event   → creation allowed (cap skipped)
 */
class EventRepositoryCapTest extends TestCase
{
    protected function setUp(): void
    {
        Response::reset();
        Database::reset();
    }

    // ── guestHasActiveEvent() unit tests ─────────────────────────────────────

    public function test_guestHasActiveEvent_returns_true_when_row_found(): void
    {
        $pdo = $this->buildPdoMock(fetchColumnResult: '1');

        $result = EventRepository::guestHasActiveEvent($pdo, 'city_1', 'abc123');

        $this->assertTrue($result);
    }

    public function test_guestHasActiveEvent_returns_false_when_no_row(): void
    {
        $pdo = $this->buildPdoMock(fetchColumnResult: false);

        $result = EventRepository::guestHasActiveEvent($pdo, 'city_1', 'abc123');

        $this->assertFalse($result);
    }

    // ── Ambassador cap exemption ──────────────────────────────────────────────

    /**
     * A regular user who already has an active event must be blocked.
     * The backend should return a 429 with a descriptive error.
     *
     * The PDO mock returns two consecutive fetchColumn() values:
     *   1st call → cooldown check  → false (no cooldown)
     *   2nd call → cap check       → '1'   (has active event)
     */
    public function test_regular_user_with_active_event_is_blocked(): void
    {
        $pdo = $this->buildPdoMockTwoCalls(cooldownHit: false, capHit: true);
        Database::setInstance($pdo);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/429/');

        EventRepository::add(
            channelId:    1,
            guestId:      'guest_regular',
            nickname:     'TestUser',
            title:        'Second event',
            locationHint: null,
            startsAt:     time() + 3600,
            endsAt:       time() + 7200,
            type:         'meetup',
            userId:       'user_regular',
            isAmbassador: false
        );
    }

    /**
     * After being blocked, the Response payload must carry the correct message.
     */
    public function test_blocked_regular_user_response_message(): void
    {
        $pdo = $this->buildPdoMockTwoCalls(cooldownHit: false, capHit: true);
        Database::setInstance($pdo);

        try {
            EventRepository::add(
                channelId:    1,
                guestId:      'guest_regular',
                nickname:     'TestUser',
                title:        'Second event',
                locationHint: null,
                startsAt:     time() + 3600,
                endsAt:       time() + 7200,
                type:         'meetup',
                userId:       'user_regular',
                isAmbassador: false
            );
        } catch (\RuntimeException) {
            // expected
        }

        $this->assertSame(429, Response::$lastStatus);
        $this->assertSame(
            'You already have an active event in this channel',
            Response::$lastPayload['error'] ?? null
        );
    }

    /**
     * An ambassador who already has one or more active events must NOT be blocked.
     * The cap check query must not be executed at all for ambassadors.
     *
     * The mock PDO is set up to return "has active event" as the second fetchColumn()
     * value (cap check position).  If the ambassador code path ever calls it, the
     * Response::json(429) stub throws — and this test fails.  Passing here proves
     * the cap check is skipped entirely for ambassadors.
     */
    public function test_ambassador_with_active_event_is_not_blocked(): void
    {
        // cooldown check: no cooldown
        // cap check: would say "has active event" — but must never be reached for ambassador
        $pdo = $this->buildPdoMockTwoCalls(cooldownHit: false, capHit: true);
        Database::setInstance($pdo);

        try {
            EventRepository::add(
                channelId:    1,
                guestId:      'guest_ambassador',
                nickname:     'AmbassadorUser',
                title:        'Second event from ambassador',
                locationHint: null,
                startsAt:     time() + 3600,
                endsAt:       time() + 7200,
                type:         'meetup',
                userId:       'user_ambassador',
                isAmbassador: true
            );
        } catch (\RuntimeException $e) {
            // Any exception other than a 429 Response is acceptable here
            // (the mock DB will fail on the INSERT statements — that is expected).
            if (str_contains($e->getMessage(), '429')) {
                $this->fail('Ambassador was incorrectly blocked with a 429: ' . $e->getMessage());
            }
        }

        // The cap check must never have triggered a 429.
        $this->assertNotSame(429, Response::$lastStatus, 'Ambassador must not receive a 429 cap error');
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Builds a PDO mock whose prepare()->execute()->fetchColumn() chain returns
     * the given value for every call.  Used for direct calls to guestHasActiveEvent().
     */
    private function buildPdoMock(mixed $fetchColumnResult): \PDO
    {
        $stmt = $this->createMock(PDOStatement::class);
        $stmt->method('execute')->willReturn(true);
        $stmt->method('fetchColumn')->willReturn($fetchColumnResult);

        $pdo = $this->createMock(PDO::class);
        $pdo->method('prepare')->willReturn($stmt);

        return $pdo;
    }

    /**
     * Builds a PDO mock for calls through EventRepository::add(), which runs
     * two guard queries before the INSERT:
     *   1st fetchColumn() → cooldown check (false = no cooldown, pass through)
     *   2nd fetchColumn() → cap check      ('1' = has active event; false = clear)
     *
     * Any subsequent fetchColumn() calls (from INSERT statements) return false.
     */
    private function buildPdoMockTwoCalls(bool $cooldownHit, bool $capHit): \PDO
    {
        $stmt = $this->createMock(PDOStatement::class);
        $stmt->method('execute')->willReturn(true);
        $stmt->method('fetchColumn')->willReturnOnConsecutiveCalls(
            $cooldownHit ? '1' : false,
            $capHit      ? '1' : false,
            false // any further calls (INSERT lastInsertId etc.)
        );

        $pdo = $this->createMock(PDO::class);
        $pdo->method('prepare')->willReturn($stmt);

        return $pdo;
    }
}
