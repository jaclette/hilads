// ── Environment ───────────────────────────────────────────────────────────────

// In development, these come from .env (EXPO_PUBLIC_* prefix required).
// In production, set via EAS environment variables.
export const API_URL =
  (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080') + '/api/v1';

export const WS_URL =
  process.env.EXPO_PUBLIC_WS_URL ?? 'ws://localhost:8081';

// ── Design tokens ─────────────────────────────────────────────────────────────

export const Colors = {
  bg:       '#0f0f0f',
  bg2:      '#1a1a1a',
  bg3:      '#252525',
  border:   '#2a2a2a',
  text:     '#e0e0e0',
  muted:    '#888888',
  muted2:   '#555555',
  accent:   '#FF7A3C',
  accentDim:'rgba(255,122,60,0.15)',
  violet:   '#a78bfa',
  green:    '#4ade80',
  red:      '#f87171',
  white:    '#ffffff',
} as const;

export const FontSizes = {
  xs:   11,
  sm:   13,
  md:   15,
  lg:   18,
  xl:   22,
  xxl:  28,
} as const;

export const Radius = {
  sm:  6,
  md:  10,
  lg:  16,
  full: 999,
} as const;

export const Spacing = {
  xs:   4,
  sm:   8,
  md:   16,
  lg:   24,
  xl:   32,
} as const;
