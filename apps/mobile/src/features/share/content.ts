import i18n from '@/i18n';
import { BASE_URL, sharePrefix } from '@/constants';
import { localizeCityName, shortCityName } from '@/i18n/cityName';
import { themeName } from '@/features/daily/themes';
import { answerText } from '@/features/compare/format';
import type { Spot } from '@/api/spots';
import type { DailyChallenge, DailyProof, DailyThemeKey } from '@/types';
import { eventFeatureNow } from '@/features/event/seasonal';

type City = { name: string | null; country?: string | null } | null;

/**
 * What a share sends (SPEC 9.14): the card's content and the link.
 * proof = my proof (hilads.live/p/{id}), spot = a place (/s/{id}),
 * today = today's challenge, "Challenge a friend" (/today).
 */
type ThemeKey = DailyThemeKey | 'special';

export type ShareContent =
  | { type: 'proof'; id: string; photoUrl: string; theme: ThemeKey | null; themeLabel?: string | null; text: string; city: City; username: string | null;
      /** Dual photo: the selfie drawn as an inset in a corner of the photo. */
      selfieUrl?: string | null;
      /** Event mode: a photo of the live event's days gets its share frame (e.g. "halloween"). */
      eventKey?: string | null;
      rank: { rank: number; city: string | null } | null;
      /** The photo's challenge date, votes and the share card's question (the challenge's, else the apps' default). */
      date?: string; voteCount?: number; shareQuestion?: string | null;
      /** Today's question and my answer, for the share line (COPY.md). */
      question?: string | null; answer?: string | null }
  | { type: 'spot'; id: string; photoUrl: string | null; theme: ThemeKey | null; name: string; city: City; by: string | null }
  | { type: 'today'; photoUrl: string | null; theme: ThemeKey | null; themeLabel?: string | null; date?: string; text: string; city: City;
      /** "Answer for Saigon with me on Hilads." (SPEC 9.16) instead of the challenge line. */
      represent?: boolean }
  /** My passport (V3 polish 6): my photo, @username, my city, my stamps there and my stats; links to Hilads. */
  | { type: 'passport'; photoUrl: string | null; theme: null; themeLabel?: null; text: string; city: City; username: string | null;
      stamps: DailyThemeKey[]; earned: boolean; stats: { cities: number; photos: number; likes: number } }
  /** A comparison of the Hilads Index (SPEC 10.9): its question, then one line per city ("Saigon · €1.20"); links to its latest day. */
  | { type: 'index'; photoUrl: string | null; theme: ThemeKey | null; themeLabel?: string | null; date: string; text: string; city: null;
      lines: { country: string | null; city: string; value: string }[] };

/** The live event's key when its share frame is on and the photo is of its days (else null). */
function eventShareKey(date: string): string | null {
  const ev = eventFeatureNow('shareFrame');
  return ev && date >= ev.event.start && date <= ev.event.end ? ev.key : null;
}

/** My proof: its photo, the challenge, its city, my username and its podium rank (world first, else city). */
export function proofShare(proof: DailyProof, challenge: DailyChallenge): ShareContent {
  const world = proof.worldRank !== null && proof.worldRank <= 3 ? proof.worldRank : null;
  const city = proof.cityRank !== null && proof.cityRank <= 3 ? proof.cityRank : null;
  return {
    type: 'proof', id: proof.id, photoUrl: proof.photoUrl, selfieUrl: proof.selfieUrl ?? null, theme: challenge.theme?.key ?? null, text: challenge.text,
    eventKey: eventShareKey(proof.date),
    date: proof.date, voteCount: proof.voteCount, shareQuestion: challenge.shareQuestion ?? null,
    themeLabel: challenge.theme ? themeName(challenge.theme.key, { special: challenge.special, city: proof.city?.name }) : null,
    city: proof.city, username: proof.user.username ?? null,
    rank: world ? { rank: world, city: null } : city && proof.city?.name ? { rank: city, city: proof.city.name } : null,
    question: challenge.compare?.question ?? null,
    answer: proof.answer ? answerText(proof.answer, i18n.language) : null,
  };
}

export function spotShare(spot: Spot): ShareContent {
  return {
    type: 'spot', id: spot.id, photoUrl: spot.cover.photoUrl ?? spot.cover.thumbUrl, theme: spot.themes[0] ?? null,
    name: spot.name, city: spot.city, by: spot.cover.by ?? null,
  };
}

export function todayShare(challenge: DailyChallenge, city: City): ShareContent {
  return {
    type: 'today', photoUrl: challenge.coverUrl ?? null, theme: challenge.theme?.key ?? null, date: challenge.date, text: challenge.text, city,
    themeLabel: challenge.theme ? themeName(challenge.theme.key, { special: challenge.special, city: city?.name }) : null,
  };
}

/** Invite to answer for a city (SPEC 9.16): today's card and link, "Answer for Saigon with me on Hilads." */
export function representShare(challenge: DailyChallenge, city: NonNullable<City>): ShareContent {
  return { ...todayShare(challenge, city), represent: true } as ShareContent;
}

/**
 * The link, in the sharer's language (/fr/p/..., English unprefixed). My
 * photo's link names who shared it and their city (?from=anh&city=Saigon):
 * the landing page says "@anh played for Saigon".
 */
export function shareUrl(c: ShareContent): string {
  const path = c.type === 'proof' ? `/p/${c.id}` : c.type === 'spot' ? `/s/${c.id}` : c.type === 'index' ? `/d/${c.date}`
    : c.type === 'passport' ? '/' : '/today';
  const url = `${BASE_URL}${sharePrefix()}${path}`;
  if (c.type !== 'proof') return url;
  const q = [c.username ? `from=${encodeURIComponent(c.username)}` : null,
             c.city?.name ? `city=${encodeURIComponent(shortCityName(c.city.name))}` : null].filter(Boolean);
  return q.length ? `${url}?${q.join('&')}` : url;
}

/** Any approved photo's public page (hilads.live/p/{id}), in the sharer's language. */
export function proofUrl(id: string): string {
  return `${BASE_URL}${sharePrefix()}/p/${id}`;
}

/** The line that goes with the link (never containing it). */
export function shareText(c: ShareContent): string {
  const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`share.${key}`, { ns: 'daily', ...opts });
  if (c.type === 'proof') {
    // "How do locals say cheers? In Saigon: Một, hai, ba, dzô! And in your city? Play local. Compare global."
    const city = c.city?.name ? shortCityName(c.city.name) : null;
    if (!city) return c.text;
    if (c.question && c.answer) return t('textProof', { question: c.question, city, answer: c.answer });
    // "I played for Saigon on Hilads: Find a fruit locals love. What's YOUR city's answer?"
    return t('textProofAsk', { city, challenge: c.text, question: c.shareQuestion || t('card.question') });
  }
  if (c.type === 'spot') {
    return c.city?.name ? t('textSpotCity', { name: c.name, city: localizeCityName(c.city.name) }) : t('textSpot', { name: c.name });
  }
  if (c.type === 'passport') {
    return c.city?.name ? t('textPassport', { city: shortCityName(c.city.name) }) : t('textPassportNoCity');
  }
  if (c.type === 'index') {
    // "How much is a drink? Saigon ₫30,000 · Lisbon ₫49,400"
    return `${c.text} ${c.lines.map(l => `${l.city} ${l.value}`).join(' · ')}`;
  }
  if (c.represent && c.city?.name) {
    return i18n.t('represent.share', { ns: 'daily', city: shortCityName(c.city.name) });
  }
  return t('textToday', { challenge: c.text });
}
