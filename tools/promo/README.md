# Daily promo (SPEC 10.9)

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

Your clip: put `<date>.mp4` (or `.mov`, `.m4v`) in `PROMO_CLIPS_DIR`, for example `2026-10-31.mp4`. It opens the video with its own sound, cut at 15 s. Everything after it is silent: add your music in each app. Without a clip, the video starts with the title card.

## What it makes

| | |
|---|---|
| Video (1080×1920, 20 to 30 s) | your clip, the title card (yesterday's question, cities and countries, flags), about 1 s per city (photo, flag, city, the answer in a bubble, @photographer), the end card (today's question, Play local. Compare global., hilads.live) |
| Carousel (1080×1350 JPEGs, zipped) | a title slide, one slide per city (18 at most), an end slide |
| Caption | a hook on the question, three highlight answers, today's question, the tagline, five hashtags |

Cities: one per country first (the tour's order, podium first), then second cities, so the first seconds show as many countries as possible. Each city shows its best photo the author allows (see SPEC 10.9); the back office's Promo page shows why a photo is out and can exclude one. After an exclusion, run the command again: the new render replaces the old one.

## Files

- `render.mjs`: reads `GET /internal/promo/{date}`, renders, uploads (presigned R2 URLs from the API) and saves to the back office.
- `src/Promo.jsx`: the frames (the app's design: cream, ink, Be Vietnam Pro, theme colors, flag stickers, answer bubbles).
- `src/timing.js`: how long each part lasts and how many cities fit.
- `captions.mjs`: the captions and hashtags.
- `npm run studio`: preview the frames in Remotion Studio. `npm test`: captions and timing.
