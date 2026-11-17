// npm run worlds [-- YYYY-MM-DD [YYYY-MM-DD]] [--no-upload] [--file docs/worlds/<date>.json]
// Renders a "Different Worlds by Hilads" day as a silent 1080×1920 video
// (src/Worlds.jsx) from the day's latest package in Admin › Worlds, then
// uploads it to that package (the topic page shows it, with a download).
// Two dates: every day from the first to the second, one after the other;
// a published topic, or one whose title or notes changed since its package,
// is skipped (listed at the end).
// --file renders a package file before it is imported (photos from Commons),
// and never uploads. Needs .env: API_URL, PROMO_TOKEN (the Daily promo's).
// A topic in video mode: a slide's Commons clip (clip_url, from clip_start)
// plays in the photo's square, downloaded once into .cache/clips (kept between
// runs, a clip unused for 30 days is deleted); a slide without one shows its photo.
// A topic in the reaction + ranking format (src/Reaction.jsx): one 8 s screen, its
// Pixabay clip (the R2 copy) on top, the ranking under it; the video and a PNG of the
// last frame are uploaded. --file: its clip ({pixabay_id}) is looked up on Pixabay
// with PIXABAY_API_KEY from .env (never printed). --clip <file> --clip-credit "…" [--clip-ai]
// uploads our own clip to the day's reaction package first (renderDay, uploadOwnClip).

