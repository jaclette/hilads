// "Different Worlds" video timings (src/Worlds.jsx), and how a clip fills a slide (pure).

export const FPS = 30;
export const FADE = 8;                                    // frames of crossfade into a slide
export const SECONDS = { hook: 3.5, country: 4.5, outro: 4.5 };
export const MIN_RATE = 0.65;                             // a short clip is slowed down, never more

/** How long a slide's clip plays: the slide plus its crossfade, in seconds. */
export const clipNeed = (kind) => (SECONDS[kind] ?? 3.5) + FADE / FPS;

/** The playback speed that makes $available seconds of clip fill the slide (1 when long enough), or null: too short. */
export function clipRate(available, kind) {
  const need = clipNeed(kind);
  if (available >= need) return 1;
  const rate = available / need;
  return rate >= MIN_RATE ? Math.round(rate * 1000) / 1000 : null;
}
