# V3 polish pass: Phase 0 audit (2026-10-29)

Read-only audit of Today, Compare, Map, Hi and Passport in the mobile app (`apps/mobile`), with the backend endpoints they use (`backend/api`, the "monolith" of the brief). Paths are relative to `apps/mobile` unless they start with `backend/` or `apps/web/`.

## 0. Ground rules found in the code

| Brief rule | What the app has | Decision for this pass |
| --- | --- | --- |
| `react-native-size-matters` for sizing | Not installed. `src/scaling.ts` (loaded first in `index.js`) patches `StyleSheet.create`: on narrow phones it shrinks fontSize, lineHeight, padding, margin and gap (`SCREEN_SCALE = clamp(short/457, 0.78, 1)`), and maps fontWeight to the Be Vietnam Pro family. Inline and Reanimated styles are not scaled. | Keep `scaling.ts`; size-matters on top would scale twice. New styles go through `StyleSheet.create` (or `useThemedStyles`), never inline sizes. |
| `ThemeContext` for colors | `src/context/ThemeContext.tsx`: `useTheme()`, `useThemedStyles(makeStyles)`, `ThemeOverride`. Tokens in `src/constants.ts` (`Colors` dark, `LightColors`). Daily theme colors: `THEME_COLORS` / `themeColor(key)` in `src/ui/joy.tsx` (`fill`, `onFill`, `textLight`, `textDark`, `line`). Icons: `src/ui/ThemeIcon.tsx`. | Every change checked in **light, dark and Halloween** (`SeasonalScope` re-colors Today with `HALLOWEEN_COLORS`, `src/features/event/seasonal.ts`). |
| Animations: Reanimated / Lottie / Haptics | `react-native-reanimated` 3.17 and `expo-haptics` are installed and used. **No Lottie.** Reduce motion is read three ways: Reanimated `useReducedMotion`, `src/hooks/useReducedMotion.ts`, inline `AccessibilityInfo`. | Reanimated + Haptics only; use `src/hooks/useReducedMotion.ts` or Reanimated's hook. Confetti exists in `src/ui/joy.tsx`. |
| i18n: 19 locales | `src/i18n/locales/{19}/` × 19 namespaces, bundled in `src/i18n/index.ts`, English fallback. Web has its own copy in `apps/web/src/i18n/locales`. | Every new key in the 19 locales (and in web if the web gets the change). |
| Theme names | The brief lists "Wed Join in". The Wednesday theme is now **Get around** (`get_around`, Themes v2). Theme names are localized today (`common:themes.*`). | Use `themeName(key)` everywhere; no theme name hard-coded. |
| No OTA | Mobile changes ship only with a store build (UpdateGate forces updates). | Each phase is in the next store build. |

## 1. Today (`app/(tabs)/today.tsx`)

One data call, `useDailyToday` → `GET /daily/today` (reload on focus, app active, drop, countdown end; pull-to-refresh). Blocks, top to bottom:

| Block | Component | Data | Brief phase |
| --- | --- | --- | --- |
| Header: logo, city/World pill, bell or Sign up | `src/features/shell/AppHeader.tsx`, `ScopeSelector.tsx` | AppContext | 1 (inline hint when here ≠ selected) |
| Tagline "Play local. Compare global." | `src/features/today/BrandLine.tsx` | static | keep |
| Hero card | `src/features/today/TodayTicket.tsx` | `/daily/today` | 1.1 |
| ├ theme chip, "Xh Ym left" | TodayTicket l.243-257 | `challenge.theme`, `secondsLeft` | keep |
| ├ headline | l.222, `numberOfLines={3}` | `headline || text`; **`subtitle` is never shown in the app** | 1.1: headline + subtitle (the full ask) |
| ├ "First photos coming in" / world ticker + "Compare >" | l.262-274, `WorldLive.tsx` | `data.world.countries >= 2` | 1.1: live city strip |
| ├ CTA "Play for {city}" | `PulseButton.tsx` (has pulse rings, press haptic, reduce motion) | label priority l.227-230 | 1.1 |
| ├ "Not in {city}? Change" | l.287-293 | `here` | 1.1: remove, hint in the selector |
| └ How it works sheet | `HowItWorksSheet.tsx`, AsyncStorage `hilads_how_it_works_seen` | first CTA tap | 1.1: the 3-step strip replaces / complements it |
| Halloween teaser banner | `SeasonalTeaser` in `src/features/event/SeasonalArt.tsx` | `data.event`, phase `teaser` | 1.2 |
| Stories row + mosaic ("Same challenge. Different worlds.") | `src/features/today/TodayCountries.tsx` | `GET /daily/today/countries` | 2 |
| Yesterday card | `src/features/tour/TodayTour.tsx` | `GET /daily/tour` | 3.2 |
| Streak, tomorrow, week strip, All past challenges, Propose, Local Twist row | `src/features/today/TodayWeek.tsx` | `/daily/today` streak + `GET /daily/calendar` | 3.1, 3.2, 3.3 |
| "The world, compared" carousel (Index) | `src/features/index/IndexCarousel.tsx` | `GET /daily/compared?scope=week` | **not in the brief's final order**: see open questions |
| Spots near you | `src/features/today/SpotsNear.tsx` | `GET /spots/near` | 3.4 |
| Stamp celebration (overlay) | `StampCelebration.tsx` | `data.localPass` | 7 |

