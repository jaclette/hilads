# Share card redo: audit (2026-10-29)

## What exists

- **App** `src/features/share/`:
  - `ShareCard`: one 9:16 card per content type (`proof`, `spot`, `today`, `passport`, `index`), designed on a 360×640 canvas and laid out at 1080×1920 px.
    - The photo is full-bleed under a dark gradient.
    - The bottom block holds the kicker, the challenge, the city and @username, and the footer (logo, "Same challenge. Different worlds.", hilads.live).
    - Halloween variant: a tilted polaroid on the event's ground with `EventFrame`.
  - `SharePanel`: the scaled preview, captured with view-shot once the images load.
  - `targets.ts`, with `react-native-share`:
    - Instagram / Facebook Story (iOS Stories intent with `backgroundImage` + `attributionURL`; Android sends a plain image to the app).
    - WhatsApp, Messenger, Telegram and X send the link.
    - Copy link, and More (the system share sheet).
  - The link is copied before a Story, with an Alert tip once per phone.
  - Analytics: `share_started`, `share_completed {channel, content_type, source}`.
- **Links** `content.ts`: `hilads.live[/locale]/p/{proofId}` (proof), `/s/{id}`, `/d/{date}`, `/today`, plus `utm_source={channel}&utm_medium=share`. With the app installed they open it (Universal / App Links). Otherwise `apps/web/api/share-page.mjs` serves a light landing page:
  - the photo, the challenge, the city and the author;
  - Open in app / App Store / Google Play / Play on the web;
  - PostHog `link_opened`, `link_cta`;
  - CDN-cached per path.
- **Sources** of a proof share: after posting (`proof.tsx`), the proof viewer, Today's photos, the World tour.
- **Challenge copy**: `text_i18n`, `context_i18n`, `headline_i18n`, `subtitle_i18n`, `compare_question_i18n` (JSONB `{locale: text}`), edited in Admin › Daily › challenge. There is no share question yet.
- Native modules already in the binary: react-native-share, expo-clipboard, expo-media-library (`NSPhotoLibraryAddUsageDescription`), view-shot, reanimated, svg, expo-haptics. **Nothing new is needed.**

## Plan

| Phase | Adds |
| --- | --- |
| 1 Templates | for my photo, 3 swipeable templates: **A "Your turn"** (my polaroid + an empty dashed polaroid with a big "?"), **B "Versus"** (my photo against other cities' photos of the same challenge, today only), **C "Result"** (my photo, rank / votes, my answer). 9:16 full canvas, theme-colored ground with doodles, undarkened tilted polaroid with the selfie inset, the question big, Stories safe zones (top 250 px, bottom 340 px of 1920). Admin field `share_question` per challenge (translated), fallback "What's YOUR city's answer?". Other content types keep their card |
| 2 Deep link | the existing `/p/{id}` link (no new route) + `from=<username>&city=<city>`: the landing shows "@from played for City" and the share question, PostHog `share_link_visit` / `share_link_install_click`; app events `share_opened`, `share_template_selected`, `share_target`, `share_completed` |
| 3 Targets | Story intent unchanged (no new native code), link copied + toast "Link copied 🔗 Add it with the Link sticker", a 4:5 1080×1350 "Post" version, prefilled text with the question, Save image |
| 4 Playful | cards slide in, the "?" wiggles (paused during capture), haptic on swipe, "Shared! Let's see who answers 🌍", event-mode ground on templates |
| 5 QA | local checks, docs |

## Decisions

- **Link format kept** (`/p/{proofId}`, the brief's "or existing format"). It already opens the app, has a landing page, OG card and locale prefixes. `from` and `city` are read client-side on the landing page, so the CDN copy stays one per path.
- **Versus needs other cities' photos of the same day**: `GET /daily/today/proofs?scope=cities` (one per city). For a past photo, B isn't offered (A and C still are).
- **Captures on demand**: each template is rendered once in the swipeable preview and captured when a target needs it (cached per template and format). The 4:5 version is rendered only for the selected template.
- **EAS Update compatible**: JS, assets and the backend only. The admin field needs a migration (`php migrate.php`). Because expo-updates isn't in a store build yet, this still ships with the next store build.

## QA (local, 2026-10-29, iPhone 17 Pro simulator, local API)

| Check | Result |
| --- | --- |
| Share question set (en + fr) | `challenge.shareQuestion` in the viewer's language on `/daily/today` and `/daily/proofs/{id}/share`; empty means `null`, and the card falls back to "What's YOUR city's answer?" |
| Your turn / Versus / Result | swipe and tap both work; Versus shows today's photos from other cities (one per city) and is skipped for a past photo; nothing that matters sits in the Stories' top 250 / bottom 340 px |
| Capture | system share sheet gets a 1080×1920 JPEG (≈270 KB); Save image in Post gives 1080×1350; a non-photo card (today) still saves at 1080×1920 |
| Event mode | with Halloween live, the templates use the night-purple ground with cobwebs and the pumpkin |
| Link | `…/p/{id}?from=lan&city=London&tpl=turn&utm_source=…&utm_medium=share`; opening it in the app logs `link_opened` with from / template, plus `share_link_visit {source: app}` |
| Landing page | "@lan played for London" over the share question (19 locales, server-rendered question, browser-read `from`), photo capped so the buttons stay near the fold; inline script syntax-checked |
| Analytics | `share_started`, `share_opened`, `share_template_selected {template, method}`, `share_target {channel, template, format}`, `share_completed {…, format}` seen in the app log |
| tsc / phpunit / web eslint | 22 (baseline) / OK / clean |

Not checkable in the simulator, so these are in the device checklist: the Instagram / Facebook Story handoff with the toast, the "Shared!" toast when coming back from another app, haptics, and the Link sticker paste.

## Device checklist (TestFlight / internal testing)

1. Post a photo, then Share. Swipe through the three cards; each swipe gives a tick, the "?" wiggles, and Versus appears once other cities have played today.
2. Instagram Story: the toast "Link copied 🔗…" shows, then Instagram opens with the 9:16 card. Add the Link sticker, paste, post. Back in Hilads: "Shared! Let's see who answers 🌍".
3. Switch to Post, then More → Instagram feed or Save image: the photo is 4:5 in Photos (the first save asks for add-only access).
4. WhatsApp / Telegram / X: the line asks the share question and the link preview shows the photo.
5. On a phone without Hilads, open the shared link: you see "@you played for City", the question, and Open / store buttons. Tap a store button (PostHog: `share_link_visit`, `share_link_install_click`).
6. With Hilads installed, the link opens the photo in the app.
7. Reduce Motion on: the cards fade in instead of sliding and the "?" stays still.
8. Arabic: card text right-aligned, polaroids unchanged.
9. A photo from a past day: no Versus.
10. Halloween live: the cards use the Halloween ground.
