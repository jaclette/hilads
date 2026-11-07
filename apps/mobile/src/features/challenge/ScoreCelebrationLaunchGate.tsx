import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import { onDailyDropped } from '@/lib/dailyEvents';
import { onScoreCelebrationRequest, useCelebrationTurn } from '@/lib/celebrationQueue';
import { track } from '@/services/analytics';
import { ShareSheet } from '@/features/share/ShareSheet';
import { proofShare, type ShareContent } from '@/features/share/content';
import { shortCityName } from '@/i18n/cityName';
import i18n from '@/i18n';
import {
  ackScoreCelebration,
  fetchScoreCelebration,
  type ScoreCelebration,
  type ScoreWin,
  type ScoreWinMedal,
} from '@/api/challenges';
import { ScoreCelebrationModal, type RanksTarget } from './ScoreCelebrationModal';

const SEEN_KEY = (userId: string) => `hilads_score_win_seen_${userId}`;

/**
 * The points reward (the "+10" victory screen), app-wide (mounted in
 * app/_layout.tsx). It asks the server for unacknowledged points on launch, on
 * coming back to the app, after posting a photo, at the daily drop (the close's
 * awards) and on the older challenge pings.
 *
 * One celebration at a time (lib/celebrationQueue): it waits for its turn, for
 * no sheet or modal on screen, for the While you were away card to be read,
 * and for a tab (never over the photo flow or a viewer). The reward is
 * acknowledged when it opens (server watermark + a copy on the phone), so the
 * same reward never shows twice, even if the app is closed on it.
 */
export function ScoreCelebrationLaunchGate() {
  const router = useRouter();
  const segments = useSegments();
  const { account } = useApp();
  const [data, setData] = useState<ScoreCelebration | null>(null);
  const [share, setShare] = useState<ShareContent | null>(null);
  const loading = useRef(false);
  const userId = account?.id ?? null;

  const refetch = useCallback(async () => {
    if (!userId || loading.current) return;
    loading.current = true;
    try {
      const r = await fetchScoreCelebration();
      if (!(r.points > 0) || !r.seen_until) return;
      const seen = await AsyncStorage.getItem(SEEN_KEY(userId)).catch(() => null);
      if (seen && r.seen_until <= seen) return;   // already celebrated here (its ack may not have reached the server)
      setData(prev => prev ?? r);
    } finally {
      loading.current = false;
    }
  }, [userId]);

  useEffect(() => { if (!userId) setData(null); else void refetch(); }, [userId, refetch]);
  useEffect(() => {
    if (!userId) return;
    const offs = [
      onScoreCelebrationRequest(() => { setTimeout(() => void refetch(), 1500); }),
      onDailyDropped(() => { setTimeout(() => void refetch(), 4000); }),
      ...['mutual_rating_complete', 'challenge_date_approved', 'challenge_accepted', 'challenge_proof_approved', 'challenge_created_self', 'notification']
        .map(ev => socket.on(ev, () => { void refetch(); })),
    ];
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void refetch(); });
    return () => { offs.forEach(off => off()); sub.remove(); };
  }, [userId, refetch]);

  // Its turn: first in line, nothing else on screen, on a tab.
  const onTab = segments[0] === '(tabs)';
  const turn = useCelebrationTurn('score', data !== null, onTab);

  // Opened: acknowledged at once (server + phone), never shown again.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!turn || !data?.seen_until || !userId || opened.current === data.seen_until) return;
    opened.current = data.seen_until;
    void ackScoreCelebration(data.seen_until);
    AsyncStorage.setItem(SEEN_KEY(userId), data.seen_until).catch(() => {});
    track('score_win_shown', { points: data.points, period: data.win?.period ?? null, sources: data.win?.sources.map(s => s.source).join(',') ?? null });
  }, [turn, data, userId]);

  const close = useCallback(() => { setShare(null); setData(null); }, []);

  const openRanks = useCallback((to: RanksTarget) => {
    track('score_win_ranks', { tab: to.tab, scope: to.scope, period: to.period });
    close();
    router.push(`/ranks?tab=${to.tab}&period=${to.period}&scope=${to.scope}` as never);
  }, [close, router]);

  const openShare = useCallback((win: ScoreWin, medal: ScoreWinMedal | null) => {
    if (!win.proof || !win.challenge) return;
    track('score_win_share', { medal: medal?.key ?? null, rank: medal?.rank ?? null });
    const base = proofShare(win.proof, win.challenge);
    if (base.type !== 'proof') return;
    setShare({ ...base, rank: medal ? { rank: medal.rank, city: medal.key === 'world' ? null : medal.city?.name ?? null } : base.rank,
               rankText: medal ? winLine(medal, win.period) : null });
  }, []);

  return (
    <>
      <ScoreCelebrationModal data={data} visible={turn && data !== null} onClose={close} onOpenRanks={openRanks} onShare={openShare} />
      <ShareSheet content={share} source="score_win" onClose={() => setShare(null)} />
    </>
  );
}

/** "I'm #1 in Saigon today" (the share card's line). */
function winLine(m: ScoreWinMedal, period: ScoreWin['period']): string {
  const city = shortCityName(m.city?.name ?? '');
  const where = m.key === 'world' ? 'world' : m.key === 'cities' ? 'cities' : 'city';
  return i18n.t(`scoreWin.shareLine.${where}_${period}`, { ns: 'challenge', rank: m.rank, city });
}
