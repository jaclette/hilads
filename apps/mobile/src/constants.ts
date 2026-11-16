// ── Environment ───────────────────────────────────────────────────────────────

// In development, these come from .env (EXPO_PUBLIC_* prefix required).
// In production, set via EAS environment variables.
import { eventSlug } from '@/lib/eventSlug';
import { challengeSlug } from '@/lib/challengeSlug';
import i18n, { SUPPORTED, DEFAULT_LOCALE } from '@/i18n';

export const API_URL =
  (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080') + '/api/v1';

export const WS_URL =
  process.env.EXPO_PUBLIC_WS_URL ?? 'ws://localhost:8081';

export const BASE_URL =
  process.env.EXPO_PUBLIC_BASE_URL ?? 'https://hilads.live';

// ── Link builders ─────────────────────────────────────────────────────────────

// Active-locale prefix for shared links: '' for English (default), '/fr' | '/vi'
// otherwise - so a recipient lands on the localized (translated) page. The SSR
// layer renders /fr and /vi event pages in-language.
export function sharePrefix(): string {
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

// ── Env diagnostics - unconditional, fires in both dev and production APK ─────
console.log('[env] EXPO_PUBLIC_API_URL =', process.env.EXPO_PUBLIC_API_URL ?? '(undefined - will use localhost fallback!)');
console.log('[env] API_URL (resolved)  =', API_URL);
console.log('[env] WS_URL              =', WS_URL);
if (!process.env.EXPO_PUBLIC_API_URL) {
  console.error('[env] CRITICAL: EXPO_PUBLIC_API_URL is not set - all API calls will fail on device!');
}

export const APP_VERSION = '1.0.0';

// ── Design tokens - aligned with web app ──────────────────────────────────────
// Web source: apps/web/src/index.css CSS variables

export const Colors = {
  // Backgrounds - warm dark, not cold neutral
  bg:       '#0d0b09',   // web --bg
  bg2:      '#161210',   // web --surface
  bg3:      '#1e1812',   // web --surface2

  // Text - contrast targets on bg #0d0b09 (≈ pure black at L≈0):
  //   text     ~16.6:1   primary
  //   muted     ~5.5:1   secondary (still WCAG AA at all sizes)
  //   mutedDim  ~2.4:1   reserved for visually-disabled affordances ONLY,
  //                      e.g. inactive button labels, dot pagers. NEVER on
  //                      visible body or secondary text. Apple Guideline 4
  //                      cited the prior #635650 (this value) as unreadable
  //                      when used for body / timestamps / sub-labels.
  text:     '#ede9e5',   // web --text   (warm off-white)
  muted:    '#968880',   // web --muted2 (visible secondary)
  mutedDim: '#635650',   // disabled-only - opt-in, not a default. See note above.

  // Brand
  accent:   '#FF7A3C',   // web --hot-dot (energy orange - active states, FAB)

  // Semantic
  green:    '#3ddc84',   // web --green  (online / live)
  red:      '#f87171',
  warning:  '#F5A524',   // amber - time running out (Daily countdown, last 3h)
  white:    '#ffffff',

  // Bright orange used as TEXT (the `accent` above stays #FF7A3C for FILLS —
  // FAB / active). Mirrors web --hot-text. Same value on dark, deep on light.
  accentText: '#FF7A3C',

  // Overlay / structural tokens — the vocabulary the theme migration routes the
  // ~256 hardcoded rgba(255,255,255,.x) literals through (dark values here).
  separator:     'rgba(255,255,255,0.08)',
  overlay:       'rgba(255,255,255,0.07)',
  scrim:         'rgba(0,0,0,0.6)',
  elevated:      '#1e1812',

  // V3 tokens (SPEC 9.11; dark values derived from this palette).
  primary:       '#D9622A',   // buttons, pins, active (white text on it)
  primaryText:   '#FF8A50',   // primary as text / links on the dark ground
  primaryTint:   '#3A2216',   // chip / active tab ground
  primaryOnTint: '#FFB48A',   // text on primaryTint
  // The joyful primary action (DESIGN.md): tangerine with ink text, same in both themes (7.6:1).
  cta:           '#FF7A3D',
  onCta:         '#2A1C13',
  // The peach highlight (key words, the Taste pill): same in both themes, see `Highlight`.
  highlightBg:   '#FFD2C2',
  stepBg:        '#1e1812',   // a soft block inside a card (Today's photo step): the sand inset, a shade off the card
  line:          '#272018',   // borders
  ticketLine:    '#4A3426',   // Daily Challenge ticket border + perforation
  flagLine:      'rgba(255, 255, 255, 0.28)', // hairline around a city flag (white flags stay visible)
  caramel:       '#C98A45',   // own messages, plan pins
  localBg:       '#12301F',   // "validated by a local" badge
  localText:     '#7FD9A4',
  travelerBg:    '#17263A',   // Traveler label
  travelerText:  '#9DBDF0',
  gold:          '#D9AE52',   // Local Pass seal
  silver:        '#B4BDC7',   // yesterday's podium #2
  bronze:        '#C98B5C',   // yesterday's podium #3
  goldTint:      '#3A2E14',   // gold-tinted ground (podium, crown badges)
  onGold:        '#1A1206',   // text on a gold fill (both themes)
  // Fixed, theme-independent: text on the caramel own-bubble, and the black
  // photo viewer / camera with its translucent controls.
  onCaramelMuted: 'rgba(255,255,255,0.78)',
  photoScrim:     'rgba(0,0,0,0.94)',
  // Fills and lines over a photo / the photo viewer's dark ground (same in both themes).
  onPhotoFill:    'rgba(255,255,255,0.12)',
  onPhotoLine:    'rgba(255,255,255,0.22)',
  // Darkens the blurred copy of a photo that fills the viewer around it.
  photoBlurShade: 'rgba(0,0,0,0.55)',
  photoControl:   'rgba(255,255,255,0.16)',
  // A round button over a photo or the camera: a dark disc, visible on bright photos too.
  photoButton:    'rgba(0,0,0,0.42)',
  photoPill:      'rgba(0,0,0,0.62)',          // a count on a photo: readable on bright pictures
  // The map sheet's orange wave (peek header): brand orange on the crest, terracotta under the
  // text (white 4.9:1+, the 88% subtitle 4.6:1+), a deeper end; the count / chevron ink on white.
  peekTop:        '#D9622A',
  peekMid:        '#A8401A',
  peekBottom:     '#8A3412',
  peekInk:        '#A8401A',
  onPeek:         '#FFFFFF',
  onPeekMuted:    'rgba(255,255,255,0.88)',
  peekShadow:     'rgba(0,0,0,0.30)',
} as const;

// A theme is the full color set; both palettes share these keys.
/**
 * The peach highlight (DESIGN.md): the block behind a highlighted key word and
 * the Taste theme's pill. Dark brown-orange text on peach, 5.9:1 (WCAG AA); the
 * same in both themes (a fill, 12.8:1 against the dark card). Theme-independent
 * code (src/ui/joy.tsx) reads it here; themed styles use colors.highlightBg/Text.
 */
export const Highlight = { bg: '#FFD2C2', text: '#8A3418' } as const;

export type ThemeColors = Record<keyof typeof Colors, string>;

// ── Light palette (daylight) — same keys as Colors, light values. The
// ThemeContext swaps between the two; migrated screens read from context. ──────
export const LightColors: ThemeColors = {
  bg:       '#FBF5EE',   // ground (SPEC 9.11)
  bg2:      '#FFFFFF',   // card / surface
  bg3:      '#F3EAE0',   // sand inset
  text:     '#2A1C13',   // ink (SPEC 9.11)
  muted:    '#6F5B4D',   // muted ink (SPEC 9.11)
  mutedDim: '#9A8877',   // disabled-only
  accent:   '#C9501A',   // primary (SPEC 9.11): white text on it passes 4.5:1
  green:    '#17864C',   // darkened so it reads as text/dots on white
  red:      '#C0264A',
  warning:  '#B45309',   // amber, dark enough to read as text on cream
  white:    '#ffffff',
  accentText: '#C24A38', // readable deep orange as text on cream
  separator:     '#EADCCD',
  overlay:       'rgba(28,20,14,0.05)',
  scrim:         'rgba(28,20,14,0.35)',
  elevated:      '#FFFFFF',

  // V3 tokens (SPEC 9.11).
  primary:       '#C9501A',
  primaryText:   '#C9501A',
  primaryTint:   '#FFE6D8',
  primaryOnTint: '#8A3A12',
  cta:           '#FF7A3D',   // tangerine, ink text on it (6.4:1)
  onCta:         '#2A1C13',
  highlightBg:   '#FFD2C2',
  stepBg:        '#FBF5EE',   // the ground colour
  line:          '#EADCCD',
  ticketLine:    '#E8CDB8',
  flagLine:      'rgba(42, 28, 19, 0.22)',
  caramel:       '#9C5F22',
  localBg:       '#E3F0E8',
  localText:     '#23603F',
  travelerBg:    '#E4ECF7',
  travelerText:  '#2F5E9E',
  gold:          '#B98A2E',
  silver:        '#7E8A97',
  bronze:        '#A0643A',
  goldTint:      '#F6EBCF',
  onGold:        '#1A1206',
  // Fixed, theme-independent: text on the caramel own-bubble, and the black
  // photo viewer / camera with its translucent controls.
  onCaramelMuted: 'rgba(255,255,255,0.78)',
  photoScrim:     'rgba(0,0,0,0.94)',
  // Fills and lines over a photo / the photo viewer's dark ground (same in both themes).
  onPhotoFill:    'rgba(255,255,255,0.12)',
  onPhotoLine:    'rgba(255,255,255,0.22)',
  // Darkens the blurred copy of a photo that fills the viewer around it.
  photoBlurShade: 'rgba(0,0,0,0.55)',
  photoControl:   'rgba(255,255,255,0.16)',
  // A round button over a photo or the camera: a dark disc, visible on bright photos too.
  photoButton:    'rgba(0,0,0,0.42)',
  photoPill:      'rgba(0,0,0,0.62)',          // a count on a photo: readable on bright pictures
  peekTop:        '#F2783A',
  peekMid:        '#C24E1C',
  peekBottom:     '#A8401A',
  peekInk:        '#C24E1C',
  onPeek:         '#FFFFFF',
  onPeekMuted:    'rgba(255,255,255,0.88)',
  peekShadow:     'rgba(42,28,19,0.12)',
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
  body: 15,  // running text in cards and rows (between sm and md)
  md:   17,
  lg:   20,
  xl:   24,
  title: 26, // a tab's / screen's large title (ScreenHeader tab)
  xxl:  32,
  hero: 40,  // city name hero, large screen titles
} as const;

export const Radius = {
  sm:     6,
  md:     10,
  lg:     18,   // bumped to match web 18px card radius
  full:   999,
  // V3 (SPEC 9.11): cards 18-22, buttons 16, chips full.
  button: 16,
  card:   18,
  ticket: 22,
  sheet:  22,
} as const;

/** V3 border width for cards, chips, inputs and round buttons. */
export const Border = 1.5;

export const Spacing = {
  xs:   5,
  sm:   9,
  md:   18,
  lg:   27,
  xl:   36,
  xxl:  54,
} as const;

/**
 * The spacing grid for padding, margins and gaps inside components (4-based). Spacing.md (18)
 * stays the screen gutter; the other Spacing steps remain for the layouts already built on them.
 */
export const Space = {
  xxs: 2,
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  24,
} as const;

