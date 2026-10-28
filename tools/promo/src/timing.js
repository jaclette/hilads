// How long each part of the video lasts, and how many cities fit (pure).
// 20 to 30 seconds: your clip, the title card, about 1 second per city, the end card.

export const FPS = 30;
export const TITLE_S = 2.5;
export const END_S = 3;
export const CITY_S = 1;
export const MIN_S = 20;
export const MAX_S = 30;
export const CLIP_MAX_S = 15;      // a longer clip is cut here
export const CAROUSEL_CITIES = 18; // Instagram: 20 slides, title and end included

/** {clip, title, city, end, cities, total} in frames (cities = how many fit). */
export function timing(clipSeconds, cityCount) {
  const clip = Math.min(clipSeconds ?? 0, CLIP_MAX_S);
  const room = MAX_S - clip - TITLE_S - END_S;
  const cities = Math.max(0, Math.min(cityCount, Math.floor(room / CITY_S)));
  // Few cities: each stays longer (up to 3 s) so the video still lasts 20 seconds.
  const short = MIN_S - clip - TITLE_S - END_S;
  const citySeconds = cities > 0 && cities * CITY_S < short ? Math.min(3, short / cities) : CITY_S;
  const f = (s) => Math.round(s * FPS);
  const out = { clip: f(clip), title: f(TITLE_S), city: f(citySeconds), end: f(END_S), cities };
  return { ...out, total: out.clip + out.title + out.city * cities + out.end };
}
