<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Challenge proposals (V2-05): input rules, statuses, suggested day, author pushes. */
final class DailyProposalsTest extends TestCase
{
    public function testValidate(): void
    {
        [$f, $err] = DailyProposals::validate(['text' => "  Eat   breakfast\nlike a local ", 'theme' => 'Taste', 'why' => ' ', 'twistText' => '']);
        $this->assertNull($err);
        $this->assertSame(['text' => 'Eat breakfast like a local', 'theme' => 'taste', 'why' => null, 'twist_text' => null], $f);

        $this->assertSame('invalid_text', DailyProposals::validate(['text' => '', 'theme' => 'sip'])[1]);
        $this->assertSame('invalid_text', DailyProposals::validate(['text' => str_repeat('a', 121), 'theme' => 'sip'])[1]);
        $this->assertNull(DailyProposals::validate(['text' => str_repeat('é', 120), 'theme' => 'sip'])[1]);
        $this->assertSame('invalid_theme', DailyProposals::validate(['text' => 'A', 'theme' => 'brunch'])[1]);
        $this->assertSame('invalid_theme', DailyProposals::validate(['text' => 'A'])[1]);
        $this->assertSame('invalid_why', DailyProposals::validate(['text' => 'A', 'theme' => 'sip', 'why' => str_repeat('a', 201)])[1]);
        $this->assertSame('invalid_twist', DailyProposals::validate(['text' => 'A', 'theme' => 'sip', 'twistText' => str_repeat('a', 281)])[1]);
    }

    public function testStatusOf(): void
    {
        $this->assertSame('pending', DailyProposals::statusOf(['status' => 'pending']));
        $this->assertSame('rejected', DailyProposals::statusOf(['status' => 'rejected']));
        $approved = ['status' => 'approved', 'challenge_status' => 'scheduled', 'challenge_date' => '2026-11-05', 'is_reserve' => false];
        $this->assertSame('scheduled', DailyProposals::statusOf($approved));
        $this->assertSame('published', DailyProposals::statusOf(['challenge_status' => 'published'] + $approved));
        $this->assertSame('reserve', DailyProposals::statusOf(['status' => 'approved', 'challenge_status' => 'scheduled', 'challenge_date' => null, 'is_reserve' => 't']));
        // A used reserve has a date and is published.
        $this->assertSame('published', DailyProposals::statusOf(['status' => 'approved', 'challenge_status' => 'published', 'challenge_date' => '2026-11-03', 'is_reserve' => 't']));
    }

    public function testNextFreeDayOfTheTheme(): void
    {
        // 2026-11-04 is a Wednesday; Ask a local = Wednesday.
        $this->assertSame('2026-11-11', DailyProposals::nextFreeDay('ask_local', '2026-11-04', []));
        $this->assertSame('2026-11-18', DailyProposals::nextFreeDay('ask_local', '2026-11-04', ['2026-11-11' => true]));
        $this->assertSame('2026-11-05', DailyProposals::nextFreeDay('local_find', '2026-11-04', []));
        $this->assertSame('2026-11-09', DailyProposals::nextFreeDay('hidden_gem', '2026-11-04', []));
    }

    public function testAuthorPushTexts(): void
    {
        $this->assertSame('Your challenge goes live on Thursday, November 12.', DailyPushes::proposalApprovedMessage('2026-11-12')['body']);
        $this->assertSame('Your challenge is in the reserve: it goes live on a day with nothing planned.', DailyPushes::proposalApprovedMessage(null)['body']);
        $this->assertSame('Today, everyone is doing your challenge.', DailyPushes::proposalDayMessage('2026-11-12')['body']);
        $this->assertSame('214 people completed your challenge.', DailyPushes::proposalResultMessage('2026-11-12', 214)['body']);
        $this->assertSame('1 person completed your challenge.', DailyPushes::proposalResultMessage('2026-11-12', 1)['body']);
    }
}
