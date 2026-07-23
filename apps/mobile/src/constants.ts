// ── Environment ───────────────────────────────────────────────────────────────

// In development, these come from .env (EXPO_PUBLIC_* prefix required).
// In production, set via EAS environment variables.
export const API_URL =
  (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080') + '/api/v1';

export const WS_URL =
  process.env.EXPO_PUBLIC_WS_URL ?? 'ws://localhost:8081';

export const BASE_URL =
  process.env.EXPO_PUBLIC_BASE_URL ?? 'https://hilads.live';

// ── Feature flags ─────────────────────────────────────────────────────────────
// Hangouts (topics) are re-enabled as the "Hi now" temporality in the Hi Local
// feed (spontaneous, ~8h TTL) alongside events ("Hi later").
export const HANGOUTS_ENABLED = true;

// ── Link builders ─────────────────────────────────────────────────────────────

import { eventSlug } from '@/lib/eventSlug';
import { challengeSlug } from '@/lib/challengeSlug';
import i18n, { SUPPORTED, DEFAULT_LOCALE } from '@/i18n';

// Active-locale prefix for shared links: '' for English (default), '/fr' | '/vi'
// otherwise - so a recipient lands on the localized (translated) page. The SSR
// layer renders /fr and /vi event pages in-language.
function sharePrefix(): string {
  const lang = i18n.language;
  return lang && lang !== DEFAULT_LOCALE && (SUPPORTED as readonly string[]).includes(lang) ? `/${lang}` : '';
}

/**
 * Build a shareable event URL. When `event` is the full object (with `title`),
 * emit the slug form `/event/<slug>-<hex>` - readable in chat threads, ranks
 * better. When only an ID is available, fall back to the short link `/e/<hex>`
 * which the prerender layer canonicalises via <link rel="canonical">.
 * Carries the active locale prefix so the recipient lands on the localized page.
 */
export function buildEventUrl(event: { id: string; title?: string } | string): string {
  const lp = sharePrefix();
  if (typeof event === 'string') return `${BASE_URL}${lp}/e/${event}`;
  return `${BASE_URL}${lp}/event/${eventSlug(event)}`;
}

/** Shareable city URL with the active-locale prefix so the recipient lands on
 *  the localized page (and the link preview's OG tags render in-language). */
export function buildCityUrl(slug: string): string {
  return `${BASE_URL}${sharePrefix()}/city/${slug}`;
}

/**
 * Build a shareable challenge URL. Mirrors buildEventUrl: prefer the slug
 * form when a title is available (readable + SEO), fall back to bare hex
 * when only an ID is known. Active-locale prefix carried so the recipient
 * lands on the localized SSR page.
 */
export function buildChallengeUrl(challenge: { id: string; title?: string } | string): string {
  const lp = sharePrefix();
  if (typeof challenge === 'string') return `${BASE_URL}${lp}/challenge/${challenge}`;
  return `${BASE_URL}${lp}/challenge/${challengeSlug(challenge)}`;
}

/**
 * Shareable leaderboard URL carrying the current filter. Tapping it (in a feed
 * link card) re-opens the leaderboard on the same scope + period.
 */
export function buildLeaderboardUrl(scope: string, period: string): string {
  // No locale prefix: the shared message is English-only and the leaderboard is
  // an in-app overlay (not an SSR page), so the prefix would be dead weight.
  return `${BASE_URL}/leaderboard?scope=${encodeURIComponent(scope)}&period=${encodeURIComponent(period)}`;
}

// ── Env diagnostics - unconditional, fires in both dev and production APK ─────
console.log('[env] EXPO_PUBLIC_API_URL =', process.env.EXPO_PUBLIC_API_URL ?? '(undefined - will use localhost fallback!)');
console.log('[env] API_URL (resolved)  =', API_URL);
console.log('[env] WS_URL              =', WS_URL);
if (!process.env.EXPO_PUBLIC_API_URL) {
  console.error('[env] CRITICAL: EXPO_PUBLIC_API_URL is not set - all API calls will fail on device!');
}

export const APP_VERSION = '1.0.0';
export const IS_DEV = __DEV__;

// ── Design tokens - aligned with web app ──────────────────────────────────────
// Web source: apps/web/src/index.css CSS variables

export const Colors = {
  // Backgrounds - warm dark, not cold neutral
  bg:       '#0d0b09',   // web --bg
  bg2:      '#161210',   // web --surface
  bg3:      '#1e1812',   // web --surface2
  border:   '#272018',   // web --border (warm brown)

  // Text - contrast targets on bg #0d0b09 (≈ pure black at L≈0):
  //   text     ~16.6:1   primary
  //   muted     ~5.5:1   secondary (still WCAG AA at all sizes)
  //   muted2    ~4.7:1   tertiary  (WCAG AA at normal sizes)
  //   mutedDim  ~2.4:1   reserved for visually-disabled affordances ONLY,
  //                      e.g. inactive button labels, dot pagers. NEVER on
  //                      visible body or secondary text. Apple Guideline 4
  //                      cited the prior #635650 (this value) as unreadable
  //                      when used for body / timestamps / sub-labels.
  text:     '#ede9e5',   // web --text   (warm off-white)
  muted:    '#968880',   // web --muted2 (visible secondary)
  muted2:   '#8a7d75',   // tertiary - bumped from #635650 for WCAG AA on dark bg
  mutedDim: '#635650',   // disabled-only - opt-in, not a default. See note above.

  // Brand
  accent:   '#FF7A3C',   // web --hot-dot (energy orange - active states, FAB)
  accentDim:'rgba(255,122,60,0.15)',
  accent2:  '#C24A38',   // web --accent  (deep red-orange - CTA buttons)
  accent3:  '#B87228',   // web --accent2 (gradient end - CTA buttons)

  // Semantic
  green:    '#3ddc84',   // web --green  (online / live)
  red:      '#f87171',
  violet:   '#8B5CF6',   // web --profile-dot (member badge)
  white:    '#ffffff',

  // Bright orange used as TEXT (the `accent` above stays #FF7A3C for FILLS —
  // FAB / active). Mirrors web --hot-text. Same value on dark, deep on light.
  accentText: '#FF7A3C',

  // Overlay / structural tokens — the vocabulary the theme migration routes the
  // ~256 hardcoded rgba(255,255,255,.x) literals through (dark values here).
  separator:     'rgba(255,255,255,0.08)',
  overlayWeak:   'rgba(255,255,255,0.04)',
  overlay:       'rgba(255,255,255,0.07)',
  overlayStrong: 'rgba(255,255,255,0.12)',
  scrim:         'rgba(0,0,0,0.6)',
  elevated:      '#1e1812',
  inputBg:       '#0d0b09',
} as const;

// A theme is the full color set; both palettes share these keys.
export type ThemeColors = Record<keyof typeof Colors, string>;

// ── Light palette (daylight) — same keys as Colors, light values. The
// ThemeContext swaps between the two; migrated screens read from context. ──────
export const LightColors: ThemeColors = {
  bg:       '#FBF6F0',   // warm cream ground
  bg2:      '#FFFFFF',   // surface / cards
  bg3:      '#F3EAE0',   // sand inset
  border:   '#EADDD0',   // warm hairline
  text:     '#241A12',   // warm near-black
  muted:    '#6E5D4E',   // secondary (AA on cream)
  muted2:   '#6E5D4E',   // tertiary
  mutedDim: '#9A8877',   // disabled-only
  accent:   '#FF7A3C',   // FILL / FAB / active — brand energy (never text on white)
  accentDim:'rgba(255,122,60,0.15)',
  accent2:  '#C24A38',   // deep CTA orange
  accent3:  '#B87228',
  green:    '#17864C',   // darkened so it reads as text/dots on white
  red:      '#C0264A',
  violet:   '#7C4DE0',
  white:    '#ffffff',
  accentText: '#C24A38', // readable deep orange as text on cream
  separator:     '#EADDD0',
  overlayWeak:   'rgba(28,20,14,0.03)',
  overlay:       'rgba(28,20,14,0.05)',
  overlayStrong: 'rgba(28,20,14,0.08)',
  scrim:         'rgba(28,20,14,0.35)',
  elevated:      '#FFFFFF',
  inputBg:       '#FFFFFF',
};

export type ThemeName = 'light' | 'dark';
export const Themes: Record<ThemeName, ThemeColors> = { dark: Colors, light: LightColors };

// Type scale floor: nothing rendered as visible body / secondary text may go
// below `xs` (13pt). `tiny` (11pt) is reserved for badge content (notification
// count pips, status dots) where the text sits inside a coloured shape and is
// glyph-like, not informational. Apple Guideline 4 cited the prior 11/12pt
// secondary text as too small to read on iPad and iPhone 17 Pro Max.
// NOTE: these are the RAW reference sizes (authored for a large phone, ~448dp).
// Global proportional down-scaling for narrower phones is applied ONCE in
// src/scaling.ts, which patches StyleSheet.create so EVERY style - these
// constants AND the app's many hard-coded fontSizes - shrinks uniformly. Do not
// pre-scale here or it would double-scale.
export const FontSizes = {
  tiny: 11,  // badges + count pips ONLY (not visible body text)
  xs:   13,
  sm:   14,
  md:   17,
  lg:   20,
  xl:   24,
  xxl:  32,
  hero: 40,  // city name hero, large screen titles
} as const;

export const Radius = {
  sm:   6,
  md:   10,
  lg:   18,   // bumped to match web 18px card radius
  full: 999,
} as const;

export const Spacing = {
  xs:   5,
  sm:   9,
  md:   18,
  lg:   27,
  xl:   36,
  xxl:  54,
} as const;

// ── Gradients - direct port of web index.css linear-gradients ────────────────
// 135° on web ≈ start (0,0) → end (1,1) on RN's LinearGradient.
// Web sources (single source of truth):
//   .ob-btn / .cef-submit / .modal-submit / .send-btn:
//     linear-gradient(135deg, var(--accent), var(--accent2))   = #C24A38 → #B87228
//   .vibe-btn / .dm-vibe-btn:
//     linear-gradient(135deg, #C24A38 0%, #B87228 100%)        = same stops, louder glow
//   DeleteAccountPage .logoMark:
//     linear-gradient(135deg, #FF7A3C, #C24A38)                = brighter start for the logo
//   .bottom-nav-tab.active::after:
//     linear-gradient(180deg, rgba(255,122,60,0.16), rgba(255,122,60,0.06))

export const Gradients = {
  primary: {
    colors: ['#C24A38', '#B87228'] as [string, string],
    start:  { x: 0, y: 0 },
    end:    { x: 1, y: 1 },
  },
  // Disabled state - muted gray pair at 0.55 opacity matches web
  // .cef-submit:disabled (opacity 0.5, no shadow).
  primaryDisabled: {
    colors: ['#5b524c', '#4a423d'] as [string, string],
    start:  { x: 0, y: 0 },
    end:    { x: 1, y: 1 },
  },
  logo: {
    colors: ['#FF7A3C', '#C24A38'] as [string, string],
    start:  { x: 0, y: 0 },
    end:    { x: 1, y: 1 },
  },
  activePill: {
    colors: ['rgba(255,122,60,0.16)', 'rgba(255,122,60,0.06)'] as [string, string],
    start:  { x: 0, y: 0 },
    end:    { x: 0, y: 1 },
  },
} as const;

// ── Shadows - colored CTA glow (iOS native, faux on Android) ─────────────────
// Web sources:
//   .cef-submit / .ob-btn / .modal-submit:  0 4–6px 18–20px rgba(194,74,56,0.25–0.32)
//   .vibe-btn / .dm-vibe-btn:               0 0 16px rgba(194,74,56,0.42) + 0 4px 14px rgba(0,0,0,0.35)

export const Shadows = {
  primaryCta: {
    shadowColor:   '#C24A38',
    shadowOpacity: 0.25,
    shadowRadius:  20,
    shadowOffset:  { width: 0, height: 4 },
    elevation:     6,
  },
  fab: {
    shadowColor:   '#C24A38',
    shadowOpacity: 0.42,
    shadowRadius:  16,
    shadowOffset:  { width: 0, height: 4 },
    elevation:     10,
  },
} as const;
