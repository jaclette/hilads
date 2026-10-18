import i18n from '@/i18n';
import { BASE_URL, sharePrefix } from '@/constants';
import { localizeCityName } from '@/i18n/cityName';
import { themeName } from '@/features/daily/themes';
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
      rank: { rank: number; city: string | null } | null }
  | { type: 'spot'; id: string; photoUrl: string | null; theme: ThemeKey | null; name: string; city: City; by: string | null }
  | { type: 'today'; photoUrl: string | null; theme: ThemeKey | null; themeLabel?: string | null; date?: string; text: string; city: City };

/** My proof: its photo, the challenge, its city, my username and its podium rank (world first, else city). */
export function proofShare(proof: DailyProof, challenge: DailyChallenge): ShareContent {
  const world = proof.worldRank !== null && proof.worldRank <= 3 ? proof.worldRank : null;
  const city = proof.cityRank !== null && proof.cityRank <= 3 ? proof.cityRank : null;
  return {
    type: 'proof', id: proof.id, photoUrl: proof.photoUrl, theme: challenge.theme?.key ?? null, text: challenge.text,
    themeLabel: challenge.theme ? themeName(challenge.theme.key, { special: challenge.special, city: proof.city?.name }) : null,
    city: proof.city, username: proof.user.username ?? null,
    rank: world ? { rank: world, city: null } : city && proof.city?.name ? { rank: city, city: proof.city.name } : null,
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

/** The link, in the sharer's language (/fr/p/..., English unprefixed). */
export function shareUrl(c: ShareContent): string {
  const path = c.type === 'proof' ? `/p/${c.id}` : c.type === 'spot' ? `/s/${c.id}` : '/today';
  return `${BASE_URL}${sharePrefix()}${path}`;
}

/** The line that goes with the link (never containing it). */
export function shareText(c: ShareContent): string {
  const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`share.${key}`, { ns: 'daily', ...opts });
  if (c.type === 'proof') return t('textProof', { challenge: c.text });
  if (c.type === 'spot') {
    return c.city?.name ? t('textSpotCity', { name: c.name, city: localizeCityName(c.city.name) }) : t('textSpot', { name: c.name });
  }
  return t('textToday', { challenge: c.text });
}