**The contradiction** ("First photos coming in" vs "Nobody has played yet today") comes from two sources: the hero reads `/daily/today` `world.countries >= 2`, the section reads `/daily/today/countries` `items.length`. With one country played, the hero says "first photos" while the mosaic shows a tile. Fix: both read the same city list.

**Dead code in TodayTicket** (to remove in Phase 1): `twist`, `earlyUntil`, `emptyCity`, `cityStreak`, `emptyThere`, `answers`, the compare `tip` (flag written, never shown), unused `ShareSheet` / `Cover` / `Perforation` imports, leftover styles. "Daily Challenge" is hard-coded English (brand term, fine).

**Local flags (AsyncStorage)**: `hilads_how_it_works_seen`, `hilads_compare_tip_seen`, `hilads_daily_first_proof_done` (set after the first photo; the "has played once" flag for 1.1), `hilads_seen_proofs_v1` (story rings), `hilads_stamps_v2_{user}_{city}`.

## 2. Compare

- **Grouped by country, not by city.** `GET /daily/today/countries` (`backend/api/routes/api.php` ~14765, `DailyProofRepository::countryRows` + `groupByCountry`) returns one item per country: `{country, city (the top photo's city), count (photos in the country), latestAt, unseen, ids[], top: DailyProof}`. Several cities of one country collapse into one bubble and one tile; the Saigon "2 photos by 2 people" case shows as one card with nothing to say so.
- **No per-city** photo_count, author_count, authors[] or total_likes anywhere. `countryRows` already loads every photo's `user_id`, `city_id`, `city_name`, `vote_count` in one cached query (15 s), so a `groupByCity` costs no new SQL; authors need `username`, `display_name`, `profile_photo_url` added to that select; the city tops come from one `rowsByIds` call, as the country tops do.
- **Stories row** (`TodayCountries.tsx` l.108-135): one circle per country (flag + city), theme-colored ring while unseen, a last "+ Your city" circle; order: my country, unseen, latest. Title `countries.played` "N countries played today".
- **Mosaic** (l.137-161): up to 6 tiles, "See all" → `app/daily/countries.tsx` (By country / Top 10). "Represent your city" tile fills an odd grid, else a banner.
- **Viewers**: `app/daily/photos.tsx` is the full-screen vertical swipe (avatar, name, Local Pass badge, city, answer chip, caption, heart + double-tap vote with burst, voters, share, preload, end slide "Your turn"); story mode `?country=` = that country's photos then the next countries. **No auto-advance, no progress bar.** `app/daily/tour.tsx` (yesterday) has auto-advance + progress bar + hold-to-pause + reduce motion: the model for 2.1.
- **Seen**: `src/features/daily/seen.ts` (AsyncStorage, 600 ids) + `POST /daily/proofs/seen` → `daily_proof_views` for members; `group.unseen` from the server.
- **Challenge sheet tabs** (Compare / World / city / Top 10) were removed on 2026-10-23 (cf272df7), but `/daily/today?tab=compare` is still pushed by `app/daily/proof.tsx:426`, `TodayTicket.tsx:138`, `NotificationHandler.tsx:349,353` (the param is ignored).
- **Web** mirrors it: `apps/web/src/components/today/TodayCountries.jsx`, `daily/PhotosScreen.jsx`, `daily/CountriesScreen.jsx`, `daily/seen.js`, `countryOrder.js`.

**Backend change for Phase 2** (smallest): `GET /daily/today/countries` gains `cities[]` (one per city: `city {id,name,country}`, `photoCount`, `authorCount`, `authors[≤3] {id, username, photoUrl}`, `totalLikes`, `ids[]`, `top`), computed in PHP from `countryRows`; `items[]` stays as is for old apps and the web. Story viewer: `photos.tsx` gets `?city=` beside `?country=`.

## 3. Map (`app/(tabs)/map.tsx`, Mapbox `@rnmapbox/maps`)

