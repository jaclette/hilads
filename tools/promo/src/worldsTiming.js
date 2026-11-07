// "Different Worlds" video timings (src/Worlds.jsx), and how a clip fills a slide (pure).

export const FPS = 30;
export const FADE = 8;                                    // frames of crossfade into a slide
export const MIN_RATE = 0.65;                             // a short clip is slowed down, never more
export const DETAIL_DELAY = 18;                           // frames between the headline and its detail (0.6 s)

// How long a slide shows (2026-11-07: about 35 s a video, 40 at most): the hook 3.5 s and the
// outro 4 s, fixed; a country 4 to 5 s from its text (base + per word). Text that needs more than
// its slide's max isn't given more time: the package shortens its detail (DwStudio::readWarnings).
const READ = {
  hook:    { base: 1.6, perWord: 0.16, min: 3.5, max: 3.5 },   // a short kicker: up to ~12 words (the brief's example)
  country: { base: 1.6, perWord: 0.21, min: 4,   max: 5 },
  outro:   { base: 1.6, perWord: 0.21, min: 4,   max: 4 },
};
export const MAX_VIDEO_SECONDS = 40;

const words = (s) => (s ?? '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
  .trim().split(/\s+/).filter(Boolean).length;

/** The seconds a slide's text needs to be read (headline + detail; the outro's question), uncapped. */
export function readSeconds(slide) {
  const r = READ[slide.kind] ?? READ.country;
  return Math.round((r.base + (words(slide.text) + words(slide.detail)) * r.perWord) * 10) / 10;
}

/** How long a slide shows, in seconds: its reading time within its kind's range. */
export function slideSeconds(slide) {
  const r = READ[slide.kind] ?? READ.country;
  return Math.round(Math.min(r.max, Math.max(r.min, readSeconds(slide))) * 10) / 10;
}

/** A video's length in seconds (its slides one after the other). */
export const videoSeconds = (slides) => Math.round(slides.reduce((n, s) => n + slideSeconds(s), 0) * 10) / 10;

/** How long a slide's clip plays: the slide plus its crossfade, in seconds. */
export const clipNeed = (seconds) => seconds + FADE / FPS;

/** The playback speed that makes $available seconds of clip fill a slide of $seconds (1 when long enough), or null: too short. */
export function clipRate(available, seconds) {
  const need = clipNeed(seconds);
  if (available >= need) return 1;
  const rate = available / need;
  return rate >= MIN_RATE ? Math.round(rate * 1000) / 1000 : null;
}
