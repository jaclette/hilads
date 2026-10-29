<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Admin › Daily › Seasonal events: phases by challenge date, and the preview accounts. */
final class SeasonalEventsTest extends TestCase
{
    private static function halloween(array $over = []): array
    {
        return SeasonalEvents::clean($over + [
            'id' => 'halloween-2026', 'name' => 'Halloween', 'theme' => 'halloween',
            'teaserStart' => '2026-10-29', 'start' => '2026-10-31', 'end' => '2026-10-31',
        ]);
    }

    public function testPhasesFollowTheChallengeDate(): void
    {
        $e = self::halloween();
        $this->assertNull(SeasonalEvents::phase($e, '2026-10-28'));
        $this->assertSame('teaser', SeasonalEvents::phase($e, '2026-10-29'));
        $this->assertSame('teaser', SeasonalEvents::phase($e, '2026-10-30'));
        $this->assertSame('live', SeasonalEvents::phase($e, '2026-10-31'));
        $this->assertSame('recap', SeasonalEvents::phase($e, '2026-11-01'));
        $this->assertNull(SeasonalEvents::phase($e, '2026-11-02'));
        $this->assertNull(SeasonalEvents::phase(self::halloween(['teaserStart' => '']), '2026-10-30'));
    }

    public function testViewerGetsTheCountdownAndNothingOutside(): void
    {
        $events = [self::halloween()];
        $this->assertSame(['teaser', 2], [SeasonalEvents::forViewer('2026-10-29', null, $events)['phase'],
                                          SeasonalEvents::forViewer('2026-10-29', null, $events)['startsInDays']]);
        $this->assertSame(1, SeasonalEvents::forViewer('2026-10-30', null, $events)['startsInDays']);
        $live = SeasonalEvents::forViewer('2026-10-31', ['username' => 'linh'], $events);
        $this->assertSame(['halloween', 'live', null, false], [$live['theme'], $live['phase'], $live['startsInDays'], $live['preview']]);
        $this->assertNull(SeasonalEvents::forViewer('2026-10-20', null, $events));
        $this->assertNull(SeasonalEvents::forViewer('2026-10-31', null, []));
    }

    public function testPreviewAccountsSeeTheirPhaseAnyDay(): void
    {
        $events = [self::halloween(['previewUsers' => '@Jacques, linh', 'previewPhase' => 'teaser'])];
        $this->assertSame(['jacques', 'linh'], $events[0]['previewUsers']);
        $me = SeasonalEvents::forViewer('2026-10-26', ['username' => 'JACQUES'], $events);
        $this->assertSame(['teaser', 2, true], [$me['phase'], $me['startsInDays'], $me['preview']]);
        $this->assertNull(SeasonalEvents::forViewer('2026-10-26', ['username' => 'someone'], $events));
        $this->assertNull(SeasonalEvents::forViewer('2026-10-26', null, $events));
    }

    public function testLiveBeatsAnotherEventsTeaserOrRecap(): void
    {
        $events = [
            self::halloween(['id' => 'a', 'start' => '2026-12-01', 'end' => '2026-12-03', 'teaserStart' => '2026-11-28']),
            self::halloween(['id' => 'b', 'start' => '2026-11-29', 'end' => '2026-11-30', 'teaserStart' => '']),
        ];
        $this->assertSame('b', SeasonalEvents::forViewer('2026-11-29', null, $events)['id']);
        $this->assertSame('a', SeasonalEvents::forViewer('2026-12-01', null, $events)['id']);
    }

    public function testCleanRejectsBadInput(): void
    {
        foreach ([['id' => 'Bad Id'], ['theme' => 'Hallo ween'], ['start' => '2026-13-01'],
                  ['end' => '2026-10-30'], ['teaserStart' => '2026-10-31']] as $bad) {
            try {
                self::halloween($bad);
                $this->fail('accepted ' . json_encode($bad));
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
        $this->assertSame('live', self::halloween(['previewPhase' => 'nope'])['previewPhase']);
    }

    public function testKillSwitchFeaturesAndStickerPack(): void
    {
        $e = self::halloween();
        $this->assertTrue($e['enabled']);
        $this->assertSame(array_fill_keys(SeasonalEvents::FEATURES, true), $e['features'], 'everything on by default');
        $live = SeasonalEvents::forViewer('2026-10-31', null, [$e]);
        $this->assertTrue($live['features']['stickers']);
        $this->assertSame([], $live['stickers']);

        $off = self::halloween(['enabled' => '0', 'previewUsers' => 'jacques']);
        $this->assertNull(SeasonalEvents::forViewer('2026-10-31', null, [$off]), 'the kill switch hides it');
        $this->assertNull(SeasonalEvents::forViewer('2026-10-26', ['username' => 'jacques'], [$off]), 'previews too');

        $some = self::halloween(['features' => ['skin' => '1', 'stickers' => '0', 'mapPins' => '0'],
                                 'stickers' => "pumpkin https://media.test/p.png\nbad http://x.test/a.png\nghost https://media.test/g.png"]);
        $this->assertFalse($some['features']['stickers']);
        $this->assertFalse($some['features']['mapPins']);
        $this->assertTrue($some['features']['ambient'], 'not posted: on');
        $this->assertSame([['id' => 'pumpkin', 'url' => 'https://media.test/p.png'], ['id' => 'ghost', 'url' => 'https://media.test/g.png']], $some['stickers']);
        $this->assertTrue(SeasonalEvents::features(['id' => 'old'])['shareFrame'], 'an event saved before event mode: all on');

        // A setting edited by hand (the pack as raw text, a bad URL): the apps still get clean {id, url} rows.
        $raw = ['id' => 'hw', 'theme' => 'halloween', 'start' => '2026-10-31', 'end' => '2026-10-31',
                'stickers' => "cat https://media.test/c.png\nbad ftp://x"];
        $this->assertSame([['id' => 'cat', 'url' => 'https://media.test/c.png']], SeasonalEvents::forViewer('2026-10-31', null, [$raw])['stickers']);
    }
}
