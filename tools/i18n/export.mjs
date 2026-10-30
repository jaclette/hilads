#!/usr/bin/env node
// Export a locale for a translation pass: every English string of the app and the web, grouped
// (one unit per distinct English text, or per plural pair), with the keys and screens that use
// it and the current translation, in chunks a translator (human or model) can work through.
//
//   node tools/i18n/export.mjs vi [--chunk 220]   → tmp/i18n/vi/in-01.json, in-02.json…
//
// The translator writes tmp/i18n/vi/out-NN.json for each chunk, then tools/i18n/apply.mjs.
// Output format, per unit id:
//   { "t": "translation" | { "one": "…", "few": "…", "other": "…" },
//     "note": "optional, for the reviewer", "flag": true when a native should check,
//     "per": { "app:ns:key": "different text for this one key" } (rare: same English, other context) }
import fs from 'fs';
import path from 'path';
import { REPO, ROOTS, NAME_NAMESPACES, categories, load, pluralBase, pluralCat } from './lib.mjs';

const [locale, ...rest] = process.argv.slice(2);
if (!locale) { console.error('usage: export.mjs <locale> [--chunk N]'); process.exit(1); }
const chunkSize = Number(rest[rest.indexOf('--chunk') + 1]) || 220;
const SOURCES = {
  app: ['apps/mobile/app', 'apps/mobile/src'],
  web: ['apps/web/src', 'apps/web/api'],
};

// Where each key is used: the first source file that spells it out (a hint for the translator).
function sourceIndex(surface) {
  const files = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (f === 'node_modules' || f === 'locales') continue;
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?|mjs)$/.test(f)) files.push([path.relative(REPO, p), fs.readFileSync(p, 'utf8')]);
    }
  };
  for (const d of SOURCES[surface]) if (fs.existsSync(path.join(REPO, d))) walk(path.join(REPO, d));
  const short = (p) => p.replace(/^apps\/(mobile|web)\//, '');
  return (key) => {
    const [ns, leaf] = key.split(':');
    // Files that load the key's namespace first ('daily', "daily", daily:key), then any file.
    const usesNs = ([, src]) => src.includes(`'${ns}'`) || src.includes(`"${ns}"`) || src.includes(`${ns}:`);
    const ordered = [...files.filter(usesNs), ...files.filter((f) => !usesNs(f))];
    const quoted = [`'${leaf}'`, `"${leaf}"`, `\`${leaf}\``, `${ns}:${leaf}'`];
    for (const [p, src] of ordered) if (quoted.some((q) => src.includes(q))) return short(p);
    const parent = leaf.split('.').slice(0, -1).join('.');
    if (parent) for (const [p, src] of ordered) if (src.includes(`'${parent}.`) || src.includes(`\`${parent}.`)) return short(p) + ' (dynamic)';
    return '';
  };
}

const cats = categories(locale);
const units = new Map();
for (const surface of Object.keys(ROOTS)) {
  const en = load(surface, 'en');
  const cur = load(surface, locale);
  const where = sourceIndex(surface);
  const seen = new Set();
  for (const [k, v] of Object.entries(en)) {
    if (NAME_NAMESPACES.has(k.split(':')[0]) || typeof v !== 'string' || !v.trim()) continue;
    const cat = pluralCat(k);
    if (cat) {
      const base = pluralBase(k);
      if (seen.has(base)) continue;
      seen.add(base);
      const enForms = { one: en[`${base}_one`] ?? en[`${base}_other`], other: en[`${base}_other`] ?? v };
      const id = `P|${enForms.one}|${enForms.other}`;
      const u = units.get(id) ?? { plural: true, forms: cats, en: enForms, uses: [], current: {} };
      u.uses.push({ key: `${surface}:${base}`, where: where(base) });
      for (const c of cats) {
        const old = cur[`${base}_${c}`] ?? (c === 'one' ? cur[`${base}_one`] : cur[`${base}_other`]);
        if (old !== undefined && u.current[c] === undefined) u.current[c] = old;
      }
      units.set(id, u);
    } else {
      const id = `S|${v}`;
      const u = units.get(id) ?? { en: v, uses: [], current: [] };
      u.uses.push({ key: `${surface}:${k}`, where: where(k) });
      if (cur[k] !== undefined && !u.current.includes(cur[k])) u.current.push(cur[k]);
      units.set(id, u);
    }
  }
}

const dir = path.join(REPO, 'tmp/i18n', locale);
fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) if (f.startsWith('in-')) fs.unlinkSync(path.join(dir, f));
const list = [...units.values()].map((u, i) => ({ id: `u${i + 1}`, ...u }));
let n = 0;
for (let i = 0; i < list.length; i += chunkSize) {
  n += 1;
  const chunk = Object.fromEntries(list.slice(i, i + chunkSize).map(({ id, ...u }) => [id, u]));
  fs.writeFileSync(path.join(dir, `in-${String(n).padStart(2, '0')}.json`), JSON.stringify(chunk, null, 1) + '\n');
}
fs.writeFileSync(path.join(dir, 'units.json'), JSON.stringify(Object.fromEntries(list.map(({ id, ...u }) => [id, u]))) + '\n');
console.log(`${locale}: ${list.length} units (${list.filter((u) => u.plural).length} plural, forms ${cats.join('/')}) in ${n} chunks → ${path.relative(REPO, dir)}`);
