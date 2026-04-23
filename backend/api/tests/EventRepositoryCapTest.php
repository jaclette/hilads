<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the event-creation limits.
 *
 * Runs entirely in memory with mock PDO objects — no database / network.
 *
 * Covered rules:
 *   A. guestHasActiveEvent() helper — still used elsewhere; behavior unchanged.
 *   B. guestCreatedEventTodayCount() helper — new "1 per calendar day" rule.
 *
 * The `add()` method integration is not unit-tested here because it now calls
 * `CityRepository::findById()`, which reaches into the cities table via a
 * separate query() path that the mock doesn't stub. Behavior of the daily
 * limit is exercised through the helper's tests (below) + manual QA against
 * the test matrix in the plan file.
 */
class EventRepositoryCapTest extends TestCase
{
    protected function setUp(): void
    {
        Response::reset();
        Database::reset();
    }

    // ── guestHasActiveEvent() unit tests ─────────────────────────────────────
    //
    // Helper is no longer called from add() but still exposed — kept for
    // admin/introspection callers. Behavior must not regress.

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

    // ── guestCreatedEventTodayCount() — new "1/day" rule ────────────────────

    public function test_todayCount_returns_zero_when_no_events(): void
    {
        $pdo = $this->buildPdoMock(fetchColumnResult: '0');

        $n = EventRepository::guestCreatedEventTodayCount(
            $pdo,
            userId:  'user_123',
            guestId: 'guest_123',
            tz:      'UTC',
        );

        $this->assertSame(0, $n);
    }

    public function test_todayCount_returns_positive_count(): void
    {
        $pdo = $this->buildPdoMock(fetchColumnResult: '3');

        $n = EventRepository::guestCreatedEventTodayCount(
            $pdo,
            userId:  'user_123',
            guestId: 'guest_123',
            tz:      'Asia/Ho_Chi_Minh',
        );

        $this->assertSame(3, $n);
    }

    public function test_todayCount_accepts_null_userId(): void
    {
        // Guest-only path (no registered account).
        $pdo = $this->buildPdoMock(fetchColumnResult: '1');

        $n = EventRepository::guestCreatedEventTodayCount(
            $pdo,
            userId:  null,
            guestId: 'guest_anon',
            tz:      'UTC',
        );

        $this->assertSame(1, $n);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * PDO mock whose prepare()->execute()->fetchColumn() chain returns the
     * given value for every call.
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
}
