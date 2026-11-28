import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { ApiError } from '@/api/client';
import { sendWave, type WaveSource, type WaveState } from '@/api/members';
import { track } from '@/services/analytics';

/**
 * Wave 👋, the shared logic (Members rows, Here now badges, the inbox's "Wave
 * back"; ready for profiles, plan attendees and like lists): one state per
 * person for the whole app, so every button showing the same person agrees.
 */
const states = new Map<string, WaveState>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

/** What the server said about these people (a list, a refetch, the inbox): it wins. */
export function setWaveStates(map: Record<string, WaveState>) {
  let changed = false;
  for (const [id, st] of Object.entries(map)) {
    if (states.get(id) !== st) { states.set(id, st); changed = true; }
  }
  if (changed) emit();
}

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

/** One person's state: the store's, else `initial` (a caller's best guess until the server says). */
export function useWaveState(userId: string, initial: WaveState): WaveState {
  return useSyncExternalStore(subscribe, () => states.get(userId) ?? initial);
}

/**
 * The wave action for one person: state, busy, and wave(). A guest goes to
 * the sign-up gate; a wave that answers theirs suggests opening a chat.
 */
export function useWave(user: { id: string; displayName: string }, initial: WaveState, source: WaveSource) {
  const { t } = useTranslation('members');
  const router = useRouter();
  const { account } = useApp();
  const state = useWaveState(user.id, initial);
  const [busy, setBusy] = useState(false);

  const openChat = useCallback(() => {
    router.push({ pathname: '/dm/[id]', params: { id: user.id, name: user.displayName } } as never);
  }, [router, user.id, user.displayName]);

  const suggestChat = useCallback(() => {
    Alert.alert(t('wave.mutualTitle', { name: user.displayName }), t('wave.mutualBody'), [
      { text: t('wave.notNow'), style: 'cancel' },
      { text: t('wave.message'), onPress: openChat },
    ]);
  }, [t, user.displayName, openChat]);

  const wave = useCallback(async () => {
    if (!account) {
      router.push('/auth-gate?reason=wave' as never);
      return;
    }
    if (state === 'mutual') { suggestChat(); return; }
    if (state === 'sent' || busy) return;
    setBusy(true);
    const before = state;
    states.set(user.id, before === 'received' ? 'mutual' : 'sent'); emit();   // optimistic
    try {
      const r = await sendWave(user.id, source);
      states.set(user.id, r.state); emit();
      track('wave_sent', { source, back: r.back });
      if (r.back) {
        track('wave_returned', { source });
        suggestChat();
      }
    } catch (e) {
      const code = e instanceof ApiError ? String((e.body as { error?: string } | undefined)?.error ?? '') : '';
      if (code === 'already') { states.set(user.id, before === 'received' ? 'mutual' : 'sent'); emit(); return; }
      states.set(user.id, before); emit();
      Alert.alert(t(code === 'limit' ? 'wave.errLimit' : code === 'waves_off' ? 'wave.errOff' : 'wave.errGeneric', { name: user.displayName }));
    } finally {
      setBusy(false);
    }
  }, [account, router, state, busy, user.id, user.displayName, source, suggestChat, t]);

  return { state, busy, wave };
}

/** The button's label for a state. */
export function waveLabelKey(state: WaveState): string {
  return state === 'sent' ? 'wave.waved' : state === 'received' ? 'wave.waveBack' : state === 'mutual' ? 'wave.wavedBack' : 'wave.wave';
}

/** Keeps the store in step after a refetch (the list returns server states). */
export function useSeedWaves(rows: { id: string; wave: WaveState }[] | null | undefined) {
  useEffect(() => { if (rows?.length) setWaveStates(Object.fromEntries(rows.map(r => [r.id, r.wave]))); }, [rows]);
}
