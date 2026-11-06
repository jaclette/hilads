// Regenerates the map's PNG flags (assets/map/flags, src/features/map/mapFlags.ts) and the city
// bubble pills (assets/map/bubble-pill-*@3x.png). Uses sharp from apps/web: node scripts/gen-map-flags.mjs
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const require = createRequire(`${ROOT}/../web/package.json`);
const sharp = require('sharp');
const SRC = `${ROOT}/assets/flags`;
const OUT = `${ROOT}/assets/map/flags`;
mkdirSync(OUT, { recursive: true });
const codes = readdirSync(SRC).filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4)).sort();
for (const cc of codes) {
  const svg = readFileSync(`${SRC}/${cc}.svg`);
  for (const k of [2, 3]) {
    const w = 18 * k, h = 13.5 * k, r = 2 * k;
    const flag = await sharp(svg, { density: 72 * k * 4 }).resize(Math.round(w), Math.round(h), { fit: 'cover' }).png().toBuffer();
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);
    const line = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${k / 4}" y="${k / 4}" width="${w - k / 2}" height="${h - k / 2}" rx="${r}" fill="none" stroke="rgba(42,28,19,0.25)" stroke-width="${k / 2}"/></svg>`);
    const out = await sharp(flag).composite([{ input: mask, blend: 'dest-in' }, { input: line }]).png({ compressionLevel: 9 }).toBuffer();
    writeFileSync(`${OUT}/${cc}@${k}x.png`, out);
  }
}
const lines = codes.map(cc => `  ${cc.toUpperCase()}: require('../../../assets/map/flags/${cc}.png'),`);
writeFileSync(`${ROOT}/src/features/map/mapFlags.ts`,
`// Generated from assets/flags (flag-icons, MIT): PNG flags for the map's native layers (Mapbox
// can't draw SVG), 18×13.5 pt with round corners and a hairline, @2x and @3x.
/* eslint-disable @typescript-eslint/no-require-imports */
export const MAP_FLAGS: Record<string, number> = {
${lines.join('\n')}
};
`);
console.log(codes.length, 'flags');
// The city bubble's two pills (3x pixels, white: recolored on the map, sdf): the ring 34 pt high, the fill 30 pt.
for (const pt of [34, 30]) {
  const h = pt * 3, w = h + 3;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${h / 2}" fill="#fff"/></svg>`);
  writeFileSync(`${ROOT}/assets/map/bubble-pill-${pt}@3x.png`, await sharp(svg).png().toBuffer());
  console.log(pt, w, h);
}
