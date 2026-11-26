/**
 * A rank as an ordinal in the app's language ("1st", "12e", "3.º", "2位", "第3名"), never "#3"
 * (owner's rule 2026-11-26: no "#" for ranks anywhere; lists use a plain number or the medal).
 * Used through the i18next formatter: write "You're {{rank, ordinal}}" in a translation.
 * Same table as the web (apps/mobile/src/lib/ordinal.ts) and the server (backend/api/src/Ordinal.php).
 */
const HI = { 1: 'ला', 2: 'रा', 3: 'रा', 4: 'था', 6: 'ठा' };

export function ordinal(value, lng) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return String(value);
  const l = (lng ?? 'en').toLowerCase();
  switch (l) {
    case 'fr': return n === 1 ? '1er' : `${n}e`;
    case 'es': case 'pt-pt': return `${n}.º`;
    case 'pt-br': case 'it': return `${n}º`;
    case 'de': return `${n}.`;
    case 'nl': return `${n}e`;
    case 'ru': return `${n}-й`;
    case 'ja': return `${n}位`;
    case 'ko': return `${n}위`;
    case 'zh-hans': case 'zh-hant': return `第${n}名`;
    case 'th': return `อันดับ ${n}`;
    case 'vi': return `hạng ${n}`;
    case 'id': return `ke-${n}`;
    case 'fil': return `ika-${n}`;
    case 'hi': return `${n}${HI[n] ?? 'वां'}`;
    case 'ar': return `الـ${n}`;
    default: {
      const suffix = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
      let cat = 'other';
      try { cat = new Intl.PluralRules('en', { type: 'ordinal' }).select(n); } catch {
        cat = n % 10 === 1 && n % 100 !== 11 ? 'one' : n % 10 === 2 && n % 100 !== 12 ? 'two' : n % 10 === 3 && n % 100 !== 13 ? 'few' : 'other';
      }
      return `${n}${suffix[cat] ?? 'th'}`;
    }
  }
}
