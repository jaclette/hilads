// How long each part of the video lasts, and how many cities fit (pure).
// 20 to 30 seconds: the hook (your clip, else the first city's photo with the
// question), about 1 second per city, the end card.

export const FPS = 30;
export const HOOK_S = 2.5;         // without a clip: the first city's photo with the question, before its answer
export const END_S = 2;
export const CITY_S = 1;
export const MIN_S = 20;
export const MAX_S = 30;
export const CLIP_MAX_S = 15;      // a longer clip is cut here
export const CAROUSEL_CITIES = 18; // Instagram: 20 slides, the hook and the end included

/** {clip, hook, city, end, cities, total} in frames (cities = how many fit; hook = 0 with a clip). */
export function timing(clipSeconds, cityCount) {
  const clip = Math.min(clipSeconds ?? 0, CLIP_MAX_S);
  const hook = clip > 0 ? 0 : HOOK_S;
  const room = MAX_S - clip - hook - END_S;
  const cities = Math.max(0, Math.min(cityCount, Math.floor(room / CITY_S)));
  // Few cities: each stays longer (up to 3 s) so the video still lasts 20 seconds.
  const short = MIN_S - clip - hook - END_S;
  const citySeconds = cities > 0 && cities * CITY_S < short ? Math.min(3, short / cities) : CITY_S;
  const f = (s) => Math.round(s * FPS);
  const out = { clip: f(clip), hook: f(hook), city: f(citySeconds), end: f(END_S), cities };
  return { ...out, total: out.clip + out.hook + out.city * cities + out.end };
}