import { cp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { endSeconds, raceEndSeconds, raceOpts } from './src/reactionTiming.js';
import { getVideoMetadata, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { clipRate, slideSeconds } from './src/worldsTiming.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const args = process.argv.slice(2);
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
// --clip <file> [--clip-credit "<note>"] [--clip-ai]: a reaction topic's own clip (e.g. an AI video), uploaded to
// the day's latest package (R2, like the other clips) before the render; no credit on the screen (the note and
// the AI-generated mark stay in the admin).
const clipArg = args.includes('--clip') ? args[args.indexOf('--clip') + 1] : null;
const clipCredit = args.includes('--clip-credit') ? args[args.indexOf('--clip-credit') + 1] : null;
const clipAi = args.includes('--clip-ai');
// --card-bg <theme|#rrggbb> --accent "<words>": a reaction card's color and accent words, to try before saving them in the package.
const cardBgArg = args.includes('--card-bg') ? args[args.indexOf('--card-bg') + 1] : null;
const accentArg = args.includes('--accent') ? args[args.indexOf('--accent') + 1] : null;
// --cta "<line>": a reaction topic's invitation (its cta_line), to try before saving it in the package.
const ctaArg = args.includes('--cta') ? args[args.indexOf('--cta') + 1] : null;
// --mode quiz --quiz "<question>" --question "<outro>": a reaction topic in quiz mode, to try before saving it.
const modeArg = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : null;
const quizArg = args.includes('--quiz') ? args[args.indexOf('--quiz') + 1] : null;
// --layout static: the static ranking (no animation, a plain list), to try before saving it in the package.
const layoutArg = args.includes('--layout') ? args[args.indexOf('--layout') + 1] : null;
const raceArg = args.includes('--race') ? args[args.indexOf('--race') + 1] : null;
// --clip <file> --slide <n> [--clip-ai]: a slides topic's own clip for slide n (1 = the hook), uploaded and saved on the package.
const slideArg = args.includes('--slide') ? args[args.indexOf('--slide') + 1] : null;
const questionArg = args.includes('--question') ? args[args.indexOf('--question') + 1] : null;
// --png-only: a reaction topic's PNGs alone (a quick look; nothing uploaded).
const pngOnly = args.includes('--png-only');
const clipSpeedArg = args.includes('--clip-speed') ? args[args.indexOf('--clip-speed') + 1] : null;
// --extra-row "<country>" --detail "<banner>": a reaction topic's extra highlighted row and banner, to try before saving them.
const extraArg = args.includes('--extra-row') ? args[args.indexOf('--extra-row') + 1] : null;
const detailArg = args.includes('--detail') ? args[args.indexOf('--detail') + 1] : null;
const upload = !args.includes('--no-upload') && !args.includes('--png-only') && !fileArg;
const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const range = dates.length === 2 && !fileArg;
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

/** A hook's or a country's headline and detail (older packages: on_screen_text, on_screen_note), as DwStudio::headline / detail. */
const headline = (p) => (p?.headline ?? '').trim() || (p?.on_screen_text ?? '').trim();
const detail = (p) => (('headline' in (p ?? {}) || 'detail' in (p ?? {})) ? (p.detail ?? '') : (p?.on_screen_note ?? '')).trim();

/** The slides as the API's plan gives them: [{position, kind, text, detail, country, flag, credit, photo_src, photoUrl?}]. */
function planFromContent(c) {
  const clip = (p) => (p?.clip_url ? { url: p.clip_url, start: Number(p.clip_start ?? 0), credit: p.clip_credit ?? '' } : null);
  const pic = (p) => ({ credit: p?.photo_credit ?? '', photo_src: p?.photo_url ?? '', clip: clip(p) });
  return [
    { position: 1, kind: 'hook', text: headline(c.hook), detail: detail(c.hook), accent: c.hook?.headline_accent ?? null, number: c.hook?.number ?? null,
      country: c.hook?.country ?? null, flag: c.hook?.flag ?? null, ...pic(c.hook) },
    ...(c.slides ?? []).map((s, i) => ({ position: i + 2, kind: 'country', text: headline(s), detail: detail(s), accent: s.headline_accent ?? null,
                                         number: s.number ?? null, country: s.country, flag: s.flag, ...pic(s) })),
    { position: (c.slides ?? []).length + 2, kind: 'outro', text: c.outro?.question ?? '', cta: c.outro?.cta_line || DEFAULT_OUTRO_CTA, ...pic(c.outro) },
  ];
}

/** A reaction package file's screen, as DwStudio::reactionVideoData gives it (its clip looked up on Pixabay). */
async function screenFromContent(c) {
  const label = [c.value_label, c.data_years || c.data_year].filter(Boolean).join(', ');
  let clip = null;
  const id = c.clip?.pixabay_id;
  if (id) {
    const key = process.env.PIXABAY_API_KEY;
    if (!key) throw new Error('PIXABAY_API_KEY is missing in .env (needed to look up the clip of a --file render).');
    const res = await fetch(`https://pixabay.com/api/videos/?${new URLSearchParams({ key, id: String(id) })}`);
    if (!res.ok) throw new Error(`Pixabay: HTTP ${res.status}`);
    const hit = (await res.json()).hits?.[0];
    if (!hit) throw new Error(`no Pixabay video ${id}`);
    // As DwPixabay::hit: the smallest rendition covering 1080 × 640.
    const files = Object.values(hit.videos ?? {}).filter((v) => v?.url).sort((a, b) => a.width - b.width);
    const pick = files.find((v) => v.width >= 1080 && v.height >= 640) ?? files[files.length - 1];
    clip = { url: pick.url, credit: `Video: ${hit.user} / Pixabay` };
  }
  return { headline: c.headline ?? '', detail: c.detail ?? '', rows: c.rows ?? [], highlight: ['Vietnam'], valueFormat: c.value_format ?? null,
           question: c.outro_question ?? null, cta: c.cta_line ?? null, extraRow: c.extra_row ?? null, mode: c.mode ?? 'classic', quiz: c.quiz_question ?? null, topic: c.topic ?? null, cardBg: c.card_bg ?? null, accent: c.headline_accent ?? null,
           source: `${label ? `${label} · ` : ''}Source${(c.source ?? '').includes(', ') ? 's' : ''}: ${c.source ?? ''}`, clip, seconds: 8 };
}

/** Every date from $from to $to, inclusive. */
function datesBetween(from, to) {
  const out = [];
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

async function main() {
  if (!range) {
    await renderDay(dates[0] ?? localDate());
    return;
  }
  if (!token) throw new Error('PROMO_TOKEN is missing: copy .env.example to .env and fill it in.');
  const done = [];
  const skipped = [];
  for (const day of datesBetween(dates[0], dates[1])) {
    try {
      const data = await apiCall(`/internal/worlds/${day}`).catch((e) => ({ missing: e.message }));
      if (data.missing) skipped.push(`${day}: no package (${data.missing})`);
      else if (data.status === 'published') skipped.push(`${day}: published, left as it is`);
      else if (data.briefChanged) skipped.push(`${day}: ${data.briefChanged}`);
      else {
        await renderDay(day, data);
        done.push(day);
      }
    } catch (e) {
      skipped.push(`${day}: failed (${e.message})`);
    }
  }
  console.log(`\n${done.length} rendered${upload ? ' and uploaded' : ''}: ${done.join(', ') || '-'}`);
  if (skipped.length) console.log(`Not rendered:\n  ${skipped.join('\n  ')}`);
}

async function renderDay(date, fetched = null) {
  let data;
  if (fileArg) {
    const doc = JSON.parse(await readFile(path.resolve(repo, fileArg), 'utf8'));
    const pkg = (doc.packages ?? [doc]).find((p) => !p.date || p.date === date) ?? doc.packages?.[0];
    const content = pkg.content ?? pkg;
    data = content.format === 'race' ? { date: pkg.date ?? date, version: 0, format: 'race', content }
      : content.format === 'reaction'
      ? { date: pkg.date ?? date, version: 0, format: 'reaction', screen: await screenFromContent(clipArg ? { ...content, clip: null } : content) }
      : { date: pkg.date ?? date, version: 0, slides: planFromContent(content) };
    console.log(`Different Worlds ${data.date} from ${fileArg} (not uploaded)`);
    // --clip with --file: the local clip as is (nothing uploaded).
    if (clipArg && data.screen) data.screen.clip = { local: ownClipFile(), credit: '' };
  } else {
    if (!token) throw new Error('PROMO_TOKEN is missing: copy .env.example to .env and fill it in.');
    data = fetched ?? await apiCall(`/internal/worlds/${date}`);
    console.log(`Different Worlds ${date}: "${data.title}", version ${data.version}, from ${api}`);
    if (clipArg) {
      data = await uploadOwnClip(data);
    }
  }

  const work = path.join(here, '.cache', `worlds-${data.date}`);
  const pub = path.join(work, 'public');
  const out = path.join(here, 'out', 'worlds', data.date);
  await rm(work, { recursive: true, force: true });
  await mkdir(path.join(pub, 'photos'), { recursive: true });
  await mkdir(out, { recursive: true });
  await cp(path.join(repo, 'apps/mobile/assets/fonts'), path.join(pub, 'fonts'), { recursive: true });
  await cp(path.join(here, 'fonts'), path.join(pub, 'fonts'), { recursive: true });   // Baloo 2 (the reaction question)
  await cp(path.join(repo, 'backend/api/assets/flags'), path.join(pub, 'flags'), { recursive: true });
  await cp(path.join(repo, 'backend/api/assets/logo.svg'), path.join(pub, 'logo.svg'));
  await mkdir(path.join(pub, 'clips'), { recursive: true });
  if (data.format === 'reaction') {
    await renderReaction(data, { work, pub, out });
    return;
  }
  if (data.format === 'race') {
    await renderRace(data, { work, pub, out });
    return;
  }

  const slides = [];
  let clips = 0;
  for (const s of data.slides) {
    // The slide's clip (the API sends it in video mode only; a package file always), else its photo.
    // The API's plan before the two-level text (2026-11-06) sends a country's note instead of a detail.
    const text = { kind: s.kind, text: s.text, detail: s.detail ?? s.note ?? '' };
    let clip = null;
    if (s.clip?.url) {
      try {
        const file = await cachedClip(s.clip.url);
        const name = `clips/${String(s.position).padStart(2, '0')}${path.extname(file)}`;
        await cp(file, path.join(pub, name));
        const { durationInSeconds } = await getVideoMetadata(file);
        const start = Math.min(Math.max(0, s.clip.start ?? 0), Math.max(0, durationInSeconds - 1));
        const rate = clipRate(durationInSeconds - start, slideSeconds(text));
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
    slides.push({ ...text, accent: s.accent ?? null, number: s.number ?? null, country: s.country ?? null, flag: s.flag ? flagFile(s.flag) : null,
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
  await uploadFile(data, file);
  console.log(`Done: ${api}/admin/worlds (${data.date})`);
}

/** The --clip file (relative to the current folder or to the repo). */
function ownClipFile() {
  const file = [path.resolve(clipArg), path.resolve(repo, clipArg)].find((f) => existsSync(f));
  if (!file || path.extname(file).toLowerCase() !== '.mp4') throw new Error(`--clip: no mp4 at ${clipArg}`);
  return file;
}

/** --clip: uploads our own clip to the day's reaction package, saves it with its credit, returns the refreshed data. */
async function uploadOwnClip(data) {
  // A slides package: --slide N says which slide plays it (1 the hook, then the countries, then the outro).
  const slides = data.format !== 'reaction' && data.format !== 'race';
  if (data.format === 'race') throw new Error('--clip is for a topic in the reaction or slides format.');
  if (slides && !slideArg) throw new Error('--clip on a slides topic needs --slide <n> (1 = the hook).');
  const file = ownClipFile();
  const { durationInSeconds, width, height } = await getVideoMetadata(file);
  console.log(`  own clip ${path.basename(file)}: ${width}×${height}, ${durationInSeconds.toFixed(2)} s, uploading…`);
  const { putUrl, url } = await apiCall(`/internal/worlds/${data.date}/upload`, { version: data.version, kind: 'clip' });
  const res = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: await readFile(file) });
  if (!res.ok) throw new Error(`clip upload: ${res.status} ${await res.text()}`);
  await apiCall(`/internal/worlds/${data.date}/clip`, { version: data.version, url, credit: clipCredit ?? '', ai: clipAi, ...(slides ? { position: Number(slideArg) } : {}) });
  console.log(`  clip saved${slides ? ` on slide ${slideArg}` : ''}${clipCredit ? ` (note: "${clipCredit}")` : ''}${clipAi ? ', AI-generated' : ''}, no credit on screen`);
  return apiCall(`/internal/worlds/${data.date}`);
}

/** Uploads a rendered file (the MP4, or the reaction screen's PNG) to its package. */
async function uploadFile(data, file, kind = null) {
  const png = file.endsWith('.png');
  console.log(`  uploading ${kind === 'png2' ? 'PNG 02' : kind === 'png3' ? 'PNG 03' : png ? 'the PNG' : 'the video'}…`);
  const { putUrl, url } = await apiCall(`/internal/worlds/${data.date}/upload`, { version: data.version, ...(kind ? { kind } : { png }) });
  const res = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': png ? 'image/png' : 'video/mp4' }, body: await readFile(file) });
  if (!res.ok) throw new Error(`upload: ${res.status} ${await res.text()}`);
  await apiCall(`/internal/worlds/${data.date}/video`, { version: data.version, url });
}

/** The reaction + ranking screen (src/Reaction.jsx): the 8 s video and its last frame as a PNG. */
async function renderReaction(data, { work, pub, out }) {
  const s = data.screen;
  // Our own clip shows no credit (DwReaction::clipCredit; also before that API change is deployed).
  if (data.content?.clip?.source === 'upload' && s.clip) s.clip.credit = '';
  let clip = null;
  if (s.clip?.url || s.clip?.local) {
    const file = s.clip.local ?? await cachedClip(s.clip.url);
    const name = `clips/reaction${path.extname(file)}`;
    await cp(file, path.join(pub, name));
    const { durationInSeconds } = await getVideoMetadata(file);
    // clip_speed: the clip faster (or slower) than filmed, e.g. 1.5 for slow-motion footage; --clip-speed to try one.
    const speed = Number(clipSpeedArg ?? s.clipSpeed ?? data.content?.clip_speed ?? 1) || 1;
    clip = { src: name, seconds: durationInSeconds, credit: s.clip.credit ?? '', speed };
    console.log(`  clip ${durationInSeconds.toFixed(2)} s${speed !== 1 ? `, at ${speed}× (${(durationInSeconds / speed).toFixed(2)} s)` : ', at its speed'}, looping when it ends`);
  } else {
    console.warn('  ⚠ no clip: the top third stays dark (Admin › Worlds › Find another clip)');
  }
  await pruneClips();
  const rows = (s.rows ?? []).map((r) => ({ ...r, value: Number(r.value), emoji: r.flag ?? null, flag: r.flag ? flagFile(r.flag) : null }));
  // The on-screen question: the package's outro question (also read from its content, before the API sends it).
  const question = questionArg ?? s.question ?? data.content?.outro_question ?? null;
  const inputProps = { headline: s.headline, detail: detailArg ?? s.detail, rows, source: s.source, highlight: s.highlight ?? [], clip, valueFormat: s.valueFormat ?? null, question,
                       topic: s.topic ?? data.content?.topic ?? data.title ?? null,
                       cta: ctaArg ?? s.cta ?? data.content?.cta_line ?? null,
                       extraRow: extraArg ?? s.extraRow ?? data.content?.extra_row ?? null,
                       layout: layoutArg ?? s.layout ?? data.content?.layout ?? 'animated',
                       mode: modeArg ?? s.mode ?? data.content?.mode ?? 'classic', quiz: quizArg ?? s.quiz ?? data.content?.quiz_question ?? null,
                       // The card's color and the headline's accent words (also read from the content, before the API sends them);
                       // --card-bg / --accent try one before it is saved in the package.
                       cardBg: cardBgArg ?? s.cardBg ?? data.content?.card_bg ?? null, accent: accentArg ?? s.accent ?? data.content?.headline_accent ?? null };

  // The closing slide needs the topic's own question and its invitation: never a generic one.
  const missing = [!String(question ?? '').trim() && 'outro_question', !String(inputProps.cta ?? '').trim() && 'cta_line'].filter(Boolean);
  if (missing.length) throw new Error(`no ${missing.join(' and no ')} for the closing slide: add ${missing.length > 1 ? 'them' : 'it'} in Admin › Worlds (${data.date})`);
  console.log(`  ${rows.length} rows, bundling…`);
  const serveUrl = await bundle({ entryPoint: path.join(here, 'src/index.jsx'), publicDir: pub });
  const composition = await selectComposition({ serveUrl, id: 'Reaction', inputProps });
  const base = path.join(out, `different-worlds-${data.date}${data.version ? `-v${data.version}` : ''}`);
  console.log(`  rendering ${(composition.durationInFrames / composition.fps).toFixed(1)} s and the PNG…`);
  if (!pngOnly) await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: `${base}.mp4`, inputProps, muted: true });
  // The PNGs (carousels). Classic: 01 the complete ranking (the frame before the closing slide), 02 the closing slide
  // (the video's last frame). Quiz: 01 the quiz question with "Guess before you swipe 👉", 02 the ranking, 03 the closing
  // slide. (A still's own props need their own composition: renderStill keeps the composition's.)
  const quiz = inputProps.mode === 'quiz';
  if (quiz && !String(inputProps.quiz ?? '').trim()) throw new Error(`quiz mode without a quiz_question (${data.date})`);
  const pngs = (quiz ? ['01', '02', '03'] : ['01', '02']).map((n) => `${base}-${n}.png`);
  const lastRanking = endSeconds(inputProps.mode) * composition.fps - 1;
  if (quiz) {
    const guess = await selectComposition({ serveUrl, id: 'Reaction', inputProps: { ...inputProps, guessStill: true } });
    await renderStill({ composition: guess, serveUrl, output: pngs[0], inputProps: { ...inputProps, guessStill: true }, frame: 0 });
  }
  await renderStill({ composition, serveUrl, output: pngs[quiz ? 1 : 0], inputProps, frame: lastRanking });
  await renderStill({ composition, serveUrl, output: pngs[quiz ? 2 : 1], inputProps, frame: composition.durationInFrames - 1 });
  console.log(`  saved: ${base}.mp4 and ${pngs.map((f) => path.basename(f).slice(-6)).join(', ')}`);
  await rm(work, { recursive: true, force: true });
  await rm(serveUrl, { recursive: true, force: true }).catch(() => {});
  if (data.version) {
    for (const name of await readdir(out)) {
      if (!name.startsWith(path.basename(base) + '.') && !name.startsWith(path.basename(base) + '-0') && /^different-worlds-.+-v\d+(-0\d)?\.(mp4|png)$/.test(name)) await rm(path.join(out, name));
    }
  }
  if (!upload) {
    console.log('  not uploaded');
    return;
  }
  await uploadFile(data, `${base}.mp4`);
  await uploadFile(data, pngs[0]);
  if (pngs[1]) await uploadFile(data, pngs[1], 'png2');
  if (pngs[2]) await uploadFile(data, pngs[2], 'png3');
  console.log(`Done: ${api}/admin/worlds (${data.date})`);
}

/**
 * The race format (src/Reaction.jsx RaceVideo): a bar chart race over the package's years (content.series:
 * [{country, flag, values: {year: number}}]), the video and three PNGs: 01 the first year, 02 the final ranking (the
 * freeze, the crown), 03 the closing slide.
 */
async function renderRace(data, { work, pub, out }) {
  // --race '<json>': race fields to try before saving them (e.g. '{"year_step":2,"hold_first":true}').
  const c = { ...data.content, ...(raceArg ? JSON.parse(raceArg) : {}) };
  const series = (c.series ?? []).map((r) => ({ country: r.country, emoji: r.flag, flag: r.flag ? flagFile(r.flag) : null, values: r.values, ranks: r.ranks ?? null, order: r.order ?? null }));
  const allYears = [...new Set(series.flatMap((r) => Object.keys(r.values)))].map(Number).sort((a, b) => a - b);
  // year_step: one year out of N from the first, always with the last (e.g. 2010, 2012, …, 2026).
  const every = Math.max(1, Number(c.year_step ?? 1) || 1);
  // first_year: the race starts there (the values are the source's, e.g. cumulative counts since an earlier year).
  const from = allYears.filter((y) => c.first_year == null || y >= Number(c.first_year));
  const years = from.filter((y, i) => i % every === 0 || i === from.length - 1);
  const label = [c.value_label, c.data_years || c.data_year].filter(Boolean).join(', ');
  const source = `${label ? `${label} · ` : ''}Source${(c.source ?? '').includes(', ') ? 's' : ''}: ${c.source ?? ''}`
    + (c.bar_scale === 'step' ? " · Bars don't start at zero" : '');
  const question = questionArg ?? c.outro_question ?? null;
  const cta = ctaArg ?? c.cta_line ?? null;
  const missing = [!String(question ?? '').trim() && 'outro_question', !String(cta ?? '').trim() && 'cta_line'].filter(Boolean);
  if (missing.length) throw new Error(`no ${missing.join(' and no ')} for the closing slide (${data.date})`);
  const inputProps = { headline: c.headline, accent: accentArg ?? c.headline_accent ?? null, years: years.map(String), series, unit: c.unit ?? '',
                       source, detail: detailArg ?? c.detail ?? null, bannerYear: c.banner_year ?? null, highlight: c.highlight ?? [],
                       cardBg: cardBgArg ?? c.card_bg ?? null, question, cta,
                       extraRow: c.extra_row ?? null, decimals: Number.isInteger(c.decimals) ? c.decimals : 1,
                       yearLabels: c.year_labels ?? null, stepSeconds: c.step_seconds ?? undefined, startSeconds: c.start_seconds ?? undefined, hold: c.hold ?? undefined,
                       slowFrom: c.slow_from ?? undefined, slowStep: c.slow_step ?? undefined, valuePrefix: c.value_prefix ?? '',
                       holdFirst: typeof c.hold_first === 'boolean' ? c.hold_first : undefined, freezeSeconds: c.freeze_seconds ?? undefined, barScale: c.bar_scale === 'step' ? 'step' : 'zero' };
  console.log(`  ${series.length} countries, ${years[0]}–${years[years.length - 1]}, bundling…`);
  const serveUrl = await bundle({ entryPoint: path.join(here, 'src/index.jsx'), publicDir: pub });
  const composition = await selectComposition({ serveUrl, id: 'Race', inputProps });
  const base = path.join(out, `different-worlds-${data.date}${data.version ? `-v${data.version}` : ''}`);
  console.log(`  rendering ${(composition.durationInFrames / composition.fps).toFixed(1)} s and the PNGs…`);
  if (!pngOnly) await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: `${base}.mp4`, inputProps, muted: true });
  const pngs = ['01', '02', '03'].map((n) => `${base}-${n}.png`);
  const fps = composition.fps;
  await renderStill({ composition, serveUrl, output: pngs[0], inputProps, frame: Math.round(raceOpts(inputProps).start * fps) - 2 });
  await renderStill({ composition, serveUrl, output: pngs[1], inputProps, frame: Math.round(raceEndSeconds(years, inputProps) * fps) - 1 });
  await renderStill({ composition, serveUrl, output: pngs[2], inputProps, frame: composition.durationInFrames - 1 });
  console.log(`  saved: ${base}.mp4 and 01.png, 02.png, 03.png`);
  await rm(work, { recursive: true, force: true });
  await rm(serveUrl, { recursive: true, force: true }).catch(() => {});
  if (!upload) {
    console.log('  not uploaded');
    return;
  }
  await uploadFile(data, `${base}.mp4`);
  await uploadFile(data, pngs[0]);
  await uploadFile(data, pngs[1], 'png2');
  await uploadFile(data, pngs[2], 'png3');
  console.log(`Done: ${api}/admin/worlds (${data.date})`);
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
