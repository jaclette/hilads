// The ready-to-paste caption of a day (Instagram, TikTok, YouTube Shorts):
// a hook on yesterday's question, the highlight answers (podium cities first,
// one per country), the tagline, today's question and five hashtags.

import { COPY, answerText, flagEmoji, theme } from './src/copy.js';

const HASHTAGS = {
  en: {
    hidden_gem: ['#HiddenGems', '#CityGuide'],
    taste:      ['#StreetFood', '#FoodAroundTheWorld'],
    get_around: ['#PublicTransport', '#CityLife'],
    local_find: ['#LocalFinds', '#ShopLocal'],
    night_out:  ['#Nightlife', '#CityNights'],
    sip:        ['#Cheers', '#DrinksAroundTheWorld'],
    only_here:  ['#LocalCulture', '#OnlyHere'],
    special:    ['#LocalCulture', '#CityLife'],
    base:       ['#Hilads', '#PlayLocal', '#AroundTheWorld'],
  },
  fr: {
    hidden_gem: ['#PepitesCachees', '#BonsPlans'],
    taste:      ['#StreetFood', '#CuisineDuMonde'],
    get_around: ['#TransportsEnCommun', '#VieUrbaine'],
    local_find: ['#TrouvaillesLocales', '#AcheterLocal'],
    night_out:  ['#VieNocturne', '#SortieEnVille'],
    sip:        ['#Sante', '#BoissonsDuMonde'],
    only_here:  ['#CultureLocale', '#SeulementIci'],
    special:    ['#CultureLocale', '#VieUrbaine'],
    base:       ['#Hilads', '#JoueLocal', '#AutourDuMonde'],
  },
};

/** Five hashtags: #Hilads, the tagline's, two for the theme, around the world. */
export function hashtags(themeKey, locale) {
  const h = HASHTAGS[locale];
  const [brand, play, world] = h.base;
  return [brand, play, ...(h[themeKey] ?? h.special), world];
}

/** The caption of $data (GET /internal/promo/{date}) in $locale, for the cities shown. */
export function caption(data, cities, locale) {
  const c = COPY[locale];
  const y = data.yesterday;
  const lines = [`${y.question[locale]} ${theme(y.theme).emoji}🌍`, c.hookCities(cities.length), ''];

  const withAnswer = cities.filter((city) => answerText(city, locale));
  if (withAnswer.length > 0) {
    for (const city of withAnswer.slice(0, 3)) {
      lines.push(locale === 'fr'
        ? `${flagEmoji(city.country)} ${city.name.fr} : « ${answerText(city, 'fr')} »`
        : `${flagEmoji(city.country)} ${city.name.en}: “${answerText(city, 'en')}”`);
    }
  } else {
    const names = cities.slice(0, 4).map((city) => `${flagEmoji(city.country)} ${city.name[locale]}`).join(', ');
    lines.push(cities.length > 4 ? `${names}, ${c.andMore(cities.length - 4)}` : names);
  }

  lines.push('', c.today(data.today.question[locale]), `${c.tagline} ${c.playOn}`, '', hashtags(y.theme, locale).join(' '));
  return lines.join('\n');
}
