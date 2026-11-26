import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BASE_URL } from '@/constants';
import { useApp } from '@/context/AppContext';
import { fetchCrew } from '@/features/invites/invite';
import { ShareSheet } from '@/features/share/ShareSheet';
import type { ShareContent } from '@/features/share/content';
import { contestDate, type ContestMeJoined, type ContestOverview } from './contest';

/**
 * "Share" on the Launch Season: the share sheet with the contest card (the prize, my rank and
 * points or "I'm in", the deadline). The link is my invite link, so a friend who joins from it
 * counts for me (signed out: the plain /today link).
 */
export function useContestShare(data: ContestOverview | null) {
  const { t, i18n } = useTranslation('me');
  const { account } = useApp();
  const [content, setContent] = useState<ShareContent | null>(null);

  /** opts.boarding: the Boarding card (seats taken) instead of my rank card. */
  const open = async (opts?: { boarding?: boolean }) => {
    const s = data?.season;
    if (!s) return;
    let link = `${BASE_URL}/today`;
    if (account) {
      try { link = (await fetchCrew()).link; } catch { /* the plain link */ }
    }
    link += `${link.includes('?') ? '&' : '?'}utm_campaign=launch_season`;
    const joined = data?.me?.joined ? (data.me as ContestMeJoined) : null;
    const final = s.phase === 'final' || s.phase === 'over';
    const rank = (final ? joined?.finalRank : joined?.seasonRank) ?? null;
    const points = joined?.points ? (final ? joined.points.final : joined.points.season) : null;
    setContent({
      type: 'contest', photoUrl: s.photos?.[0]?.url ?? null, theme: null, city: null, link, isTest: s.isTest,
      text: s.prize?.title || s.name, subtitle: s.prize?.subtitle ?? '',
      when: s.phase === 'upcoming' ? t('contest.phase.upcoming', { date: contestDate(s.startDate, i18n.language) })
        : t('contest.endsOn', { date: contestDate(s.endDate, i18n.language) }),
      username: account?.username ?? null, rank, points,
      boarding: opts?.boarding && data?.counter
        ? { players: data.counter.players, threshold: data.counter.threshold, showCount: data.counter.players > 0 && data.counter.players >= (data.counter.showFrom ?? 0) }
        : null,
    });
  };

  const sheet = <ShareSheet content={content} source={content?.type === 'contest' && content.boarding ? 'trip_boarding' : 'launch_season'} onClose={() => setContent(null)} />;
  return { open, sheet };
}
