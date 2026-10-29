# Dual photo (photo + selfie): Phase 0 audit (2026-10-29)

BeReal-style Daily photo: the photo (back camera) and a selfie (front camera) taken right after, shown as a small inset that swaps on tap. Paths relative to the repo root; `api.php` = `backend/api/routes/api.php`. App first (`apps/mobile`), web after (display only: the web never posts a Daily photo).

## 1. Capture today

- Versions: expo ~53, **expo-camera ~16.1.11** (in the iOS build: `ExpoCamera` in `ios/Podfile.lock`, `NSCameraUsageDescription` set), expo-image-picker ~16.1.4, expo-image-manipulator ~13.1.7. No vision-camera.
- `apps/mobile/app/daily/proof.tsx` (`Step = 'place' | 'photo' | 'answer' | 'details' | 'home'`): **camera only, no gallery** (SPEC 9.4).
  - iOS: `ImagePicker.launchCameraAsync({cameraType: back})`, the system camera UI (no live viewfinder of ours, no way to chain a selfie).
  - Android: `src/features/chat/AndroidCameraCapture.tsx` (`CameraView`, flip, flash, preview Retake / Use photo, resize to width 1920 JPEG 0.78), because `launchCameraAsync` hangs on Android 14 + singleTask.
  - `gotPhoto({uri, mime, remoteUrl})` → place / answer / details; the photo uploads at submit (`uploadFile`, cached `remoteUrl` for retries). Retake from a later step stays there.
- Upload: `POST /api/v1/uploads` (multipart `file`, 10 MB, jpeg/png/webp, ≤6000 px / 40 MP, `ImageProcessor::stripMetadata` re-encodes and drops EXIF, R2 `<32hex>.<ext>` + `thumb_<32hex>.jpg`). Client `uploadFile` downscales to 1600 px JPEG 0.8 first.
- Submit: `POST /daily/proofs` → `DailyProofRepository::validateInput` (`photoUrl` must be our upload, `invalid_photo`) → create → `dailyAfterProofWrite` (**auto-approved**, no image moderation; 3 reports hide a post; admin queue). `PATCH` deletes a replaced photo from R2; `DELETE` deletes the proof and its photo.
- No photo metadata is read anywhere (no EXIF GPS / time); the place check uses the GPS position sent in the body.
- Small local preferences: AsyncStorage keys `hilads_*` (e.g. `hilads_daily_first_proof_done`).

## 2. Where a Daily photo is drawn

Shared `src/ui/Photo.tsx` (`thumb` then `full`, no placeholder of its own). **No width/height stored, no blurhash anywhere**; progressive loading = thumb as `placeholder`.

| Surface | File | Size / tap |
| --- | --- | --- |
| Hi chat post | `src/features/daily/DailyChannelCard.tsx` ProofCard | full width 4:3; tap → photo |
| Story viewer | `app/daily/stories.tsx` | full-bleed; TapZones (prev / next / double-tap vote / hold), PanResponder |
| Today's photos | `app/daily/photos.tsx` Slide | full screen contain; double-tap vote |
| Yesterday tour | `app/daily/tour.tsx` | full-bleed; tap zones |
| Photo viewer | `src/features/daily/DailyProofViewer.tsx` | width × measured ratio |
| Mosaic city card | `src/features/today/TodayCountries.tsx` CityCard | square; tap → stories |
| Tiles (gallery, countries, profile) | `DailyProofTile.tsx` | square; tap → viewer |
| My photos | `app/my-photos.tsx` | square grid |
| Comments header | `PhotoCommentsSheet.tsx` | 44 px thumb |
| Yesterday recap, leaderboard, archive, challenge page thumbs | `TodayTour.tsx`, `DailyLeaderboardPanel.tsx`, `archive.tsx`, `[date].tsx` | small thumbs |
| Map: pins, spot sheet, spot page, lists | `map.tsx`, `SpotSheet.tsx`, `app/spot/[id].tsx`, `SpotList.tsx` | the spot's **cover** |
| Share card | `src/features/share/ShareCard.tsx` (view-shot) | `content.photoUrl` full card |

