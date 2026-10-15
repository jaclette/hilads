import type { DailyToday } from '@/types';

/** Common PostHog properties on every daily_* event (SPEC section 5). */
export function dailyTrackProps(today: Pick<DailyToday, 'challenge' | 'city' | 'myProof'> | null, accountMode?: string | null) {
  return {
    challenge_date: today?.challenge?.date ?? null,
    city:           today?.city?.name ?? null,
    is_local:       today?.myProof ? today.myProof.isLocal : accountMode === 'local',
  };
}
