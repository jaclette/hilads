#!/usr/bin/env node
// Apply a translation pass made from tools/i18n/export.mjs: reads tmp/i18n/<locale>/units.json and
// every out-NN.json, writes the locale's app and web files (English key order, the plural forms the
// locale needs, nothing else changed), and the review sheet docs/i18n-review/<locale>.csv.
//
//   node tools/i18n/apply.mjs vi [--dry]
//
// A translation whose placeholders or tags differ from the English is refused (old value kept) and listed.
import fs from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { REPO, ROOTS, categories, flatten, load, pluralBase, pluralCat, tokens } from './lib.mjs';

const [locale, ...rest] = process.argv.slice(2);
const dry = rest.includes('--dry');
const dir = path.join(REPO, 'tmp/i18n', locale ?? '');
if (!locale || !fs.existsSync(path.join(dir, 'units.json'))) { console.error('usage: apply.mjs <locale> (run export.mjs first)'); process.exit(1); }

const units = JSON.parse(fs.readFileSync(path.join(dir, 'units.json'), 'utf8'));
const out = {};
for (const f of fs.readdirSync(dir).filter((f) => /^out-\d+\.json$/.test(f)).sort()) {
  try { Object.assign(out, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); }
  catch (e) { console.error(`${f}: ${e.message}`); process.exit(1); }
}
const cats = categories(locale);
const sameTokens = (a, b, plural) => {
  const strip = (t) => t.filter((x) => !(plural && x === '{{count}}')).join(' ');
  return strip(tokens(a)) === strip(tokens(b));
};

// key ("app:ns:path" or plural base) → { value | forms, note, flag, screen }
const next = new Map();
const refused = [], missing = [];
for (const [id, u] of Object.entries(units)) {
  const o = out[id];
  if (!o) { missing.push(id); continue; }
  for (const use of u.uses) {
    let t = o.per?.[use.key] ?? o.t;
    if (u.plural) {
      if (typeof t === 'string') t = Object.fromEntries(cats.map((c) => [c, t]));
      const forms = {};
      for (const c of cats) {
        const v = t?.[c] ?? t?.other;
        if (typeof v !== 'string' || !v.trim() || !sameTokens(v, u.en.other, true)) { refused.push(`${id} ${use.key}_${c}: ${JSON.stringify(v)}`); forms[c] = null; }
        else forms[c] = v;
      }
      next.set(use.key, { forms, note: o.note, flag: o.flag, where: use.where });
    } else {
      if (typeof t !== 'string' || !t.trim() || !sameTokens(t, u.en, false)) { refused.push(`${id} ${use.key}: ${JSON.stringify(t)}`); continue; }
      next.set(use.key, { value: t, note: o.note, flag: o.flag, where: use.where });
    }
  }
}

