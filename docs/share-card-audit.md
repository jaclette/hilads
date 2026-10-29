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
