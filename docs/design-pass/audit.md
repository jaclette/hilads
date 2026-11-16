# Design pass – audit (before)

Shots: `docs/design-pass/before/` — `<device>-<theme>-<screen>.png` for the app on a small phone (iPhone SE, where `src/scaling.ts` shrinks everything ×0.84) and a large one (6.9″), light and dark, plus the web app at 390 px. One overview sheet per device/theme: `overview-*.png`. Same demo data as the store screenshots (local stack, `@hilads_review` in Saigon, 13 players, 11 cities). Regenerate: `node scripts/design-pass/shots.mjs --out=docs/design-pass/before`.

Ranked by impact inside each screen. "Both" = app and web.

---

## Across all four tabs (fix once, in Phase 1)

1. **Two spacing systems, three gutters.** `Spacing` (5/9/18/27/36/54) and `Space` (4/8/12/16/24) live side by side. The screen gutter is 18 on Today and Passport, 14 on World's rows (`Spacing.md - 4`), 0 on the podium; scaled ×0.84 on a small phone. Edges never line up from one tab to the next.
2. **Things cross the screen edge.**
   - Today: the first catalogue card, tilted, sits over the gutter.
   - World: the podium blocks run edge to edge.
   - The dark "Play today to get on the board" bar runs edge to edge and covers ranks 4–5 (`small-dark-world-photos`).
   - Map: the filter chips are cut at the right edge. That's fine for a scroller, but they have no fade.
3. **Ten font sizes, ad hoc weights.** `FontSizes` has 10 steps and screens add their own: 26 title, 40 hero, 11 badges. Row titles are cut mid-word: "Find a juice or smoothie stan…" on every World row.
4. **Eight radii, flat cards.** 6/10/16/18/22/full plus local values (8, 12, 14). Cards are bordered, with no elevation. The hero has a heavy dark shadow; nothing else has any.
5. **The selected state changes per tab.** The tab bar is peach for Today/Map/Passport and gold for World. World's two segmented controls are orange-filled (Photos/Players/Cities) on top of yellow-filled (Today/Week/All time). Map's "All" is terracotta-filled. Four different "selected" looks.
6. **Medal colors are dull.**
   - Light: silver `#7E8A97` (grey), gold `#B98A2E` (mustard), bronze `#A0643A` (brown).
   - Dark: big flat blocks.
   - The podium reads as a bar chart, not a prize.
7. **Emoji and line icons are mixed in the same role.**
   - Hearts: ❤️ emoji in World rows and podium counts, outline ♡ on Today's tiles.
   - The crown 👑 is an emoji. Copy ends in 🙋 🏁 👆 📍 🌍.
   - Ionicons outline is used elsewhere: tabs, chips, segments.
8. **Avatars have three looks.**
   - Photo.
   - A letter on peach (M, K, N on Today tiles, ~20 px).
   - A letter in a big outlined circle (Passport "H", 56 px).
   - World rows mix a letter in a colored square with tiny photos.
9. **Primary actions have three looks.**
   - A white button on the dark hero ("Snap it for Saigon").
   - Tangerine with white text ("Share my passport").
   - The dark ink bar ("Play today to get on the board"), which turns into a light pill in dark mode.
10. **No press feedback.** `TouchableOpacity` only fades its opacity. There's no scale and no haptic on cards, tiles or rows.

---

## Today

1. **The catalogue edges are ragged.** Tilted cards (±2°) plus a gold border on the first one make the grid look unfinished at the edges, and the first card crosses the gutter. The 2-column idea works and the photos carry it.
2. **The lower half reads like a settings screen.** Under the catalogue:
   - a "Swipe to travel 🌍" hint, then a "Say hi to your city. Join a plan." list row;
   - then the streak card. Its week dots are faint dashed outlines, "Tomorrow: Taste" sits in orange top right, and "All past challenges" is a link row.
   - Three different card styles stacked in a column.
