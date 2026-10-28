// npm run stories
// The four story frames that recruit players (Instagram and TikTok,
// 1080×1920), each as a PNG and a 5-second MP4, in English and French, for
// Halloween and a generic version (only frame 2 differs), plus a guide image
// per frame with the covered bands and the sticker areas.
// Saved in store-screenshots/stories/ (see its README). Your photo:
// store-screenshots/stories/my-photo.jpg (or .jpeg, .png, .heic).

import { existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const out = path.join(repo, 'store-screenshots/stories');
const LOCALES = ['en', 'fr'];
const NAMES = { help: '1-help', board: '2-board', loop: '3-loop', play: '4-play' };
const STORY_FRAMES = Object.keys(NAMES); // the frames of src/Stories.jsx

async function main() {
  const pub = path.join(here, '.cache', 'stories', 'public');
  await rm(pub, { recursive: true, force: true });
  await mkdir(path.join(pub, 'screens'), { recursive: true });
  await cp(path.join(repo, 'apps/mobile/assets/fonts'), path.join(pub, 'fonts'), { recursive: true });
  await cp(path.join(repo, 'apps/web/public/flags'), path.join(pub, 'flags'), { recursive: true });
  await cp(path.join(repo, 'store-screenshots/ios/en-US/01_today.png'), path.join(pub, 'screens/today-en.png'));
  await cp(path.join(repo, 'store-screenshots/ios/fr-FR/01_today.png'), path.join(pub, 'screens/today-fr.png'));

  let photo = null;
  const mine = ['jpg', 'jpeg', 'png', 'heic', 'JPG', 'JPEG', 'PNG', 'HEIC'].map((e) => path.join(out, `my-photo.${e}`)).find(existsSync);
  if (mine) {
    photo = 'my-photo.jpg';
    execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', '1600', mine, '--out', path.join(pub, photo)], { stdio: 'ignore' });
    console.log(`  your photo: ${path.basename(mine)}`);
  } else {
    console.warn('  no my-photo.jpg in store-screenshots/stories/: frame 1 shows a placeholder');
  }

  console.log('  bundling…');
  const serveUrl = await bundle({ entryPoint: path.join(here, 'src/index.jsx'), publicDir: pub });
  const render = async (props, file, video) => {
    const composition = await selectComposition({ serveUrl, id: 'Story', inputProps: props });
    if (video) await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: file, inputProps: props, muted: true });
    else await renderStill({ composition, serveUrl, inputProps: props, imageFormat: 'png', output: file });
  };

  for (const set of ['halloween', 'generic']) {
    for (const locale of LOCALES) {
      const dir = path.join(out, set, locale);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      for (const frame of STORY_FRAMES) {
        const base = path.join(dir, NAMES[frame]);
        if (set === 'generic' && frame !== 'board') {
          // Only frame 2 speaks of Halloween: the others are the same files.
          for (const ext of ['png', 'mp4']) await cp(path.join(out, 'halloween', locale, `${NAMES[frame]}.${ext}`), `${base}.${ext}`);
          continue;
        }
        console.log(`  ${set} ${locale.toUpperCase()} ${NAMES[frame]}…`);
        const props = { frame, locale, halloween: set === 'halloween', photo };
        await render({ ...props, still: true, guide: false }, `${base}.png`, false);
        await render({ ...props, still: false, guide: false }, `${base}.mp4`, true);
      }
    }
  }

  const guides = path.join(out, 'guides');
  await rm(guides, { recursive: true, force: true });
  await mkdir(guides, { recursive: true });
  for (const frame of STORY_FRAMES) {
    await render({ frame, locale: 'en', halloween: true, photo, still: true, guide: true }, path.join(guides, `${NAMES[frame]}.png`), false);
  }
  console.log(`Done: ${out}`);
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