- Clusters: Mapbox native clustering (`clusterRadius 44`, max zoom 15), a brown `primaryOnTint` circle + white count. Tap zooms in.
- Pins: CircleLayer radius 11, `gold` for picks else `primary`: **not colored by theme**; picks get a white ★. Labels and round photos from zoom 13.5. The selected spot is a `MarkerView` with the `ThemeIcon` of `themes[0]` (`themes[]` comes from `string_agg(DISTINCT)`: order not meaningful).
- Filter chips: All + 7 `PLACE_THEMES`, today's theme badged "today" (lowercase); selected = `primary` for every theme (`src/ui/Chip.tsx`).
- Header: absolute block, subtitle pill `common:subtitles.map` "Spots from the world's photos." over the map, then ScopeSelector + search. Placeholder `daily:map.search` "Search a dish, a café, a street" (no ellipsis in the string: it is truncated on screen).
- Plan pills (`PlanMarker`): "{title}, {time}", weekday when not today; `participantCount` is in the payload but **not shown**.
- Spot sheet (`src/features/map/SpotSheet.tsx`): photo, name, pick badge, theme, distance, price, pioneer chip, "Validated by a local", counts, caption, credit, Open spot / Directions / Share. No "Play here today".
- No pin animation. Up to 300 spots (`Spots::PIN_LIMIT`, `truncated` ignored), 300 pin images, 30 plan MarkerViews, 150 world MarkerViews; refetch on every idle (400 ms debounce).
- Data: `GET /map` `{spots, truncated, plans, city}`; a spot has `themes[]`, `lastProofDate` (max challenge date) but **no "is today's challenge" flag** ("Today" filter: `lastProofDate === today` is enough, or a `today` param on `/map`).

## 4. Hi (`app/(tabs)/chat.tsx`)

- **Pin bar overlap**: `src/features/daily/DailyPinBar.tsx` is in normal flow (not absolute), but the list has an absolute 18 px `topFade` of the background color right under it, and the bar has no bottom margin: the first card's top is painted over. Fix: a gap under the bar / move the fade.
- The bar nests a "Take it" button inside a pressable bar (two stacked tap targets). Stale comment l.922.
- Daily message in the feed: `DailyChannelCard.tsx` l.84-139, no sender (flame + "Daily Challenge" kicker), duplicates the pin bar in a city.
- Plan chips (`src/features/chat/PeopleRow.tsx`, `GET /channels/{id}/people`): `{title, startsAt, going}`; **no avatars** in the payload.
- Empty chat: `EmptyState` not centered (inverted list without `flexGrow`); rarely visible (injected prompts after 15-30 s).
- Header icons: share = share the city link; paper plane = private messages (`common:messages`, unread dot). Labels exist (`IconButton` → `accessibilityLabel`).
- "+" sheet (`src/features/chat/ShareSheet.tsx`): camera, spot, plan, Hi now; same color for all.
- **Reactions already work end to end** (long press ❤️ 👍 😂 😮 🔥, pills, burst, WebSocket). Nothing to build.

## 5. Passport (`app/(tabs)/passport.tsx`, `src/features/passport/CityPage.tsx`)

- Identity: avatar, @username, "Local / Exploring", the **current** city chip. No home city, member since, photos or likes received (`GET /users/{id}/daily` returns `completed`, `bestProofs`, unused).
- Stamps: same primary color for every theme, fixed rotation, no date, not tappable. Stamp dates are not returned (`DailyLocalPass::forUser` reads `challenge_date` but returns theme keys only).
- **Local Pass is drawn as an 8th cell** of the grid; "of 7" is hard-coded in `me:passport.stamps`.
- Several cities: horizontal pages, with `pagingEnabled` + `snapToInterval` fighting each other.
- "Compared with N countries" (`DailyResults::comparedCountries`) counts Hilads suggestion answers too (`is_suggestion` not excluded).
- My spots, My proposals (pending count only), Friends, all-time rank. **No "My photos", no share card.**

## 6. Copy inconsistencies (en)

- Countries vs cities for the same idea: `countries.played` "N countries played today", `compare.answeredRow` "Already N countries played" (unused), `compare.nCountries` (hero ticker), `recap.cities` "N cities played", `represent.board` "N cities are on today's board", `compare.boardCount` "Cities: N · Countries: M", `me:passport.compared` "Compared with N countries". → **cities** everywhere.
- `countries.openCountry` / `byCountry` keys hold city wording next to `countries.yourCity`.
- "map" used for the board: `countries.emptyBody` "Put your city on the map first!", `represent.mapEmpty`.
- `map.today` lowercase chip badge; `map.search` truncated; `me:passport.pageA11y` without plural; `me:passport.stamps` hard-codes 7.
- `common:subtitles.map` "Spots from the world's photos." while the map opens on the city.

## 7. Decisions (2026-10-29)

- **App first, web after**: the 7 phases change the app only; the web is ported in a second pass.
- **Screenshots** on the iOS simulator against a local backend (`.env.local` swapped during the work, then restored).
- **"The world, compared"** (Index carousel) stays on Today, after Yesterday.

## 8. Risks

- **Old apps**: every backend change is additive (new fields, new params); clients fall back when a field is absent.
- **Web parity**: the web mirrors the app (W1–W5). Phases 1-3 change Today's structure; the web keeps the current Today until it is ported.
- **Map performance**: photo-stack clusters mean more images; keep colored clusters above a count, MarkerViews capped.
- **Screenshots** need a simulator; `apps/mobile/.env.local` points at the production API, so a local backend must be swapped in first.
- **Halloween is live on Oct 31**: Today's hero and teaser change palette that day; Phase 1 must be checked with the seasonal theme on.
