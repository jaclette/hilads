import type { DailyTour } from '@/types';

// The last tour loaded by Today's row: the story viewer opens on it at once.
let last: DailyTour | null = null;

export const rememberTour = (t: DailyTour | null) => { last = t; };
export const lastTour = (): DailyTour | null => last;
