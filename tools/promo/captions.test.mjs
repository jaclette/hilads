import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caption, hashtags } from './captions.mjs';
import { flagEmoji } from './src/copy.js';
import { timing } from './src/timing.js';

const data = {
  yesterday: { theme: 'sip', question: { en: 'How do locals say cheers?', fr: 'Comment on dit santé ici ?' } },
  today: { theme: 'get_around', question: { en: 'Take the ride locals take to work.', fr: 'Prends le trajet des locaux.' } },
};
const city = (en, country, answer) => ({ proofId: en, name: { en, fr: en }, country, answer: { en: answer, fr: answer }, price: null });

test('the caption: hook, three highlights, today, tagline, five hashtags', () => {
  const cities = [city('Saigon', 'vn', 'Dô'), city('Paris', 'fr', 'Santé'), city('Berlin', 'de', 'Prost'), city('Hanoi', 'vn', 'Zô')];
  const en = caption(data, cities, 'en').split('\n');
  assert.equal(en[0], 'How do locals say cheers? 🥂🌍');
  assert.equal(en[1], '4 cities answered yesterday.');
  assert.deepEqual(en.slice(3, 6), ['🇻🇳 Saigon: “Dô”', '🇫🇷 Paris: “Santé”', '🇩🇪 Berlin: “Prost”']);
  assert.ok(en.includes("Today's question: Take the ride locals take to work."));
  assert.ok(en.includes('Play local. Compare global. Play on hilads.live'));
  assert.equal(en.at(-1).split(' ').length, 5);
  const fr = caption(data, cities, 'fr');
  assert.ok(fr.includes('🇻🇳 Saigon : « Dô »'));
  assert.ok(fr.includes('Joue local. Compare global.'));
});

test('without answers, the caption lists the cities', () => {
  const cities = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => city(n, 'fr', null));
  assert.ok(caption(data, cities, 'en').includes('🇫🇷 A, 🇫🇷 B, 🇫🇷 C, 🇫🇷 D, and 2 more'));
});

test('hashtags: five, the brand first', () => {
  assert.deepEqual(hashtags('get_around', 'en'), ['#Hilads', '#PlayLocal', '#PublicTransport', '#CityLife', '#AroundTheWorld']);
  assert.equal(hashtags('unknown', 'fr').length, 5);
});

test('flags', () => {
  assert.equal(flagEmoji('vn'), '🇻🇳');
  assert.equal(flagEmoji(null), '🌍');
});

test('timing: 1 s per city within 30 s; few cities stay longer to reach 20 s', () => {
  const many = timing(10, 40);
  assert.equal(many.cities, 14);          // 30 - 10 - 2.5 - 3 = 14.5
  assert.equal(many.city, 30);
  assert.ok(many.total <= 30 * 30);
  const noClip = timing(0, 40);
  assert.equal(noClip.cities, 24);
  const few = timing(0, 4);
  assert.equal(few.city, 90);             // 3 s each
  assert.equal(timing(40, 40).clip, 15 * 30);   // a long clip is cut at 15 s
});
