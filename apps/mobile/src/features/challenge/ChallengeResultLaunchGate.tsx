import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import { fetchChallengeReveals, type ChallengeReveal } from '@/api/challenges';
import { markNotificationsRead } from '@/api/notifications';
import { ChallengeResultModal } from './ChallengeResultModal';

/**
 * Auto-open the GROUP challenge result reveal (winning photo / present / absent +
 * the viewer's points) when a challenge they're in resolves.
 *
 * Mounted globally in app/_layout.tsx ABOVE ScoreCelebrationLaunchGate. Distinct
 * from that gate: the data source is the UNREAD challenge_group_result_*
 * notifications (so it reaches LOSERS / ABSENTEES who earned no score delta), the
 * ack is mark-read of the notification id (not a watermark), and the modal shows
 * role-specific, never-negative copy + the winning photo.
 *
 * Trigger: cold-start fetch, the per-user `challenge_accepted` WS ping the resolve
 * routes fan out to every participant, and app foreground. Reveals are shown one
 * at a time (queued); each is mark-read on close so it never re-shows.
 */
export function ChallengeResultLaunchGate() {
  const { account } = useApp();
  const [queue,   setQueue]   = useState<ChallengeReveal[]>([]);
  const current = queue[0] ?? null;
  const loading = useRef(false);

  const refetch = useCallback(async () => {
    if (!account?.id || loading.current) return;
    loading.current = true;
    try {
      const reveals = await fetchChallengeReveals();
      if (reveals.length === 0) return;
      // Merge, de-duped by notification id, preserving anything already queued.
      setQueue((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        const fresh = reveals.filter((r) => !seen.has(r.id));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    } finally {
      loading.current = false;
    }
  }, [account?.id]);

  // Cold-start.
  useEffect(() => { void refetch(); }, [refetch]);

  // Live: every resolve route pings each participant with `challenge_accepted`.
  useEffect(() => {
    if (!account?.id) return;
    const off = socket.on('challenge_accepted', () => { void refetch(); });
    return () => { off(); };
  }, [account?.id, refetch]);

  // Foreground: an absentee who backgrounded the app sees it on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void refetch(); });
    return () => { sub.remove(); };
  }, [refetch]);

  const handleClose = useCallback(() => {
    if (current) void markNotificationsRead([current.id]);
    setQueue((prev) => prev.slice(1));
  }, [current]);

  // Tap a rank row → ack + close, then open the leaderboard ("most locals")
  // pre-scoped to that lens (city default / world via the query param).
  const handleOpenLeaderboard = useCallback((scope: 'city' | 'world') => {
    handleClose();
    router.push(scope === 'world'
      ? { pathname: '/leaderboard', params: { scope: 'world' } }
      : { pathname: '/leaderboard' });
  }, [handleClose]);

  return (
    <ChallengeResultModal
      reveal={current}
      visible={current !== null}
      onClose={handleClose}
      onOpenLeaderboard={handleOpenLeaderboard}
    />
  );
}
