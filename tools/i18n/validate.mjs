#!/usr/bin/env node
// Checks the app and web translation files against English (CI-ready, no dependencies).
//
//   node tools/i18n/validate.mjs              errors fail (exit 1), warnings are counted
//   node tools/i18n/validate.mjs --strict     warnings fail too
//   node tools/i18n/validate.mjs -v [vi ...]  list every finding (optionally only some locales)
//
// Errors:   missing key, empty value, a plural form the locale needs is missing,
//           placeholder / markup mismatch ({{city}}, <1>...</1>), invalid JSON.
// Warnings: value identical to English (allowlist: brand terms, tools/i18n/allowlist.json),
//           brand term dropped, key unknown to English, plural form the locale never uses,
//           French typography (em dash, missing no-break space before ? ! : ;).
import fs from 'fs';
import path from 'path';
import { ROOTS, LOCALES, NAME_NAMESPACES, categories, load, pluralBase, pluralCat, tokens } from './lib.mjs';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const verbose = args.includes('-v') || args.includes('--verbose');
const only = args.filter((a) => !a.startsWith('-'));
const allow = JSON.parse(fs.readFileSync(new URL('./allowlist.json', import.meta.url), 'utf8'));

// Values made only of these (plus punctuation, emoji, placeholders) are fine in English.
const BRAND = ['Hilads', 'Hi now', 'Hi', 'Most Local', 'Local Pass', 'Local Twist', 'Daily Challenge', 'Pioneer',
  'Hidden gem', 'Taste', 'Join in', 'Local find', 'Night out', 'Drinks', 'Only here', 'Special', 'Get around',
  'Play local. Compare global.', 'Same challenge. Different worlds.', 'Halloween', 'vibe', 'Vibes', 'Events', 'Hangouts'];
const brandOnly = (s) => {
  let rest = String(s).replace(/\{\{[^}]+\}\}|<\/?[a-z0-9]+\s*\/?>|https?:\/\/\S+/gi, ' ');
  for (const b of [...BRAND].sort((a, b) => b.length - a.length)) rest = rest.split(b).join(' ');
  return !/\p{L}{2,}/u.test(rest);
};
const allowed = (locale, key, value) =>
  brandOnly(value) || (allow['*'] ?? []).includes(key) || (allow[locale] ?? []).includes(key)
  || (allow.values?.['*'] ?? []).includes(value) || (allow.values?.[locale] ?? []).includes(value);

let errors = 0, warnings = 0;
const report = [];

for (const surface of Object.keys(ROOTS)) {
  let en;
  try { en = load(surface, 'en'); } catch (e) { console.error(`${surface}/en: ${e.message}`); process.exit(1); }
  const enBases = new Map(); // base -> { plural: bool, other: value }
  for (const [k, v] of Object.entries(en)) {
    const cat = pluralCat(k);
    const base = cat ? pluralBase(k) : k;
    const e = enBases.get(base) ?? { plural: false, value: v };
    if (cat) { e.plural = true; if (cat === 'other') e.value = v; }
    enBases.set(base, e);
  }

  for (const locale of LOCALES.filter((l) => l !== 'en' && (!only.length || only.includes(l)))) {
    const found = { error: [], warn: [] };
    const err = (m) => found.error.push(m);
    const warn = (m) => found.warn.push(m);
    let loc;
    try { loc = load(surface, locale); } catch (e) { err(`invalid JSON: ${e.message}`); loc = {}; }
    const cats = categories(locale);

    for (const [base, { plural, value: enValue }] of enBases) {
      const ns = base.split(':')[0];
      const keys = plural ? cats.map((c) => `${base}_${c}`) : [base];
      for (const key of keys) {
        const v = loc[key];
        const enV = en[key] ?? enValue;
        // "many" in French, Spanish, Italian, Portuguese is for millions only ("1 000 000 de photos").
        const millionsOnly = key.endsWith('_many') && /^(fr|es|it|pt-br|pt-pt)$/.test(locale);
        if (v === undefined) { (millionsOnly ? warn : err)(`missing ${key}`); continue; }
        if (Array.isArray(enV)) {
          if (!Array.isArray(v) || v.length !== enV.length || v.some((x) => typeof x !== 'string' || !x.trim())) err(`list ${key}: ${enV.length} non-empty strings expected`);
          continue;
        }
        if (!enV.trim()) continue;
        if (typeof v !== 'string' || !v.trim()) { err(`empty ${key}`); continue; }
        const want = tokens(enV), got = tokens(v);
        const extra = got.filter((t) => !want.includes(t) && !(plural && t === '{{count}}'));
        const lost = want.filter((t) => !got.includes(t) && !(plural && t === '{{count}}'));
        if (extra.length || lost.length) err(`placeholders ${key}: ${lost.length ? 'lost ' + lost.join(' ') : ''}${extra.length ? ' unknown ' + extra.join(' ') : ''}`);
        if (!NAME_NAMESPACES.has(ns) && v === enV && /\p{L}{3,}/u.test(v) && !allowed(locale, key, v)) warn(`same as English ${key}: ${JSON.stringify(v)}`);
        for (const b of ['Hilads', 'Daily Challenge', 'Local Pass', 'Most Local', 'Local Twist']) {
          if (enV.includes(b) && !v.includes(b)) warn(`brand term "${b}" dropped in ${key}`);
        }
        if (locale === 'fr') {
          if (v.includes('—')) warn(`em dash in ${key}`);
          if (/[^\s  ]([?!;]|:(?=\s|$))/u.test(v.replace(/\{\{[^}]+\}\}|https?:\S+|\d+:\d+/g, ''))) warn(`no-break space missing before ? ! : ; in ${key}`);
          if (/ [?!:;]/.test(v)) warn(`plain space before ? ! : ; in ${key} (use U+00A0)`);
        }
      }
    }
    for (const key of Object.keys(loc)) {
      const cat = pluralCat(key);
      const base = cat ? pluralBase(key) : key;
      const e = enBases.get(base);
      if (!e && !(cat && enBases.has(key))) { if (!NAME_NAMESPACES.has(key.split(':')[0])) warn(`unknown key ${key}`); }
      else if (e?.plural && cat && !cats.includes(cat)) warn(`plural form "${cat}" unused in ${locale}: ${key}`);
      else if (e && !e.plural && cat) warn(`plural form on a non-plural key ${key}`);
    }
    errors += found.error.length; warnings += found.warn.length;
    report.push({ where: `${surface}/${locale}`, ...found });
  }
}

for (const r of report) {
  if (!r.error.length && !r.warn.length) continue;
  console.log(`${r.where}: ${r.error.length} error(s), ${r.warn.length} warning(s)`);
  if (verbose) for (const m of [...r.error.map((m) => 'E ' + m), ...r.warn.map((m) => 'W ' + m)]) console.log('   ' + m);
}
console.log(`\n${errors} error(s), ${warnings} warning(s)${strict ? ' (strict)' : ''}`);
process.exit(errors || (strict && warnings) ? 1 : 0);
