# Different Worlds by Hilads (Admin › Worlds)

A daily short video series (TikTok, Reels, Shorts): one topic, 6 to 8 countries, real sourced facts, real photos. Each day gets silent 1080×1920 slides and a silent video; music is added when publishing.

## How a day is made

1. **Brief**: Admin › 🌍 Worlds › "Download brief (14 days)" gives the settings and the next topics:
   - the system prompt, with the phase and the always-included countries filled in;
   - the illustration prompt and the visual style.
2. **Prepare** the packages in Claude Code. No API key is needed and no AI call happens on the server.
   - Research each fact with web search and give one source per country.
   - Write the JSON of the system prompt's schema.
   - Pick one real photo per slide on Wikimedia Commons with the photo prompt:
     - public domain, CC0, CC BY or CC BY-SA only;
     - no children, no recognizable faces, no logos;
     - `"photo_url"` is the file on upload.wikimedia.org (a 1920px thumbnail is fine);
     - `"photo_credit"` reads "Photo: author, license, Wikimedia Commons" and is printed on the slide.
   - Older packages may still carry a drawn `"illustration_svg"` instead.
   - Files go in `docs/worlds/<date>.json`, an untracked folder like `docs/daily-challenge/`.
3. **Check** the slides locally before importing:
   ```
   docker build -t hilads-api-dw backend/api
   docker run --rm -v "$PWD/docs/worlds:/pk:ro" -v /tmp/out:/out hilads-api-dw \
     php scripts/dw_render.php /pk/2026-10-31.json /out
   ```
   and the video: `cd tools/promo && npm run worlds -- 2026-10-31 --file docs/worlds/2026-10-31.json` (saved in `tools/promo/out/worlds/`, not uploaded).
4. **Import** it: Admin › Worlds › "Import packages", or the topic page.
   - Each import is a new version of the day's topic.
   - The server downloads each photo from Commons, crops it to a square, composes the 1080×1920 slides and stores everything on R2 under `dw/<topic>/v<n>/`.
5. **Edit and publish**:
   - Every text field can be edited inline. An on-screen text redraws its slide and keeps the illustration.
   - "Replace photo" swaps one slide's picture: a Commons URL or an uploaded photo, with its credit. Empty gives the plain background.
   - "Download all slides (ZIP)" gives `01_hook.png … 09_outro.png`.
   - "Copy full caption" gives, in this order:
     1. the caption's text;
     2. the AI disclosure;
     3. the hilads.live line, then the question;
     4. the hashtags.
   - Mark ready, then mark published with the three platform links.
6. **Video**: on the Mac, `cd tools/promo && npm run worlds -- <date>`.
   - It reads the day's latest version (`GET /internal/worlds/<date>`, the Daily promo's `PROMO_TOKEN`) and renders 31 s of video (`src/Worlds.jsx`): hook 3 s, each country 3.5 s, outro 3.5 s. The layout is the slides', with a slow zoom on each photo, the text rising in and a crossfade between slides.
   - It uploads the video to the package, and the topic page then shows it with a download button.
   - After an edit or a new version, run it again: the new video replaces the old one.

## File format

```json
{"packages": [{"date": "2026-10-31", "model": "Claude Opus 5.5 (Claude Code)", "content": {
  "topic": "…", "why_today": "…",
  "hook": {"on_screen_text": "…", "illustration_brief": "…", "photo_url": "https://upload.wikimedia.org/…", "photo_credit": "Photo: …, CC0, Wikimedia Commons"},
  "slides": [{"country": "Vietnam", "flag": "🇻🇳", "on_screen_text": "…", "caption_detail": "…",
              "illustration_brief": "…", "photo_url": "https://upload.wikimedia.org/…", "photo_credit": "…", "source_url": "https://…"}],
  "outro": {"question": "…", "illustration_brief": "…", "photo_url": "https://upload.wikimedia.org/…", "photo_credit": "…"},
  "caption": "…", "hashtags": ["#…"], "ai_disclosure": "…", "follow_up_idea": "…", "warnings": ["…"]
}}]}
```

**What blocks an import:**
- a missing field;
- fewer than 6 or more than 8 countries;
- an always-included country missing;
- a country listed twice;
- a source that isn't a URL;
- a photo that isn't on upload.wikimedia.org, or a photo without a credit.

**What gives a warning only:**
- an on-screen text over 12 words;
- a caption over 150 words or without "Different Worlds by Hilads";
- not 5 to 8 hashtags;
- a flag with no image;
- a slide without a photo, or a photo that can't be downloaded (the slide gets a plain background);
- a credit over 90 characters.

## hilads.live lines (Settings)

- **`outro_cta`**, default "Compare your city on hilads.live". It sits under the outro's question with the app logo, with "hilads.live" in orange. It is at most half the question's size, and the question ends by 1436 px so the line fits above the 1560 px safe line.
- **`caption_cta`**, default "Compare your city with the world on hilads.live 🌍 (link in bio)".
  - Every caption ends with this line, then the outro question as its last line.
  - The system prompt asks for it (`{{CAPTION_CTA}}`).
  - `DwStudio::fixCaptionEnding` enforces it on import, and when the caption or the question is edited. It removes a question or line already at the end, then adds the two lines.
- **When either line changes**, every version of the topics not marked published follows: the caption ending is fixed and the outro slide is redrawn, keeping its photo. The "Apply to unpublished packages" button does the same on demand.
- Videos are rendered on the Mac: run `npm run worlds -- <date>` again after a change.

## Slides (src/DwSlides.php)

- The photo covers the top 1080 px. It is cropped to a square from the centre, so the subject should be centred.
- The credit sits small under the pill.
- The "DIFFERENT WORLDS by Hilads" pill sits over the bottom of the illustration.
- The text block runs from 1120 to 1560 px, with a 72 px left margin and a 170 px right margin. It's set in Be Vietnam Pro ExtraBold at the biggest size that fits.
- Below 1560 px is left empty for the apps' captions and buttons.
- Country slides show a Twemoji flag (`backend/api/assets/flags`, CC-BY 4.0) and the country name in gold.
- The outro has a "YOUR TURN" label, the question, then the hilads.live line (`assets/logo.svg`, the app icon without its animation).
- Rendering uses `rsvg-convert` (librsvg2-bin, in the Dockerfile). Emoji inside on-screen texts are dropped, because there's no emoji font in the renderer.
- Photos come only from upload.wikimedia.org: downloaded with a User-Agent, at most 25 MB and 40 megapixels, at least 600 px on the short side.
- Drawn SVG illustrations (older packages) are sanitized before rendering. Removed: scripts, images, foreignObject, external hrefs and `url()`, `@import`, event handlers, and text.

## Deploy

- Render: deploy the API, which rebuilds the Docker image with librsvg, the zip extension and the fonts.
- Then run `php migrate.php`.
  - It creates the `dw_*` tables, the settings row and the 2026 calendar (seeded only into an empty calendar).
  - It adds `dw_slides.photo_url` and `dw_packages.video_url`.
  - It switches the seeded prompts to photos, unless they were edited. The system prompt also gets the caption ending and the reworded Phase 1.
  - It adds `dw_settings.outro_cta` and `caption_cta`.
  - It adds the humor rule after the tone line of the system prompt (edits around it are kept).
  - Once (`dw_settings.calendar_rev` 2): every topic from Nov 1, 2026 not published is replaced by the funnier calendar of `DwSeed::TOPICS` (title, fun angle in the notes, type, date check). Their packages go with them; their R2 files stay.
- No new environment variable: the slides use the existing R2 settings, and the video uses the Daily promo's `PROMO_TOKEN`.
