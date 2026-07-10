/**
 * buildRankShareMessage - builds the fun "share my rank" chat message + the
 * @mention list (so neighbours get a push) for the leaderboard Share CTA.
 *
 * Two variants, driven by scope:
 *   - user  (city / world): subject is ME; neighbours are @mentioned users.
 *   - city  (cities scope): subject is MY CITY; neighbours are other cities,
 *     NO @mentions (a city isn't a pushable user).
 *
 * Mention offsets are computed against the built string (indexOf the "@name"
 * token), so the localized templates can read naturally in any language.
 * Returns null when there isn't enough context (subject or the two required
 * neighbours missing from the loaded page) - the caller hides the CTA.
 */

import type { LeaderboardEntry, LeaderboardScope, LeaderboardPeriod } from '@/types';
import type { MentionInput } from '@/api/mentions';
import { countryToFlag } from '@/lib/countryFlag';

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

export interface RankShareResult { text: string; mentions: MentionInput[]; }

interface Args {
  scope:  LeaderboardScope;
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
  me?: { rank: number | null; points: number } | null | undefined;
  /** 'city_<int>' for locating my city's row in the cities scope. */
  myCityId?: string | null;
  /** Localized current-city name (city scope {place} + cities-scope subject). */
  placeCityName?: string | null;
  url: string;
  t: TFunc;
}

function pushMention(text: string, mentions: MentionInput[], name: string, userId: string | undefined, from: number): number {
  if (!userId || !name) return from;
  const token = '@' + name;
  const offset = text.indexOf(token, from);
  if (offset === -1) return from;
  mentions.push({ userId, offset, length: token.length });
  return offset + token.length;
}

export function buildRankShareMessage(args: Args): RankShareResult | null {
  const { scope, period, entries, me, myCityId, placeCityName, url, t } = args;
  const isCities = scope === 'cities';

  // The shared text is a CHAT message read by people of every language, so it's
  // always built in English (not the sharer's locale) - force lng:'en'.
  const tEn = (key: string, opts?: Record<string, unknown>) => t(key, { ...(opts ?? {}), lng: 'en' });

  // Subject row (my user row, or my city row for the cities scope).
  let subjectRank: number | null = null;
  let subjectPoints = 0;
  if (isCities) {
    const mine = entries.find(e =>
      (myCityId && e.city_id === myCityId) || (!!placeCityName && e.cityName === placeCityName));
    if (!mine || mine.rank == null) return null;
    subjectRank = mine.rank; subjectPoints = mine.points;
  } else {
    if (!me || me.rank == null) return null;
    subjectRank = me.rank; subjectPoints = me.points;
  }

  const byRank = (r: number) => entries.find(e => e.rank === r) ?? null;
  const label  = (e: LeaderboardEntry) => isCities
    ? `${countryToFlag(e.cityCountry ?? null) ?? ''} ${e.cityName ?? ''}`.trim()
    : (e.displayName ?? '');

  const periodStr = period === 'alltime'
    ? tEn('leaderboard.share.periodAll')
    : tEn('leaderboard.share.periodMonth');
  // {place} carries its own preposition (EN "in Saigon"/"in the World", FR
  // "à Saigon"/"dans le Monde") so the template stays preposition-free. The
  // cities variant uses the bare city name (it's the subject, not a locative).
  const place = isCities
    ? (placeCityName ?? '')
    : (scope === 'world'
        ? tEn('leaderboard.share.placeWorld')
        : tEn('leaderboard.share.placeCity', { city: placeCityName ?? '' }));

  const mentions: MentionInput[] = [];
  let text: string;

  if (subjectRank === 1) {
    const b1 = byRank(2), b2 = byRank(3);
    if (!b1 || !b2) return null;
    text = tEn(isCities ? 'leaderboard.share.cityTop' : 'leaderboard.share.userTop', {
      rank: subjectRank, pts: subjectPoints, place, period: periodStr,
      below1: label(b1), b1Pts: b1.points, below2: label(b2), b2Pts: b2.points,
    });
    if (!isCities) {
      let i = pushMention(text, mentions, label(b1), b1.user_id, 0);
      pushMention(text, mentions, label(b2), b2.user_id, i);
    }
  } else {
    const above = byRank(subjectRank - 1), below = byRank(subjectRank + 1);
    if (!above || !below) return null;
    text = tEn(isCities ? 'leaderboard.share.cityNotTop' : 'leaderboard.share.userNotTop', {
      rank: subjectRank, pts: subjectPoints, place, period: periodStr,
      above: label(above), aPts: above.points, below: label(below), bPts: below.points,
    });
    if (!isCities) {
      let i = pushMention(text, mentions, label(above), above.user_id, 0);
      pushMention(text, mentions, label(below), below.user_id, i);
    }
  }

  // URL appended last → mention offsets computed on `text` stay valid.
  return { text: `${text}\n${url}`, mentions };
}
