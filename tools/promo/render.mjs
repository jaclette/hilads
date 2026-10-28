// npm run promo [-- YYYY-MM-DD] [--no-upload]
// Renders a day's promo from yesterday's world tour (SPEC 10.13), in English
// and French: the story video (1080×1920, opening on your clip when
// PROMO_CLIPS_DIR has <date>.mp4, else on the first city's photo, with the
// question as a caption), the Instagram carousel (1080×1350 JPEGs, zipped) and
// the captions. Then uploads them to Back office › Daily › Promo.
// Needs .env: API_URL, PROMO_TOKEN, optional PROMO_CLIPS_DIR.

import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { getVideoMetadata, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { caption } from './captions.mjs';
import { CAROUSEL_CITIES, timing } from './src/timing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const args = process.argv.slice(2);
const upload = !args.includes('--no-upload');
const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? localDate();
const api = (process.env.API_URL ?? 'https://api.hilads.live').replace(/\/$/, '');
const token = process.env.PROMO_TOKEN;
const LOCALES = ['en', 'fr'];

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function apiCall(route, body) {
  const res = await fetch(`${api}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Promo-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${route}: ${res.status} ${json.error ?? ''}`);
  return json;
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo ${url}: ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

/** Your clip of the day in PROMO_CLIPS_DIR (<date>.mp4 / .mov / .m4v), or null. */
function findClip() {
  const dir = process.env.PROMO_CLIPS_DIR;
  if (!dir) return null;
  for (const ext of ['mp4', 'mov', 'm4v', 'MP4', 'MOV', 'M4V']) {
    const file = path.join(dir, `${date}.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

async function main() {
  if (!token) throw new Error('PROMO_TOKEN is missing: copy .env.example to .env and fill it in.');
  console.log(`Promo of ${date} (yesterday's tour) from ${api}`);
  const data = await apiCall(`/internal/promo/${date}`);
  if (data.cities.length === 0) throw new Error('No city has a photo allowed for the promo: nothing to render.');

  // A fresh public folder: fonts, logo, flags, the photos and your clip.
  const work = path.join(here, '.cache', date);
  const pub = path.join(work, 'public');
  const out = path.join(here, 'out', date);
  await rm(work, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(pub, 'photos'), { recursive: true });
  await mkdir(out, { recursive: true });
  await cp(path.join(repo, 'apps/mobile/assets/fonts'), path.join(pub, 'fonts'), { recursive: true });
  await cp(path.join(repo, 'apps/web/public/flags'), path.join(pub, 'flags'), { recursive: true });
  await cp(path.join(repo, 'apps/web/public/logo/icon.svg'), path.join(pub, 'logo.svg'));

  const cities = [];
  for (const city of data.cities) {
    const photo = `photos/${city.proofId}${path.extname(new URL(city.photoUrl).pathname) || '.jpg'}`;
    try {
      await download(city.photoUrl, path.join(pub, photo));
    } catch (e) {
      console.warn(`  skipped ${city.name.en}: ${e.message}`);
      continue;
    }
    const flag = city.country && existsSync(path.join(pub, 'flags', `${city.country}.svg`)) ? `flags/${city.country}.svg` : null;
    cities.push({ ...city, photo, flag });
  }

  const clipFile = findClip();
  let clip = null;
  let clipSeconds = 0;
  if (clipFile) {
    clip = `clip${path.extname(clipFile).toLowerCase()}`;
    await cp(clipFile, path.join(pub, clip));
    clipSeconds = (await getVideoMetadata(path.join(pub, clip))).durationInSeconds;
    console.log(`  your clip: ${path.basename(clipFile)} (${clipSeconds.toFixed(1)} s${clipSeconds > 15 ? ', cut at 15 s' : ''})`);
  } else {
    console.log("  no clip for this day: the video opens on the first city's photo");
  }

  const t = timing(clipSeconds, cities.length);
  const videoCities = cities.slice(0, t.cities);
  const slideCities = cities.slice(0, CAROUSEL_CITIES);
  console.log(`  video: ${videoCities.length} cities, ${(t.total / 30).toFixed(1)} s · carousel: ${slideCities.length} cities`);

  console.log('  bundling…');
  const serveUrl = await bundle({ entryPoint: path.join(here, 'src/index.jsx'), publicDir: pub });

  const files = [];
  const assets = [];
  for (const locale of LOCALES) {
    const videoProps = { locale, data, cities: videoCities, clip, timing: t };
    const video = await selectComposition({ serveUrl, id: 'Video', inputProps: videoProps });
    const videoFile = path.join(out, `hilads-${date}-${locale}.mp4`);
    console.log(`  rendering the ${locale.toUpperCase()} video…`);
    await renderMedia({ composition: video, serveUrl, codec: 'h264', outputLocation: videoFile, inputProps: videoProps, muted: !clip });
    files.push({ kind: `video_${locale}`, file: videoFile, contentType: 'video/mp4' });

    const slideProps = { locale, data, cities: slideCities };
    const slides = [{ kind: 'hook' }, ...slideCities.map((_, index) => ({ kind: 'city', index })), { kind: 'end' }];
    const dir = path.join(out, `carousel-${locale}`);
    await mkdir(dir, { recursive: true });
    console.log(`  rendering the ${locale.toUpperCase()} carousel (${slides.length} slides)…`);
    for (const [i, slide] of slides.entries()) {
      const props = { ...slideProps, slide };
      const still = await selectComposition({ serveUrl, id: 'Slide', inputProps: props });
      await renderStill({ composition: still, serveUrl, inputProps: props, imageFormat: 'jpeg', jpegQuality: 92,
                          output: path.join(dir, `${String(i + 1).padStart(2, '0')}.jpg`) });
    }
    const zip = path.join(out, `hilads-${date}-carousel-${locale}.zip`);
    execFileSync('zip', ['-jq', zip, ...(await readdir(dir)).sort().map((f) => path.join(dir, f))]);
    files.push({ kind: `carousel_${locale}`, file: zip, contentType: 'application/zip' });

    // The caption names the cities the video shows; the carousel has the same first ones.
    const text = caption(data, videoCities, locale);
    await writeFile(path.join(out, `caption-${locale}.txt`), text + '\n');
    assets.push({ kind: `caption_${locale}`, content: text });
  }
  console.log(`  saved in ${out}`);

  if (!upload) {
    console.log('  --no-upload: nothing sent to the back office');
    return;
  }
  console.log('  uploading…');
  const { files: urls } = await apiCall(`/internal/promo/${date}/uploads`, {
    files: files.map((f) => ({ name: path.basename(f.file), contentType: f.contentType })),
  });
  for (const [i, f] of files.entries()) {
    const res = await fetch(urls[i].putUrl, { method: 'PUT', headers: { 'Content-Type': f.contentType }, body: await readFile(f.file) });
    if (!res.ok) throw new Error(`upload ${path.basename(f.file)}: ${res.status} ${await res.text()}`);
    assets.push({ kind: f.kind, url: urls[i].url });
  }
  await apiCall(`/internal/promo/${date}/assets`, { assets });
  console.log(`Done: ${api}/admin/daily/promo?date=${date}`);
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
