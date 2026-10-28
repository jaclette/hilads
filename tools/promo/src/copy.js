// Words of the promo in English and French (COPY.md 16). Shared by the video,
// the carousel and the captions. *word* marks the highlighted word (DESIGN.md 3.3).
// Native, not an ad: the brand only on the end card and the caption's last line,
// never "download", "free app" or a URL.

export const COPY = {
  en: {
    playFor: 'Play for *your city* on Hilads',
    comment: 'And in your city? Tell us in the comments 👇',
    cta: 'Play for your city on Hilads: link in bio',
    andMore: (n) => `and ${n} more`,
  },
  fr: {
    playFor: 'Joue pour *ta ville* sur Hilads',
    comment: 'Et dans ta ville ? Dis-le en commentaire 👇',
    cta: 'Joue pour ta ville sur Hilads : lien en bio',
    andMore: (n) => `et ${n} de plus`,
  },
};

// Theme colors (DESIGN.md 2): fill and the text that goes on it.
export const THEMES = {
  hidden_gem: { fill: '#1FB5A8', ink: '#2A1C13', emoji: '💎' },
  taste:      { fill: '#FFD2C2', ink: '#8A3418', emoji: '🍜' },
  get_around: { fill: '#3D9BF0', ink: '#2A1C13', emoji: '🛵' },
  local_find: { fill: '#FF7EB0', ink: '#2A1C13', emoji: '🧭' },
  night_out:  { fill: '#5B5BD6', ink: '#FFFFFF', emoji: '🌙' },
  sip:        { fill: '#FFC93C', ink: '#2A1C13', emoji: '🥂' },
  only_here:  { fill: '#FFD2C2', ink: '#8A3418', emoji: '📍' },
  special:    { fill: '#FF7A3D', ink: '#2A1C13', emoji: '✨' },
};

export const theme = (key) => THEMES[key] ?? THEMES.special;

/** A country's flag emoji ("vn" → 🇻🇳), or 🌍. */
export function flagEmoji(country) {
  if (!country || !/^[a-z]{2}$/i.test(country)) return '🌍';
  return String.fromCodePoint(...[...country.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** A city's answer as shown in its bubble: the answer, else the price, else nothing. */
export function answerText(city, locale) {
  if (city.answer?.[locale]) return city.answer[locale];
  if (city.price) {
    try {
      return new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency: city.price.currency, maximumFractionDigits: 2 })
        .format(city.price.amount);
    } catch {
      return `${city.price.amount} ${city.price.currency}`;
    }
  }
  return null;
}
