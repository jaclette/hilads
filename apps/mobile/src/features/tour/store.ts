import { useSyncExternalStore } from 'react';
import type { DailyTour } from '@/types';

// The last tour loaded by Today's row: the story viewer opens on it at once, and
// the empty mosaic (TodayCountries) follows it as the row reloads it.
let last: DailyTour | null = null;
const listeners = new Set<() => void>();

export const rememberTour = (t: DailyTour | null) => { last = t; listeners.forEach(l => l()); };
export const lastTour = (): DailyTour | null => last;

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/** The last tour, re-rendering when a newer one is remembered. */
export const useLastTour = (): DailyTour | null => useSyncExternalStore(subscribe, lastTour);
