import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '@/i18n';
import { useApp } from '@/context/AppContext';
import { requestAndRegisterPush, hasPushPermission } from '@/services/push';
import { track } from '@/services/analytics';
import { notifyContest, type ContestMeNotJoined, type ContestOverview } from './contest';
import { setContestOverview } from './useContestTab';

/**
 * "Notify me when it starts" (before the campaign starts), for members AND people without an
 * account: asks for push permission (the device's token is registered for the account, or the
 * guest), then POST /contest/notify (member: by account; guest: by guestId). One push when the race
 * starts (ContestNotify). A guest's tap is kept on the device (the server can't tell them apart).
 */
const KEY = 'trip_guest_notified';
let guestDone: number | null = null;
const subs = new Set<() => void>();
AsyncStorage.getItem(KEY).then(v => { guestDone = v ? Number(v) : null; subs.forEach(f => f()); }).catch(() => {});

export function useTripNotify(data: ContestOverview | null, onDone?: (d: ContestOverview) => void) {
  const { account, identity } = useApp();
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(n => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const s = data?.season ?? null;
  const me = data?.me ?? null;
  const notified = !!s && (me?.joined === true || !!(me && (me as ContestMeNotJoined).notified) || (!account && guestDone === s.id));
  const notify = async () => {
    if (!s || notified || busy) return;
    const guestId = account ? null : identity?.guestId ?? null;
    setBusy(true);
    try {
      await requestAndRegisterPush(guestId, { prompt: true }).catch(() => null);
      const res = await notifyContest(s.id, i18n.language, guestId);
      if (account) { setContestOverview(res); onDone?.(res); }
      else { guestDone = s.id; AsyncStorage.setItem(KEY, String(s.id)).catch(() => {}); subs.forEach(f => f()); }
      track('trip_notify', { guest: !account, push: await hasPushPermission() });
    } catch { /* stays tappable */ } finally { setBusy(false); }
  };
  return { notified, busy, notify };
}
