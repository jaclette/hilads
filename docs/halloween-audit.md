# Halloween event mode: audit (2026-10-29)

Halloween 2026 = the Oct 31 **Special** challenge ("Every city, one spooky photo"). A seasonal event system already exists (built 2026-10-26); this pass extends it into a reusable **event mode** instead of adding a second one.

## What exists

- **Backend** `SeasonalEvents` (`backend/api/src/SeasonalEvents.php`): a JSON list in `app_settings.seasonal_events` (`{id, name, theme, teaserStart, start, end, previewUsers[], previewPhase}`), edited in **Admin › Daily › Seasonal events** (`admin/daily_events.php`). Phases on **challenge dates** (DailyClock, the global 02:00 UTC drop), not device calendars: teaser (`teaserStart ≤ date < start`), live (`start..end`), recap (`end + 1`). Sent as `event` by `GET /daily/today` only (null on error). Preview: usernames in `previewUsers` see `previewPhase` now. Settings cached 60 s.
- **Special challenge** `DailySpecials` (`halloween`, emoji 🎃, icon skull) with localized names, a bundled cover (`covers.ts`), special stamps (`DailySpecials::stampsFor`, `SpecialStamps.tsx`, gold), excluded from the 7-theme Local Pass. Old apps get the Special challenge, its cover and translated copy through this path: unchanged here.
- **App** `src/features/event/seasonal.ts` (store fed by `/daily/today`, `useSeasonal` / `useSeasonalLive`, `HALLOWEEN_COLORS` full palette, copy keys `event.halloween.*`, `__DEV__` preview in the debug panel) and `SeasonalArt.tsx` (`SeasonalScope` palette over the tabs and Daily screens, `LogoHat`, hero ghosts and cobwebs, `SeasonalTeaser` 3 days before, `BatBurst` after posting, `TabGhost`, pumpkin Today tab icon, `SeasonalMapSky`, `FlyingBat`). Motion only when visible and without Reduce Motion.
- **Web** `components/event/seasonal.jsx` + `html[data-event="halloween"]` CSS variables, same pieces (no camera).
- Not seasonal today: the streak flame, the post-celebration copy, stamps' look, the share card, map pins / filter chips, chat quick-start chips, the Daily feed card accent, push copy (specials have an emoji and a name, no push text).
- Native modules present: react-native-view-shot 4.0.3, reanimated 3.17, react-native-svg 15.11, expo-image-manipulator, expo-sharing, expo-media-library. **No** react-native-gesture-handler (PanResponder everywhere), no Lottie, no Skia. Backend `DAILY_FAKE_NOW` freezes the Daily clock (dev only).

## What each phase adds

| Phase | Adds |
| --- | --- |
| 1 Event mode | per-event `enabled` (kill switch) and feature toggles (`skin`, `stickers`, `stamp`, `shareFrame`, `mapPins`, `chatChips`, `ambient`), optional remote sticker pack URLs (bundled pack as fallback), sent with `event` on `/daily/today` and `/app/config`; app `useEventFeature()`; the dev preview gains before / during / after |
| 2 Skin | gated on `skin`: jack-o'-lantern streak, "🎃 Halloween" hero chip, "Snap something spooky for [City]" CTA, candy + pumpkins in the burst, "[City] is haunting the board! 👻" |
| 3 Stickers | a sticker step after the photo (and on the selfie with dual photo): 13 stickers + 2 frames (SVG, ours), tap to add, drag / pinch / rotate (PanResponder), trash, max 10, Spookify me 🎲, baked with view-shot at the upload size |
| 4 Stamp | the special day's stamp drawn as a limited-edition stamp (orange / purple ink, its own shape), earned animation after posting; the 7-theme count unchanged |
| 5 Share frame | a pluggable `EventFrame` on the share card for photos of the event's days |
| 6 Ambient / map / chat / push | bats over the Today hero and the celebration, pumpkin pins and a "🎃 Halloween" chip on the map, Halloween chat chips, the feed card's accent, the special's push copy |
| 7 QA | local checks, kill switch, toggles, server down |

## Decisions

- **Dates stay challenge dates** (as chosen on 2026-10-26): the event follows the challenge on screen in every timezone; the Oct 31 challenge itself runs from its drop to the next drop.
- **No new native module**: view-shot, svg and reanimated cover stickers, frames and bats; gestures with PanResponder (two-finger pinch / rotate computed from the touches).
- **Server failure** → `event` null → the app's normal look (existing behavior); `enabled: false` hides an event at the next refresh.
- Web: the skin already mirrors the app; the web gets the map chip, chat chips and stamp look where it shows them (no capture, no stickers).
