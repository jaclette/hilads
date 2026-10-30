// Shared helpers for the i18n tools (validate, export, apply). Node 18+, no dependencies.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ROOTS = {
  app: path.join(REPO, 'apps/mobile/src/i18n/locales'),
  web: path.join(REPO, 'apps/web/src/i18n/locales'),
};
export const LOCALES = ['en', 'fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant',
                        'ja', 'ko', 'fil', 'th', 'id', 'hi', 'ru', 'ar'];
// Namespaces that hold proper nouns, not UI copy: never reported as "same as English".
export const NAME_NAMESPACES = new Set(['cityNames', 'cities']);

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
export const pluralBase = (key) => key.replace(PLURAL_SUFFIX, '');
export const pluralCat = (key) => (key.match(PLURAL_SUFFIX) || [])[1] ?? null;

/** CLDR plural categories i18next uses for a locale (cardinal). */
export function categories(locale) {
  const tag = { 'pt-br': 'pt-BR', 'pt-pt': 'pt-PT', 'zh-hans': 'zh-Hans', 'zh-hant': 'zh-Hant' }[locale] ?? locale;
  return new Intl.PluralRules(tag).resolvedOptions().pluralCategories;
}

export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

/** { "ns:key.path": value } for one locale of one surface. */
export function load(surface, locale) {
  const dir = path.join(ROOTS[surface], locale);
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const ns = f.slice(0, -5);
    const flat = flatten(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    for (const [k, v] of Object.entries(flat)) out[`${ns}:${k}`] = v;
  }
  return out;
}

/** Interpolation and markup tokens of a string, sorted: {{x}}, $t(...), <1>, </b>. */
export function tokens(s) {
  return [...String(s).matchAll(/\{\{[^}]+\}\}|\$t\([^)]*\)|<\/?[a-zA-Z0-9]+\s*\/?>/g)]
    .map((m) => m[0].replace(/\s+/g, '')).sort();
}

/** Set a "ns:a.b.c" value in a nested object, keeping the existing key order. */
export function setIn(obj, dotted, value) {
  const parts = dotted.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts.at(-1)] = value;
}

export function deleteIn(obj, dotted) {
  const parts = dotted.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) { o = o?.[p]; if (!o) return; }
  delete o[parts.at(-1)];
}