Web: `App.jsx` DailyFeedCard, `TodayCountries.jsx`, `dailyShared.jsx` ProofTile / ProofViewer, `PhotosScreen.jsx`, `StoriesScreen.jsx`, `WorldTour.jsx`, `CountriesScreen.jsx`, `FriendsScreens.jsx` My photos, map screens; server `apps/web/api/og.mjs`, `share-page.mjs`, `prerender.mjs`.

Backend copies of `photo_url`: `DailyCards::proofPayload` (chat card snapshot), `Spots` cover (`array_agg(p.photo_url ORDER BY cover)`) + pins, `DailyTour`, `DailyPromo`, `DailyWeb` (SEO), `DailyChallengeRepository` pins/archive, `DailyLeaderboard`, `PhotoCommentNotify`, back office.

## 3. Decisions

- **Schema**: `daily_proofs.selfie_url TEXT NULL`, sent as optional `selfieUrl` in the same `POST`/`PATCH` (atomic post; `null` removes it), validated like `photoUrl` (`invalid_selfie`), same upload pipeline (metadata stripped). No width/height column: the selfie is shown as a 3:4 inset with `cover`.
- **Returned** as `selfieUrl` + `selfieThumbUrl` by `DailyProofRepository::format` (every proof endpoint) and the chat card payload. Older apps ignore it and show the photo.
- **Main photo only** for: spot covers and map pins (Spots reads `photo_url` only, unchanged), the promo video (a face needs its own consent), SEO pages / og images, push and bell thumbnails, the archive and leaderboard thumbs.
- **Deleting** a proof deletes both images; a replaced or removed selfie is deleted on edit. Back office shows the selfie next to the photo.
- **Capture**: one in-app camera for the Daily photo on both platforms (`DualCamera`, from `AndroidCameraCapture`): back viewfinder → shutter → flash transition → front camera with a live preview and a 3-2-1 countdown (tap = now) → review (inset, swap, Retake selfie, Retake all, Remove selfie / Add your face) → the existing steps. Sequential, never simultaneous. Dual on by default, remembered (`hilads_dual_photo`). Chat and challenge cameras unchanged.
- **No gallery** in the Daily flow today, so the brief's "gallery + Add your face" becomes **Add your face** on the review whenever there is no selfie (dual off, removed, or the front camera failed).
- **Fallbacks**: no front camera / switch failure / timeout → the photo alone, a short notice, never a crash. Permission denied → the existing permission screen.
- **Display**: one `DualPhoto` component (photo + inset ~28 % top-left, theme-aware border, shadow, tap = 250 ms animated swap + light haptic, local state; draggable to a corner in the story viewer; non-interactive small inset on mosaic cards and tiles). No placeholder for a missing selfie. Thumb placeholders, selfie thumb preloaded.
- **Share card**: the inset in a corner of the photo.
- Web: display only (`DualPhoto` in the web screens), the camera stays in the app.

## 4. Risks

- iOS loses the system camera UI for Daily photos (our viewfinder instead); flash/zoom parity is ours to keep.
- Camera switch time varies (slow Android): the countdown starts on `onCameraReady` of the front camera, with a timeout fallback.
- Two uploads per post: both before the `POST`, the selfie's failure falls back to posting the photo alone only after a retry prompt.
- Mobile ships only with a store build (no OTA); the API change is additive (old apps keep posting single photos).

## 5. QA (Phase 5, 2026-10-29)

Checked: backend unit tests (262 green, incl. selfie validation and format), local API (migration, `selfieUrl` on proofs and on the chat card), `tsc` (no new errors vs HEAD, 22 baseline), web `vite build` + eslint, and the iOS simulator against a local backend:

