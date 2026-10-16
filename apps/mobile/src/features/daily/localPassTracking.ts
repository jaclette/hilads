import AsyncStorage from '@react-native-async-storage/async-storage';
import { track } from '@/services/analytics';
import type { DailyLocalPassProgress } from '@/types';

// daily_local_pass_earned fires once per viewer and city, the first time the
// app sees an earned pass (the pass is earned at a proof's approval, server-side).

const KEY = 'daily_local_pass_tracked_v1';
const seen = new Set<string>();

export async function trackLocalPassEarned(progress: DailyLocalPassProgress | null | undefined, viewerId: string | null | undefined) {
  if (!progress?.earned || !viewerId) return;
  const id = `${viewerId}:${progress.city.id}`;
  if (seen.has(id)) return;
  seen.add(id);
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const done: string[] = raw ? JSON.parse(raw) : [];
    if (done.includes(id)) return;
    track('daily_local_pass_earned', { city: progress.city.name ?? null, earned_at: progress.earnedAt ?? null });
    await AsyncStorage.setItem(KEY, JSON.stringify([...done, id].slice(-100)));
  } catch {
    // Storage errors only risk a duplicate event later.
  }
}
