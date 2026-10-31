# Daily promo (SPEC 10.13)

Every morning, from yesterday's world tour: a vertical video, an Instagram carousel and a caption, in English and French. Rendered on your Mac with Remotion, uploaded to **Back office › Daily › Promo** with a download for each. You post them by hand.

## Setup (once)

```sh
cd tools/promo
npm install
cp .env.example .env   # API_URL, PROMO_TOKEN (the Render env var), PROMO_CLIPS_DIR
```

The first render downloads Remotion's headless Chrome (about 170 MB).

Remotion's license is free for one person (and companies of up to 3 people). Past that, a Creators seat is needed (remotion.dev/docs/pricing).

## Every morning, after the drop

```sh
npm run promo                 # today's promo
npm run promo -- 2026-10-31   # another day
npm run promo -- --no-upload  # render only (out/<date>/)
```

Your clip: put `<date>.mp4` (or `.mov`, `.m4v`) in `PROMO_CLIPS_DIR`, for example `2026-10-31.mp4`. It opens the video with its own sound and the question over it, cut at 15 s. Everything after it is silent: add your music in each app. Without a clip, the video opens on the first city's photo with the question.

## What it makes

| | |
|---|---|
| Video (1080×1920, 20 to 30 s) | the hook: your clip (else the first city's photo) with yesterday's question as a plain story caption; about 1 s per city (photo, flag, city, the answer in a bubble, @photographer); the end card, 2 s: the small logo and "Play for your city on Hilads" |
| Carousel (1080×1350 JPEGs, zipped) | the first city's photo with the question, one slide per city (18 at most), the end slide |
| Caption | the question, three answers, "And in your city? Tell us in the comments", then on the last line "Play for your city on Hilads: link in bio", five hashtags |

Native, not an ad: no logo, URL or app name before the end card, never "download" or "free app".

Cities: one per country first (the tour's order, podium first), then second cities, so the first seconds show as many countries as possible. Each city shows its best photo the author allows (see SPEC 10.13); the back office's Promo page shows why a photo is out and can exclude one. After an exclusion, run the command again: the new render replaces the old one.

## Files

- `render.mjs`: reads `GET /internal/promo/{date}`, renders, uploads (presigned R2 URLs from the API) and saves to the back office.
- `src/Promo.jsx`: the frames (the hook's caption in the system font, like text typed in Instagram; then the app's design: flag stickers, answer bubbles, credits; the brand on the end card only).
- `src/timing.js`: how long each part lasts and how many cities fit.
- `captions.mjs`: the captions and hashtags.
- `npm run worlds -- <date>`: the "Different Worlds by Hilads" video of a day (`worlds.mjs`, `src/Worlds.jsx`), uploaded to its topic in Back office › Worlds; `--file docs/worlds/<date>.json` renders a package before it's imported (see docs/different-worlds.md).
- `npm run stories`: the story frames that recruit players (`src/Stories.jsx`), saved in `store-screenshots/stories/` (see its README).
- `npm run studio`: preview the frames in Remotion Studio. `npm test`: captions and timing.
