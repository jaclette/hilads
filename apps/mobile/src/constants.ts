// ── Environment ───────────────────────────────────────────────────────────────

// In development, these come from .env (EXPO_PUBLIC_* prefix required).
// In production, set via EAS environment variables.
export const API_URL =
  (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080') + '/api/v1';

export const WS_URL =
  process.env.EXPO_PUBLIC_WS_URL ?? 'ws://localhost:8081';

// ── Env diagnostics (dev only) ────────────────────────────────────────────────
if (__DEV__) {
  if (!process.env.EXPO_PUBLIC_API_URL) {
    console.warn('[env] ⚠️  EXPO_PUBLIC_API_URL is undefined — falling back to http://localhost:8080');
    console.warn('[env] ⚠️  On Android emulator this will fail. Set EXPO_PUBLIC_API_URL=http://10.0.2.2:8080 in .env.local');
  }
  console.log('[env] EXPO_PUBLIC_API_URL =', process.env.EXPO_PUBLIC_API_URL ?? '(undefined)');
  console.log('[env] API_URL (resolved)  =', API_URL);
  console.log('[env] WS_URL              =', WS_URL);
}

export const APP_VERSION = '1.0.0';
export const IS_DEV = __DEV__;

// ── Design tokens — aligned with web app ──────────────────────────────────────
// Web source: apps/web/src/index.css CSS variables

export const Colors = {
  // Backgrounds — warm dark, not cold neutral
  bg:       '#0d0b09',   // web --bg
  bg2:      '#161210',   // web --surface
  bg3:      '#1e1812',   // web --surface2
  border:   '#272018',   // web --border (warm brown)

  // Text
  text:     '#ede9e5',   // web --text  (warm off-white)
  muted:    '#968880',   // web --muted2 (visible secondary)
  muted2:   '#635650',   // web --muted  (dim / disabled)

  // Brand
  accent:   '#FF7A3C',   // web --hot-dot (energy orange — active states, FAB)
  accentDim:'rgba(255,122,60,0.15)',
  accent2:  '#C24A38',   // web --accent  (deep red-orange — CTA buttons)
  accent3:  '#B87228',   // web --accent2 (gradient end — CTA buttons)

  // Semantic
  green:    '#3ddc84',   // web --green  (online / live)
  red:      '#f87171',
  violet:   '#8B5CF6',   // web --profile-dot (member badge)
  white:    '#ffffff',
} as const;

export const FontSizes = {
  xs:   11,
  sm:   13,
  md:   15,
  lg:   18,
  xl:   22,
  xxl:  28,
  hero: 34,  // city name hero, large screen titles
} as const;

export const Radius = {
  sm:   6,
  md:   10,
  lg:   18,   // bumped to match web 18px card radius
  full: 999,
} as const;

export const Spacing = {
  xs:   4,
  sm:   8,
  md:   16,
  lg:   24,
  xl:   32,
  xxl:  48,
} as const;
