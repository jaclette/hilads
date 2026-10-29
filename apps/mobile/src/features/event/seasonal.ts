import { useEffect, useState } from 'react';
import { Colors, type ThemeColors } from '@/constants';
import type { EventFeature, SeasonalEvent } from '@/types';

/**
 * Seasonal events (Admin › Daily › Seasonal events): the server says which
 * event is on today's challenge date and its phase (GET /daily/today `event`);
 * the look lives here, by theme key. An unknown key, no event or an error =
 * the normal look, so the back office can schedule any event whose theme
 * shipped in this build.
 *
 * - teaser: the countdown banner under Today's hero, the event's day in the week strip
 * - live: the palette on the Daily screens (SeasonalScope), the hero's
 *   decorations, copy overrides, tile badges, the logo's hat, the post burst
 * - recap (the day after): a touch on the Yesterday card
 */

/** Copy slots a theme overrides: i18n keys in the daily namespace. */
export interface SeasonalCopy {
  /** The countdown banner (count = days left). */
  teaser:     string;
  /** The hero's play button, with {{city}} / without a city. */
  cta:        string;
  ctaNoCity:  string;
  /** "{{count}} countries played today". */
  played:     string;
  /** "Represent your city". */
  represent:  string;
}

export interface SeasonalTheme {
  /** The Daily screens' colors while live (both app themes), and their mode. */
  colors: ThemeColors;
  mode:   'dark' | 'light';
  copy:   SeasonalCopy;
  /** The emoji of the tile badge and the Yesterday card's touch. */
  emoji:  string;
}

/**
 * Halloween: deep night purple grounds, pumpkin orange accents, the same in
 * light and dark mode. Every text pair is WCAG AA (measured: text 14.6:1 on a
 * card, muted 7.6:1, links 8.3:1, white on the primary 4.7:1, ink on the CTA
 * 7.7:1).
 */
const HALLOWEEN_COLORS: ThemeColors = {
  ...Colors,
  bg:            '#1A1030',
  bg2:           '#251842',
  bg3:           '#2E2050',
  border:        '#3D2A64',
  text:          '#F6F0FF',
  muted:         '#C3B5DE',
  muted2:        '#C3B5DE',
  mutedDim:      '#8E80AD',
  accent:        '#FF8A1F',
  accentDim:     'rgba(255,138,31,0.16)',
  accent2:       '#FF8A1F',
  accent3:       '#FFA552',
  accentText:    '#FFA552',
  separator:     'rgba(255,255,255,0.10)',
  elevated:      '#2A1C4A',
  inputBg:       '#140C26',
  primary:       '#C2510A',
  primaryText:   '#FFA552',
  primaryTint:   '#4A2A3A',
  primaryOnTint: '#FFC48A',
  cta:           '#FF8A1F',
  onCta:         '#1A1030',
  stepBg:        '#2A1C4A',
  line:          '#3D2A64',
  ticketLine:    '#5A3E85',
  goldTint:      '#3A2E40',
};

export const SEASONAL_THEMES: Record<string, SeasonalTheme> = {
  halloween: {
    colors: HALLOWEEN_COLORS,
    mode:   'dark',
    emoji:  '🎃',
    copy: {
      teaser:    'event.halloween.teaser',
      cta:       'event.halloween.cta',
      ctaNoCity: 'event.halloween.ctaNoCity',
      played:    'event.halloween.played',
      represent: 'event.halloween.represent',
    },
  },
};

export interface ActiveSeasonal {
  event: SeasonalEvent;
  theme: SeasonalTheme;
  /** The theme key (decorations pick their art by it). */
  key:   string;
}

// Today's last answer: every Daily screen reads it (like useHere).
let current: ActiveSeasonal | null = null;
const listeners = new Set<() => void>();

// Dev builds only (Debug screen): a forced phase, to see a theme before its dates.
let devForced: SeasonalEvent | null = null;
let fromServer: SeasonalEvent | null | undefined = null;

/** Dev builds: force a theme's phase (null = back to the server's event). Release builds ignore it. */
export function setSeasonalPreview(theme: string | null, phase: SeasonalEvent['phase'] = 'live'): void {
  if (!__DEV__) return;
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const start = phase === 'teaser' ? day(2) : phase === 'recap' ? day(-1) : day(0);
  devForced = theme ? { id: `dev-${theme}`, theme, phase, start, end: start, startsInDays: phase === 'teaser' ? 2 : null, preview: true } : null;
  setSeasonalEvent(fromServer);
}

/** Today's fetch: the event of the day, kept only when this build knows its theme. */
export function setSeasonalEvent(event: SeasonalEvent | null | undefined): void {
  fromServer = event;
  if (devForced) event = devForced;
  const theme = event ? SEASONAL_THEMES[event.theme] : undefined;
  const next = event && theme ? { event, theme, key: event.theme } : null;
  if (next?.event.id === current?.event.id && next?.event.phase === current?.event.phase
      && next?.event.startsInDays === current?.event.startsInDays
      && JSON.stringify(next?.event.features ?? null) === JSON.stringify(current?.event.features ?? null)
      && JSON.stringify(next?.event.stickers ?? null) === JSON.stringify(current?.event.stickers ?? null)) return;
  current = next;
  listeners.forEach(l => l());
}

function useCurrent(): ActiveSeasonal | null {
  const [value, setValue] = useState(current);
  useEffect(() => {
    const l = () => setValue(current);
    listeners.add(l);
    l();
    return () => { listeners.delete(l); };
  }, []);
  return value;
}

/** A switch of the event (absent on an older server: on). */
const featureOn = (s: ActiveSeasonal | null, f: EventFeature) => !!s && s.event.features?.[f] !== false;

/**
 * The event on today's challenge date with a known theme, else null: its look
 * (palette, decorations, teaser, copy). Null when the event's skin is off.
 */
export function useSeasonal(): ActiveSeasonal | null {
  const value = useCurrent();
  return featureOn(value, 'skin') ? value : null;
}

/**
 * Event mode: the live event when one of its features is on (stickers, the
 * stamp, the share frame, map pins, chat chips, ambient bats), else null.
 * Independent of the skin switch.
 */
export function useEventFeature(feature: EventFeature): ActiveSeasonal | null {
  const value = useCurrent();
  return value?.event.phase === 'live' && featureOn(value, feature) ? value : null;
}

/** Outside React (a photo's share card): is this feature of the live event on? */
export function eventFeatureNow(feature: EventFeature): ActiveSeasonal | null {
  return current?.event.phase === 'live' && featureOn(current, feature) ? current : null;
}

/** The live phase's theme, else null (the palette, decorations, copy). */
export function useSeasonalLive(): ActiveSeasonal | null {
  const s = useSeasonal();
  return s?.event.phase === 'live' ? s : null;
}

/** A date (YYYY-MM-DD) is one of the event's days (the week strip's icon). */
export function isEventDay(s: ActiveSeasonal | null, date: string | null | undefined): boolean {
  return !!s && !!date && date >= s.event.start && date <= s.event.end;
}
