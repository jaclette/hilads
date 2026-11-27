import { answerText } from '@/features/compare/format';
import type { DailyTodayCountries, DailyWorldAnswer } from '@/types';

/** One chip of "The world says": a city and an answer, with every photo that gave it. */
export type AnswerChip = {
  key: string;
  city: { id: number; name: string; country: string };
  /** The answer as its most liked photo wrote it; '' = a photo without words (shown as 📷). */
  text: string;
  /** Its photos, most liked first. */
  ids: string[];
  mine: boolean;
};

/** An answer's words: the question's answer, else the caption, else the place. */
export function answerWords(a: DailyWorldAnswer, locale: string): string {
  if (a.answer && !a.backHome) return answerText(a.answer, locale);
  return (a.caption ?? a.spot ?? a.place ?? '').trim();
}

/**
 * The same answer twice: case, accents, emoji and punctuation left out ("Hảo Hảo!" = "hao hao 🍜").
 * Plain ranges, no Unicode property escapes (Hermes).
 */
export function answerKey(s: string): string {
  return s.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[\uD800-\uDFFF\u2600-\u27BF\uFE0F\u200D\u20E3]/g, ' ')
    .replace(/[.,!?;:'"’‘“”()[\]{}\-–—…·*~_/\\|#@&+=<>^`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A group's words: the spelling written most often; on a tie, not ALL CAPS, then the most liked (first). */
function spelling(list: string[]): string {
  const n = new Map<string, number>();
  for (const s of list) n.set(s, (n.get(s) ?? 0) + 1);
  const shouty = (s: string) => (s === s.toUpperCase() && s !== s.toLowerCase() ? 1 : 0);
  return [...n.keys()].sort((a, b) => n.get(b)! - n.get(a)! || shouty(a) - shouty(b) || list.indexOf(a) - list.indexOf(b))[0];
}

/**
 * Every photo of the day as chips: one per city and answer, identical answers grouped (×3).
 * My city first, then the cities with the most answers; inside a city, my answer first, then the
 * most given. Without `answers` (an older server): one chip per country, its top photo.
 */
export function answerChips(data: DailyTodayCountries | null, myCityId: number | null, locale: string): AnswerChip[] {
  if (!data) return [];
  const list: DailyWorldAnswer[] = data.answers ?? data.items.map(g => ({
    id: g.top.id, city: g.city, caption: g.top.caption ?? null, answer: g.top.answer ?? null, backHome: !!g.top.backHome,
    spot: g.top.spot?.name ?? null, place: g.top.place?.name ?? null, mine: !!g.top.isMine, votes: g.top.voteCount,
  }));
  const chips = new Map<string, AnswerChip & { votes: number; best: number; spellings: string[] }>();
  const cities = new Map<number, { n: number; votes: number }>();
  for (const a of [...list].sort((x, y) => y.votes - x.votes)) {
    const text = answerWords(a, locale);
    const key = `${a.city.id}|${answerKey(text) || '📷'}`;
    const c = chips.get(key);
    if (c) { c.ids.push(a.id); c.mine ||= a.mine; c.votes += a.votes; c.spellings.push(text); }
    else chips.set(key, { key, city: a.city, text: answerKey(text) ? text : '', ids: [a.id], mine: a.mine, votes: a.votes, best: a.votes, spellings: [text] });
    const ct = cities.get(a.city.id) ?? { n: 0, votes: 0 };
    ct.n += 1; ct.votes += a.votes;
    cities.set(a.city.id, ct);
  }
  const cityRank = (id: number) => (id === myCityId ? 1 : 0);
  return [...chips.values()].sort((a, b) => {
    if (a.city.id !== b.city.id) {
      const ca = cities.get(a.city.id)!, cb = cities.get(b.city.id)!;
      return cityRank(b.city.id) - cityRank(a.city.id) || cb.n - ca.n || cb.votes - ca.votes || a.city.name.localeCompare(b.city.name);
    }
    return Number(b.mine) - Number(a.mine) || b.ids.length - a.ids.length || b.best - a.best;
  }).map(({ votes: _v, best: _b, spellings, ...c }) => ({ ...c, text: c.text ? spelling(spellings) : '' }));
}