const csv = [['key', 'screen', 'english', `old_${locale}`, `new_${locale}`, 'note']];
// "old" is the committed value (HEAD), so applying in several steps keeps one before/after sheet;
// notes of earlier steps are kept too.
const headFlat = (surface, ns) => {
  try {
    const rel = path.relative(REPO, path.join(ROOTS[surface], locale, `${ns}.json`));
    return flatten(JSON.parse(execFileSync('git', ['show', `HEAD:${rel}`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })));
  } catch { return {}; }
};
const csvPath = path.join(REPO, 'docs/i18n-review', `${locale}.csv`);
const earlierNotes = {};
if (fs.existsSync(csvPath)) {
  const rows = [];
  let row = [], field = '', quoted = false, justClosed = false;
  for (const ch of fs.readFileSync(csvPath, 'utf8')) {
    if (quoted) { if (ch === '"') { quoted = false; justClosed = true; } else field += ch; continue; }
    if (ch === '"') { if (justClosed) field += '"'; quoted = true; }
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
    justClosed = false;
  }
  for (const r of rows.slice(1)) if (r[5]) earlierNotes[r[0]] = r[5];
}
const cell = (s) => /[",\n]/.test(s ?? '') ? `"${String(s).replace(/"/g, '""')}"` : (s ?? '');
let changed = 0;

for (const surface of Object.keys(ROOTS)) {
  const enDir = path.join(ROOTS[surface], 'en');
  for (const f of fs.readdirSync(enDir).filter((f) => f.endsWith('.json')).sort()) {
    const ns = f.slice(0, -5);
    const enObj = JSON.parse(fs.readFileSync(path.join(enDir, f), 'utf8'));
    const locFile = path.join(ROOTS[surface], locale, f);
    const locObj = fs.existsSync(locFile) ? JSON.parse(fs.readFileSync(locFile, 'utf8')) : {};
    const head = headFlat(surface, ns);
    const note = (key, n) => (n?.flag ? 'FLAG ' : '') + (n?.note ?? '') || earlierNotes[key] || '';
    const rebuild = (enNode, locNode, prefix) => {
      const o = {};
      for (const [k, v] of Object.entries(enNode)) {
        const dotted = prefix ? `${prefix}.${k}` : k;
        if (Array.isArray(v)) {
          const asObj = rebuild(Object.fromEntries(v.map((x, i) => [i, x])), Object.fromEntries((Array.isArray(locNode?.[k]) ? locNode[k] : []).map((x, i) => [i, x])), dotted);
          o[k] = v.map((_, i) => asObj[i]);
          continue;
        }
        if (v && typeof v === 'object') { o[k] = rebuild(v, locNode?.[k] ?? {}, dotted); continue; }
        const cat = pluralCat(k);
        if (cat) {
          const baseLeaf = pluralBase(k);
          if (Object.keys(o).some((x) => pluralBase(x) === baseLeaf && pluralCat(x))) continue;
          const id = `${surface}:${ns}:${prefix ? prefix + '.' : ''}${baseLeaf}`;
          const n = next.get(id);
          for (const c of cats) {
            const oldV = locNode?.[`${baseLeaf}_${c}`] ?? locNode?.[`${baseLeaf}_other`];
            const v = n?.forms?.[c] ?? oldV;
            if (v === undefined) continue;
            o[`${baseLeaf}_${c}`] = v;
            if (v !== oldV) changed++;
            const pk = `${surface}:${ns}:${prefix ? prefix + '.' : ''}${baseLeaf}_${c}`;
            const headV = head[`${prefix ? prefix + '.' : ''}${baseLeaf}_${c}`] ?? head[`${prefix ? prefix + '.' : ''}${baseLeaf}_other`] ?? head[`${prefix ? prefix + '.' : ''}${baseLeaf}`];
            csv.push([pk, n?.where ?? '', enNode[`${baseLeaf}_${c}`] ?? enNode[`${baseLeaf}_other`], headV ?? '', v, note(pk, n)]);
          }
          continue;
        }
        const id = `${surface}:${ns}:${dotted}`;
        const n = next.get(id);
        const oldV = locNode?.[k];
        const nv = n?.value ?? oldV ?? (Array.isArray(v) || !String(v).trim() ? v : undefined);
        if (nv === undefined) continue;
        o[k] = nv;
        if (typeof nv === 'string' && nv !== oldV) changed++;
        if (typeof nv === 'string' && String(v).trim()) csv.push([id, n?.where ?? '', v, head[dotted] ?? '', nv, note(id, n)]);
      }
      // Keys only this locale has (none expected) stay at the end rather than vanish.
      for (const [k, v] of Object.entries(locNode ?? {})) {
        if (!(k in o) && !(k in enNode) && !(pluralCat(k) && Object.keys(enNode).some((x) => pluralBase(x) === pluralBase(k)))) o[k] = v;
      }
      return o;
    };
    // City names are per-locale data (English lists only the names that differ): untouched.
    const result = ns === 'cityNames' ? locObj : rebuild(enObj, locObj, '');
    if (!dry) fs.writeFileSync(locFile, JSON.stringify(result, null, 2) + '\n');
  }
}

fs.mkdirSync(path.join(REPO, 'docs/i18n-review'), { recursive: true });
if (!dry) fs.writeFileSync(csvPath, csv.map((r) => r.map(cell).join(',')).join('\n') + '\n');
console.log(`${locale}: ${changed} value(s) changed, ${csv.length - 1} rows in docs/i18n-review/${locale}.csv`);
if (missing.length) console.log(`no translation for ${missing.length} unit(s) (kept as is): ${missing.slice(0, 20).join(' ')}${missing.length > 20 ? '…' : ''}`);
if (refused.length) { console.log(`refused ${refused.length} (placeholders / empty), kept the old value:`); for (const r of refused) console.log('  ' + r); }
