// npm run worlds [-- YYYY-MM-DD] [--no-upload] [--file docs/worlds/<date>.json]
// Renders a "Different Worlds by Hilads" day as a silent 1080×1920 video
// (src/Worlds.jsx) from the day's latest package in Admin › Worlds, then
// uploads it to that package (the topic page shows it, with a download).
// --file renders a package file before it is imported (photos from Commons),
// and never uploads. Needs .env: API_URL, PROMO_TOKEN (the Daily promo's).
// A topic in video mode: a slide's Commons clip (clip_url, from clip_start)
// plays in the photo's square, downloaded once into .cache/clips (kept between
// runs, a clip unused for 30 days is deleted); a slide without one shows its photo.

import { cp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { getVideoMetadata, renderMedia, selectComposition } from '@remotion/renderer';
import { clipRate } from './src/worldsTiming.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const args = process.argv.slice(2);
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const upload = !args.includes('--no-upload') && !fileArg;
const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? localDate();
const api = (process.env.API_URL ?? 'https://api.hilads.live').replace(/\/$/, '');
const token = process.env.PROMO_TOKEN;
// Wikimedia refuses downloads without a descriptive User-Agent.
const UA = 'HiladsWorlds/1.0 (https://hilads.live; Different Worlds video)';
// The outro line when rendering a file (from the API it's dw_settings.outro_cta).
const DEFAULT_OUTRO_CTA = 'Compare your city on hilads.live';

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
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

// Clips, by URL: downloaded once, reused by every render.
const clipCache = path.join(here, '.cache', 'clips');
const CLIP_KEEP_DAYS = 30;

/** The cached file of a clip (downloaded when missing, its date refreshed when used). */
async function cachedClip(url) {
  await mkdir(clipCache, { recursive: true });
  const ext = path.extname(new URL(url).pathname).toLowerCase() || '.webm';
  const file = path.join(clipCache, createHash('sha1').update(url).digest('hex').slice(0, 16) + ext);
  if (!existsSync(file)) {
    process.stdout.write(`  clip ${decodeURIComponent(path.basename(new URL(url).pathname)).slice(0, 60)}… `);
    await download(url, `${file}.part`);
    await cp(`${file}.part`, file);
    await rm(`${file}.part`, { force: true });
    console.log(`${((await stat(file)).size / 1e6).toFixed(1)} MB`);
  }
  const now = new Date();
  await utimes(file, now, now);
  return file;
}

/** Deletes the cached clips no render used for CLIP_KEEP_DAYS. */
async function pruneClips() {
  if (!existsSync(clipCache)) return;
  const limit = Date.now() - CLIP_KEEP_DAYS * 864e5;
  for (const name of await readdir(clipCache)) {
    const file = path.join(clipCache, name);
    if ((await stat(file)).mtimeMs < limit) await rm(file, { force: true });
  }
}

/** The Twemoji file of a flag emoji (backend/api/assets/flags), as DwSlides::flagFile. */
function flagFile(flag) {
  const cps = [...(flag ?? '').trim()].map((c) => c.codePointAt(0)).filter((cp) => cp !== 0xfe0f).map((cp) => cp.toString(16));
  const name = `${cps.join('-')}.svg`;
  return cps.length && existsSync(path.join(repo, 'backend/api/assets/flags', name)) ? `flags/${name}` : null;
}

/** The slides as the API's plan gives them: [{position, kind, text, country, flag, credit, photo_src, photoUrl?}]. */
function planFromContent(c) {
  const clip = (p) => (p?.clip_url ? { url: p.clip_url, start: Number(p.clip_start ?? 0), credit: p.clip_credit ?? '' } : null);
  const pic = (p) => ({ credit: p?.photo_credit ?? '', photo_src: p?.photo_url ?? '', clip: clip(p) });
  return [
    { position: 1, kind: 'hook', text: c.hook?.on_screen_text ?? '', ...pic(c.hook) },
    ...(c.slides ?? []).map((s, i) => ({ position: i + 2, kind: 'country', text: s.on_screen_text, note: s.on_screen_note ?? '', country: s.country, flag: s.flag, ...pic(s) })),
    { position: (c.slides ?? []).length + 2, kind: 'outro', text: c.outro?.question ?? '', cta: DEFAULT_OUTRO_CTA, ...pic(c.outro) },
  ];
}

async function main() {
  let data;
  if (fileArg) {
    const doc = JSON.parse(await readFile(path.resolve(repo, fileArg), 'utf8'));
    const pkg = (doc.packages ?? [doc]).find((p) => !p.date || p.date === date) ?? doc.packages?.[0];
    data = { date: pkg.date ?? date, version: 0, slides: planFromContent(pkg.content ?? pkg) };
    console.log(`Different Worlds ${data.date} from ${fileArg} (not uploaded)`);
  } else {
    if (!token) throw new Error('PROMO_TOKEN is missing: copy .env.example to .env and fill it in.');
    data = await apiCall(`/internal/worlds/${date}`);
    console.log(`Different Worlds ${date}: "${data.title}", version ${data.version}, from ${api}`);
  }

  const work = path.join(here, '.cache', `worlds-${data.date}`);
  const pub = path.join(work, 'public');
  const out = path.join(here, 'out', 'worlds', data.date);
  await rm(work, { recursive: true, force: true });
  await mkdir(path.join(pub, 'photos'), { recursive: true });
  await mkdir(out, { recursive: true });
  await cp(path.join(repo, 'apps/mobile/assets/fonts'), path.join(pub, 'fonts'), { recursive: true });
  await cp(path.join(repo, 'backend/api/assets/flags'), path.join(pub, 'flags'), { recursive: true });
  await cp(path.join(repo, 'backend/api/assets/logo.svg'), path.join(pub, 'logo.svg'));

  await mkdir(path.join(pub, 'clips'), { recursive: true });
  const slides = [];
  let clips = 0;
  for (const s of data.slides) {
    // The slide's clip (the API sends it in video mode only; a package file always), else its photo.
    let clip = null;
    if (s.clip?.url) {
      try {
        const file = await cachedClip(s.clip.url);
        const name = `clips/${String(s.position).padStart(2, '0')}${path.extname(file)}`;
        await cp(file, path.join(pub, name));
        const { durationInSeconds } = await getVideoMetadata(file);
        const start = Math.min(Math.max(0, s.clip.start ?? 0), Math.max(0, durationInSeconds - 1));
        const rate = clipRate(durationInSeconds - start, s.kind);
        if (rate === null) throw new Error(`only ${(durationInSeconds - start).toFixed(1)} s from ${start} s`);
        clip = { src: name, start, rate };
        clips++;
      } catch (e) {
        console.warn(`  slide ${s.position}: clip not used (${e.message}), photo instead`);
      }
    }
    // The API's square crop when the package is imported, else the source photo (cropped by the frame).
    const src = clip ? null : (s.photoUrl || s.photo_src || null);
    let photo = null;
    if (src) {
      photo = `photos/${String(s.position).padStart(2, '0')}${path.extname(new URL(src).pathname).toLowerCase() || '.jpg'}`;
      try {
        await download(src, path.join(pub, photo));
      } catch (e) {
        console.warn(`  slide ${s.position}: photo not downloaded (${e.message}), plain background`);
        photo = null;
      }
    }
    slides.push({ kind: s.kind, text: s.text, note: s.note ?? '', country: s.country ?? null, flag: s.flag ? flagFile(s.flag) : null,
                  credit: clip ? s.clip.credit : (s.credit ?? ''), photo, clip,
                  cta: s.kind === 'outro' ? (s.cta ?? '') : null });
  }
  if (clips) console.log(`  ${clips} clip${clips > 1 ? 's' : ''}`);
  await pruneClips();

  console.log(`  ${slides.length} slides, bundling…`);
  const serveUrl = await bundle({ entryPoint: path.join(here, 'src/index.jsx'), publicDir: pub });
  const inputProps = { slides };
  const composition = await selectComposition({ serveUrl, id: 'Worlds', inputProps });
  const file = path.join(out, `different-worlds-${data.date}${data.version ? `-v${data.version}` : ''}.mp4`);
  console.log(`  rendering ${(composition.durationInFrames / composition.fps).toFixed(1)} s…`);
  await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: file, inputProps, muted: true });
  console.log(`  saved: ${file}`);
  // The work folder (copies of the clips, ~300 MB) is only needed for the render.
  await rm(work, { recursive: true, force: true });
  await rm(serveUrl, { recursive: true, force: true }).catch(() => {});
  // Only the latest render of the day is kept on the Mac (a --file render stays: no version in its name).
  if (data.version) {
    for (const name of await readdir(out)) {
      if (name !== path.basename(file) && /^different-worlds-.+-v\d+\.mp4$/.test(name)) await rm(path.join(out, name));
    }
  }

  if (!upload) {
    console.log('  not uploaded');
    return;
  }
  console.log('  uploading…');
  const { putUrl, url } = await apiCall(`/internal/worlds/${data.date}/upload`, { version: data.version });
  const res = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: await readFile(file) });
  if (!res.ok) throw new Error(`upload: ${res.status} ${await res.text()}`);
  await apiCall(`/internal/worlds/${data.date}/video`, { version: data.version, url });
  console.log(`Done: ${api}/admin/worlds (${data.date})`);
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
