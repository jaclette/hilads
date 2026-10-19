import i18n from '@/i18n';
import { BASE_URL, sharePrefix } from '@/constants';
import { localizeCityName, shortCityName } from '@/i18n/cityName';
import { themeName } from '@/features/daily/themes';
import { answerText } from '@/features/compare/format';
import type { Spot } from '@/api/spots';
import type { DailyChallenge, DailyProof, DailyThemeKey } from '@/types';

type City = { name: string | null; country?: string | null } | null;

/**
 * What a share sends (SPEC 9.14): the card's content and the link.
 * proof = my proof (hilads.live/p/{id}), spot = a place (/s/{id}),
 * today = today's challenge, "Challenge a friend" (/today).
 */
type ThemeKey = DailyThemeKey | 'special';

export type ShareContent =
  | { type: 'proof'; id: string; photoUrl: string; theme: ThemeKey | null; themeLabel?: string | null; text: string; city: City; username: string | null;
      rank: { rank: number; city: string | null } | null;
      /** Today's question and my answer, for the share line (COPY.md). */
      question?: string | null; answer?: string | null }
  | { type: 'spot'; id: string; photoUrl: string | null; theme: ThemeKey | null; name: string; city: City; by: string | null }
  | { type: 'today'; photoUrl: string | null; theme: ThemeKey | null; themeLabel?: string | null; date?: string; text: string; city: City;
      /** "Answer for Saigon with me on Hilads." (SPEC 9.16) instead of the challenge line. */
      represent?: boolean }
  /** A Hilads Index card (SPEC 10.9): its challenge, then one line per city ("Saigon · €1.20"); links to that day. */
  | { type: 'index'; photoUrl: string | null; theme: ThemeKey | null; themeLabel?: string | null; date: string; text: string; city: null;
      lines: { country: string | null; city: string; value: string }[] };

/** My proof: its photo, the challenge, its city, my username and its podium rank (world first, else city). */
export function proofShare(proof: DailyProof, challenge: DailyChallenge): ShareContent {
  const world = proof.worldRank !== null && proof.worldRank <= 3 ? proof.worldRank : null;
  const city = proof.cityRank !== null && proof.cityRank <= 3 ? proof.cityRank : null;
  return {
    type: 'proof', id: proof.id, photoUrl: proof.photoUrl, theme: challenge.theme?.key ?? null, text: challenge.text,
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

/** The link, in the sharer's language (/fr/p/..., English unprefixed). */
export function shareUrl(c: ShareContent): string {
  const path = c.type === 'proof' ? `/p/${c.id}` : c.type === 'spot' ? `/s/${c.id}` : c.type === 'index' ? `/d/${c.date}` : '/today';
  return `${BASE_URL}${sharePrefix()}${path}`;
}

/** The line that goes with the link (never containing it). */
export function shareText(c: ShareContent): string {
  const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`share.${key}`, { ns: 'daily', ...opts });
  if (c.type === 'proof') {
    // "How do locals say cheers? In Saigon: Một, hai, ba, dzô! And in your city? Play local. Compare global."
    const city = c.city?.name ? shortCityName(c.city.name) : null;
    if (!city) return c.text;
    return c.question && c.answer ? t('textProof', { question: c.question, city, answer: c.answer }) : t('textProofNoAnswer', { challenge: c.text, city });
  }
  if (c.type === 'spot') {
    return c.city?.name ? t('textSpotCity', { name: c.name, city: localizeCityName(c.city.name) }) : t('textSpot', { name: c.name });
  }
  if (c.type === 'index') {
    return i18n.t('index.shareText', { ns: 'daily', lines: c.lines.map(l => `${l.city} ${l.value}`).join(' · ') });
  }
  if (c.represent && c.city?.name) {
    return i18n.t('represent.share', { ns: 'daily', city: shortCityName(c.city.name) });
  }
  return t('textToday', { challenge: c.text });
}
