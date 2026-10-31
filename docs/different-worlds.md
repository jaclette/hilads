# Different Worlds by Hilads (Admin › Worlds)

A daily short video series (TikTok, Reels, Shorts): one topic, 6 to 8 countries, real sourced facts. Silent slides are assembled in CapCut, with music added when publishing.

## How a day is made

1. **Brief**: Admin › 🌍 Worlds › "Download brief (14 days)" gives the settings and the next topics:
   - the system prompt, with the phase and the always-included countries filled in;
   - the illustration prompt and the visual style.
2. **Prepare** the packages in Claude Code. No API key is needed and no AI call happens on the server.
   - Research each fact with web search and give one source per country.
   - Write the JSON of the system prompt's schema.
   - Draw one SVG per slide with the illustration prompt, and put it in `"illustration_svg"` next to each `"illustration_brief"`.
   - Files go in `docs/worlds/<date>.json`, an untracked folder like `docs/daily-challenge/`.
3. **Check** the slides locally before importing:
   ```
   docker build -t hilads-api-dw backend/api
   docker run --rm -v "$PWD/docs/worlds:/pk:ro" -v /tmp/out:/out hilads-api-dw \
     php scripts/dw_render.php /pk/2026-10-31.json /out
   ```
4. **Import** it: Admin › Worlds › "Import packages", or the topic page.
   - Each import is a new version of the day's topic.
   - The server sanitizes the SVGs, composes the 1080×1920 slides and stores them on R2 under `dw/<topic>/v<n>/`.
5. **Edit and publish**:
   - Every text field can be edited inline. An on-screen text redraws its slide and keeps the illustration.
   - "Replace illustration" swaps one slide's SVG; an empty SVG gives the plain background.
   - "Download all slides (ZIP)" gives `01_hook.png … 09_outro.png`.
   - "Copy full caption" gives the caption, the hashtags and the AI disclosure.
   - Mark ready, then mark published with the three platform links.

## File format

```json
{"packages": [{"date": "2026-10-31", "model": "Claude Opus 5.5 (Claude Code)", "content": {
  "topic": "…", "why_today": "…",
  "hook": {"on_screen_text": "…", "illustration_brief": "…", "illustration_svg": "<svg …>"},
  "slides": [{"country": "Vietnam", "flag": "🇻🇳", "on_screen_text": "…", "caption_detail": "…",
              "illustration_brief": "…", "illustration_svg": "<svg …>", "source_url": "https://…"}],
  "outro": {"question": "…", "illustration_brief": "…", "illustration_svg": "<svg …>"},
  "caption": "…", "hashtags": ["#…"], "ai_disclosure": "…", "follow_up_idea": "…", "warnings": ["…"]
}}]}
```

**What blocks an import:**
- a missing field;
- fewer than 6 or more than 8 countries;
- an always-included country missing;
- a country listed twice;
- a source that isn't a URL.

**What gives a warning only:**
- an on-screen text over 12 words;
- a caption over 150 words or without "Different Worlds by Hilads";
- not 5 to 8 hashtags;
- a flag with no image;
- a missing or unusable SVG (the slide gets a plain background).

## Slides (src/DwSlides.php)

- The illustration covers the top 1080 px.
- The "DIFFERENT WORLDS by Hilads" pill sits over the bottom of the illustration.
- The text block runs from 1120 to 1560 px, with a 72 px left margin and a 170 px right margin. It's set in Be Vietnam Pro ExtraBold at the biggest size that fits.
- Below 1560 px is left empty for the apps' captions and buttons.
- Country slides show a Twemoji flag (`backend/api/assets/flags`, CC-BY 4.0) and the country name in gold.
- The outro has a "YOUR TURN" label.
- Rendering uses `rsvg-convert` (librsvg2-bin, in the Dockerfile). Emoji inside on-screen texts are dropped, because there's no emoji font in the renderer.
- Illustrations are sanitized before rendering. Removed: scripts, images, foreignObject, external hrefs and `url()`, `@import`, event handlers, and text.

## Deploy

- Render: deploy the API, which rebuilds the Docker image with librsvg, the zip extension and the fonts.
- Then run `php migrate.php`. It creates the `dw_*` tables, the settings row and the 2026 calendar (seeded only into an empty calendar).
- No new environment variable: the slides use the existing R2 settings.