| Check | Result |
| --- | --- |
| Hi chat post with a selfie: inset top-left, one-time tip beside it, tap swaps (selfie big, photo inset) and the tip goes | OK |
| Story viewer: inset under the city header, clear of the progress bar and close button | OK |
| Mosaic: small inset on a dual photo's card, single photos unchanged | OK |
| Single photos everywhere: as before (no placeholder) | OK |
| Old apps: `selfieUrl` / `selfieThumbUrl` are new optional fields; no endpoint changed shape | OK by construction |

Not checked here (needs devices):
- the capture itself: the simulator has no camera (back → front switch time, countdown, auto-capture, Dual toggle remembered, Retake selfie / Remove selfie / Add your face / Retake all, permission denied, a device without a front camera, slow Android);
- drag-to-corner in the story viewer with a real finger (the simulated drag could not be driven);
- share card capture with the inset, Android, small screens, long translations.

Skipped on purpose:
- **No gallery** in the Daily flow (camera only, SPEC 9.4): "Add your face" lives on the camera's review instead.
- **No blurhash / stored dimensions**: none exist today; the thumb is the placeholder for both images, like the rest of the app.
- **Selfie never in** spot covers, map pins, the promo video, SEO pages and og images (a face needs its own consent for promo; covers and pins stay about the place).

## 6. Remote switch, screen flash, mirroring (2026-10-29, after review)

- **Off by default**: `app_settings.dual_photo` (Admin › App versions › "Dual photo"), sent as `dualPhoto` by `GET /app/config`. `proof.tsx` reads it with today's challenge (3 s cap, any failure = off) before the camera can open. Off = the previous capture exactly: `launchCameraAsync` (system camera) on iOS, `AndroidCameraCapture` on Android. A single-camera photo drops any earlier selfie (an edit never pairs a new photo with an old selfie). Dual photos already posted show everywhere whatever the switch.
- **OTA**: `expo-updates` is not in the app (`package.json`, `node_modules`), so an EAS Update cannot reach installed apps; JS ships with a store build only. The switch protects the capture whichever way it ships.
- **Screen flash** for the selfie: a white full-screen overlay plus full brightness (`expo-brightness`, new native module, loaded defensively) for 350 ms before the shot, brightness restored after. On by default for Night out, Halloween and 18:00–07:00 local time; a flash button on the selfie screen switches it.
- **Mirroring**: no `mirror` on the front camera, so expo-camera saves the selfie un-mirrored (text reads correctly) while the live preview stays mirror-like.

## 7. In-app camera vs the iOS system camera (what dual mode costs on iOS)

Android is unchanged: its Daily capture already used `CameraView`. On iOS, dual mode replaces the system camera (`UIImagePickerController`) with expo-camera (`AVCapturePhotoOutput`):

| | System camera (switch off) | In-app camera (dual on) |
| --- | --- | --- |
| Lenses | pinch and 0.5x / 1x / 2–5x, macro auto-switch on Pro models | 1x wide only (expo-camera has `zoom` and `selectedLens`, not wired) |
| Close-ups (food) | macro on Pro models | wide lens minimum focus distance: close dishes can be soft |
| Focus / exposure | tap to focus and expose, exposure slider | continuous auto only (no focus-point API in expo-camera 16) |
| HDR / Deep Fusion | Apple's full pipeline | likely lighter: expo-camera doesn't expose quality prioritization (to confirm on device) |
| Night | Night mode is a Camera-app feature; the picker doesn't offer it either (as far as I know) | none; the rear flash on/off |
| Flash | auto / on / off | on / off (expo supports auto, not wired) |
| Shutter | instant | a short lag (takePictureAsync with processing) |
| Resolution | both are downscaled to 1600 px and re-encoded at upload | same |

Ways to win most of it back: pinch-to-zoom and an 0.5x button (`zoom`, `selectedLens`), flash auto, or a hybrid (the system camera for the photo, the in-app front camera only for the selfie).
