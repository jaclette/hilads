<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** The Members screen and Wave 👋: the pure rules (states, filters, tags, notification wiring). */
final class MembersWavesTest extends TestCase
{
    public function testWaveStates(): void
    {
        $today = 1_000_000;
        $this->assertSame('none', Waves::state(null, null, $today));
        $this->assertSame('sent', Waves::state($today + 5, null, $today), 'waved today, no answer yet');
        $this->assertSame('none', Waves::state($today - 5, null, $today), 'waved yesterday: can wave again');
        $this->assertSame('received', Waves::state(null, $today - 3600, $today), 'they waved: wave back');
        $this->assertSame('mutual', Waves::state($today - 10, $today + 10, $today));
        $this->assertSame('mutual', Waves::state($today + 10, $today - 86400 * 3, $today), 'a wave back');
    }

    public function testFilterFallsBackToAll(): void
    {
        $this->assertSame('here', Members::filter('here'));
        $this->assertSame('new', Members::filter('new'));
        $this->assertSame('all', Members::filter('nearby'));
        $this->assertSame('all', Members::filter(null));
    }

    public function testLocalOrTraveler(): void
    {
        $this->assertSame('local', Members::mode('local', 'city_5', 'city_5'));
        $this->assertSame('local', Members::mode('local', null, 'city_5'), 'no home set: local where they are');
        $this->assertSame('traveler', Members::mode('local', 'city_9', 'city_5'), 'a local of another city');
        $this->assertSame('traveler', Members::mode('exploring', 'city_5', 'city_5'));
        $this->assertNull(Members::mode(null, null, 'city_5'), 'no mode: no tag');
    }

    public function testDaysAgo(): void
    {
        $now = new DateTimeImmutable('2026-11-28 10:00:00', new DateTimeZone('UTC'));
        $this->assertSame(0, Members::daysAgo('2026-11-28 01:00:00+00', $now));
        $this->assertSame(1, Members::daysAgo('2026-11-27 23:59:00+00', $now));
        $this->assertSame(7, Members::daysAgo('2026-11-21 12:00:00+00', $now));
        $this->assertNull(Members::daysAgo(null, $now));
    }

    public function testWaveNotificationsAreSocialOncePerDayAndOpenTheProfile(): void
    {
        $this->assertSame('social', NotificationCategory::of('wave'));
        $this->assertSame('social', NotificationCategory::of('wave_back'));
        $now = new DateTimeImmutable('2026-11-28', new DateTimeZone('UTC'));
        $this->assertSame('wave:u1:2026-11-28', NotificationCategory::dedupeKey('wave', ['actorId' => 'u1'], $now));
        $this->assertSame('wave_back:u1:2026-11-28', NotificationCategory::dedupeKey('wave_back', ['actorId' => 'u1'], $now));
        $this->assertSame('/user/u1', NotificationCategory::deepLink('wave', ['actorId' => 'u1', 'actorName' => 'kitty_3']));
        $this->assertSame(['u1', 'kitty_3'], NotificationCategory::actor(['actorId' => 'u1', 'actorName' => 'kitty_3']));
    }

    public function testWaveTextIsTranslated(): void
    {
        $this->assertSame(["kitty_3 t'a fait coucou 👋", null], NotificationI18n::render('wave', 'fr', ['actorName' => 'kitty_3']));
        [$title, $body] = NotificationI18n::render('wave_back', 'vi', ['actorName' => 'minh']);
        $this->assertSame('minh đã vẫy tay lại 🎉', $title);
        $this->assertNotNull($body);
    }

    public function testWelcomeIsAWaveInItsOwnWords(): void
    {
        $this->assertSame('social', NotificationCategory::of('welcome'));
        $now = new DateTimeImmutable('2026-11-28', new DateTimeZone('UTC'));
        $this->assertSame('welcome:u1:2026-11-28', NotificationCategory::dedupeKey('welcome', ['actorId' => 'u1'], $now));
        $this->assertSame('/user/u1', NotificationCategory::deepLink('welcome', ['actorId' => 'u1']));
        $this->assertSame(['kitty_3 te souhaite la bienvenue sur Hilads 👋', null], NotificationI18n::render('welcome', 'fr', ['actorName' => 'kitty_3']));
        $this->assertContains('welcome', Waves::SOURCES);
    }

    public function testGuestLinkSqlCountsAGuestWhoSignedUpAsOnePerson(): void
    {
        $sql = GuestLinks::personSql('m.user_id', 'm.guest_id');
        $this->assertStringContainsString('user_guest_links', $sql);
        $this->assertStringStartsWith('coalesce(coalesce(m.user_id,', $sql);
    }

    public function testSignupHelpers(): void
    {
        $this->assertSame('fr-FR', UserSignups::language('fr-FR,fr;q=0.9,en;q=0.8'));
        $this->assertNull(UserSignups::language('*'));
        $this->assertSame(['utm_source' => 'instagram', 'utm_campaign' => 'launch'],
            UserSignups::cleanUtm(['utm_source' => 'instagram', 'utm_campaign' => 'launch', 'evil' => 'x', 'utm_term' => '']));
        $this->assertNull(UserSignups::cleanUtm('nope'));
        $this->assertSame('App Store', UserSignups::store('ios', null));
        $this->assertSame('Google Play (referred)', UserSignups::store('android', 'utm_source=invite&ref=ABC'));
        $this->assertSame('Google Play', UserSignups::store('android', 'utm_source=google-play&utm_medium=organic'));
        $this->assertNull(UserSignups::store('web', null));
        $this->assertSame('a1b2c3d4', UserSignups::networkId('a1b2c3d4e5f6'));
    }
}