3. **The hero is the strongest element, but it fights the header.** The logo, city pill and bell, then the "hilads Play local. Compare global." line, take about 110 pt before the hero starts. On a small phone, the hero and the "11 cities played today" title are all you see.
4. **Catalogue tile footers look unfinished.**
   - The 20 px letter avatar ("M", "K", "N") on a cream disc, with counts on the right.
   - City names use small flags plus a bold title. Titles wrap to 2 lines unevenly, so tiles in the same row have different heights.
5. **To remove (brief): the "Represent your city" tile.** It's the slot tile in `TodayCountries` (`represent-tile`), shown when you haven't played today. The demo account has played, so it isn't in these shots.

## World

1. **The podium.** Flat grey/mustard/brown blocks, edge to edge, numbers in black. The crown emoji sits on the photo. The prize moment of the app looks like a chart.
2. **The rank rows repeat themselves.** On a "Today" board every row says "Find a juice or smoothie stan…" plus a "Drinks" chip, because it's the same challenge for everyone. Only the photo, the player and the score differ. The score pill "8 ❤️ · 0 💬" mixes emoji, with a comment count of 0 everywhere.
3. **Two segmented controls in two styles**, stacked, with a "13 hours left to vote" line squeezed under them. That's 3 rows of controls before any content.
4. **The empty board is dull** (Players · Week, `world-players`): a trophy emoji, one line of text and 60% empty screen.
5. **Cities is dense.** In each row: the flag, the "3 players · 25 ❤️" line, a "new" label, a "3 photos" pill and a progress bar, five signals. The "Saigon leads the race! 🏁" banner is a yellow strip that looks like a warning.
6. **The "Play today to get on the board 🙋" bar** floats over the list (see "Across" #2 and #9).

## Map

1. **The map itself is good:** theme-colored pins and clusters, the orange wave sheet. This tab is the most finished.
2. **The sheet header mixes emoji and type.** "📍 10 spots to explore / swipe up 👆", with a photo stack on the left and a chevron button on the right: four ideas in one strip.
3. **The open sheet's rows** stack:
   - title, theme chip and a green "✓ Validated by a local" chip;
   - "45k ♥ 0 @hilads_review".
   Chips use three different fills, and the metadata line has no hierarchy.
4. **The filters** "All / Plans / Today / Hidden gem…": "All" is solid terracotta, the others are white outlines with mixed icons (a cup for Today?). Selected doesn't match World's segments.
5. **"Surprise me"** is a dark pill floating bottom right, with a dice emoji. In dark mode it becomes a light pill, which is the inverted rule again.

## Passport

1. **The bottom half is an admin list.** Two plain cards of rows: Notifications/Messages, then My photos (7), My spots (7), My proposals, Propose a challenge (the only row with an icon), Friends (0), Most Local all time (#4). This is exactly "the admin dashboard" feeling, and it's what you see after scrolling past the stamps.
2. **The two stat cards are uneven.** "7-day streak" is one line, "No rank yet this week" wraps to 2–3 lines, so the cards don't balance. There are no numbers, only words.
3. **The identity block is small for a passport.** The 56 px outlined "H", the handle, a green "Local" chip plus a Saigon chip, and a tiny "1 city 7 photos 0 likes" line that has no visual weight.
4. **The stamps are the best part, but under-sized.** 4 per row; labels like "Only in Saigon" wrap to 3 lines; dates are muted and tiny. The Local Pass card (gold outline) is good but appears twice when you scroll (top of the list section on the small phone).
5. **The header art** (a faint stamp outline behind the settings gear) is barely visible in light mode and invisible in dark.

## Web (parity)

- Same structure, same issues. Plus:
  - The header carries an extra paper-plane button (messages).
  - `/world` always opens on Players · Week, whatever the URL says.
  - The map uses raster OSM tiles (another look than the app's vector map). That's out of scope for a design pass, but visible.
- Web's tab bar uses the peach highlight on every tab (only the app has World in gold).

## Small phone (SE)

- `scaling.ts` keeps everything proportional and nothing breaks. Density is the issue:
  - Today shows the hero only.
  - World shows controls plus the podium.
  - The Passport stamps' labels wrap more.
- The "Play today" bar covers about 1.5 rows of content.

---

## Decisions (answered 2026-11-16)

All four recommendations taken: keep `scaling.ts` (no size-matters), peach selected state everywhere (gold = prizes only), drop the repeated challenge title on one-challenge World boards, icons in UI chrome and emoji only in voice.

### The questions as asked

1. **`react-native-size-matters`.** The brief asks for it, but the app already scales every StyleSheet for narrow phones in `src/scaling.ts` (×0.80–1, installed before expo-router). Adding size-matters on top would scale twice. **Recommendation:** keep `scaling.ts`, and add no new dependency.
2. **The tab bar's gold highlight on World** (`_layout.tsx`, deliberate). One selected color everywhere (peach) is what Phase 1 implies. **Recommendation:** peach everywhere, and keep gold for prizes only.
3. **Repeated challenge titles in World's photo rows** (Today/Yesterday boards, one challenge). Hiding the title when every row shares it is a content change, not just design. **Recommendation:** show the place or caption instead, and keep the title on Week/All time.
4. **Emoji in copy** (🙋 🏁 👆 📍 🌍 ❤️ 👑). These live in the 19 locale files. **Recommendation:** replace them with icons in UI chrome (hearts, crown, pins). Keep emoji only where they're the voice of a sentence. That touches translations, with keys unchanged.

---

## Results (2026-11-16, branch `design-pass`, not pushed)

One commit per step, each with app and web together. Before / after shots are in `docs/design-pass/after/<step>/`, with side-by-side sheets in `docs/design-pass/compare-*.png`.

| Step | Commit | What changed |
|---|---|---|
| Phase 1, design system | 3f295a07 | Tokens (spacing, type, radius, elevation, motion, icon sizes, selected, medals), Tappable, Badge, BottomBar, one avatar fallback; see `design-system.md` |
| Today | 20a4f5a4 | Display hero title, square 2-column catalogue with even 2-line titles, no "Represent your city" tile, the week card on the shared card |
| World | 72aae48f | Podium inside the gutter on saturated medals with a drawn crown, one-challenge rows lead with the player, icon score pill, peach periods, tangerine "You" bar, trophy empty state |
| Map | aa361ba6 | Sheet head on the type roles without emoji, "Surprise me" on the floating surface with a dice icon, theme chips in their own colors, floating buttons on the gutter |
| Passport | 02fa7579 | 72 avatar and a stat strip, equal streak and rank cards with icon discs, the menu in theme-colored discs, the city page on the hero card |

### Still open

**Clean-up, not decided here:**
- The i18n keys of the removed tile: `mosaic.slotCta`, `mosaic.missing`, `mosaic.beFirstSub`, `countries.represent`, and the seasonal `copy.represent`. They're unused now, in app and web.

**Not covered by the shots:**
- The Halloween palette got its own selected pair, but the event is off on the local stack, so it wasn't seen.
- Android was not shot in this pass; the shared code is the same.

**Long strings and diacritics:** checked on the small phone in Vietnamese and German (`after/locales/`, `compare-locales.png`). Nothing is cut or overflows.

**Bug found, not from this pass:**
- In Vietnamese, a count of 1 falls back to English ("1 city", "1 photo", "1 player") while other counts are translated ("7 ảnh"). Vietnamese has only the `other` plural form, so a `_one` lookup ends in the English fallback. Worth a look in the i18n config.

**Seen but left as is:**
- Today's header (logo row plus brand line, about 110 pt before the hero).
- Web `/world` ignores a `tab` in the URL.
- The web header's extra messages button.
- The web map's raster tiles.
