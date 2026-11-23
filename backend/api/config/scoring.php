<?php

declare(strict_types=1);

/**
 * Scoring v2, "Play, Win, Invite" + monthly seasons (docs/scoring-v2-audit.md).
 * The ONE place for every point value and scoring setting: the apps never
 * hardcode a value, they read GET /daily/points. Read through Scoring::config().
 *
 * Changing a value here changes future awards only; past score_events rows keep
 * the points they were given.
 */
return [
    // Points per kind (score_events.kind).
    'points' => [
        'daily_proof'   => 10,  // 📸 played the Daily Challenge (approved photo, once a day)
        'daily_top1'    => 30,  // 🥇 World podium of the day (most likes, tie → posted first)
        'daily_top2'    => 20,  // 🥈
        'daily_top3'    => 10,  // 🥉
        'perfect_week'  => 30,  // 🔥 all the published challenges of a Mon–Sun week
        'friend_joined' => 10,  // 🤝 an invited friend's first approved photo
        'crew_bonus'    => 50,  // 🎉 the crew_size-th friend of a season, once per season
    ],

    // The kinds a season ranking adds up (by challenge date). Votes are not in it.
    'season_kinds' => ['daily_proof', 'daily_top1', 'daily_top2', 'daily_top3', 'perfect_week', 'friend_joined', 'crew_bonus'],

    // The first real season ('YYYY-MM'); months before it are a "pre-season" (no medals).
    'first_season' => '2026-12',

    // The first challenge date under v2 (no vote points from its close on). Null here:
    // P1's migration stores the challenge date of the day it runs in app_settings.
    'switch_date' => null,

    // Invitations.
    'invites_per_season' => 5,   // friend_joined credits per inviter per season
    'crew_size'          => 5,   // the friend that triggers crew_bonus
    'invite_click_ttl_h' => 24,  // same-IP fallback: a link click this recent counts for a signup

    // Notifications.
    'season_ending_days' => 3,   // "Season ends in 3 days" push

    // The podium needs at least this many likes (DailyResults::MIN_VOTES_TO_WIN).
    'min_votes_to_win' => 1,

    // Fair-play switches, both OFF by default. Admin › Scoring will override them (app_settings).
    'switches' => [
        'podium_min_photos'  => 0,      // N > 0: a day with fewer than N photos worldwide pays only 🥇
        'vote_requires_play' => false,  // true: only players who posted today's photo can like today's photos
    ],
];
