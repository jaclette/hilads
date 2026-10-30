# Translations audit (app + web, 19 locales)

Date: 2026-10-30. Trigger: a Vietnamese user (home market, Saigon) found the app badly translated.
Tool used throughout: `node tools/i18n/validate.mjs` (added with this audit, see Phase 6).

## 1. Inventory

| Where | What | Files | Size |
|---|---|---|---|
| App (Expo) | UI strings, i18next (`apps/mobile/src/i18n/index.ts`, all bundled) | `apps/mobile/src/i18n/locales/<locale>/*.json`, 19 namespaces | 2,277 English keys, ~52k characters |
| Web (Vite) | UI strings, i18next, lazy per locale (`apps/web/src/i18n/index.js`) | `apps/web/src/i18n/locales/<locale>/*.json`, 18 namespaces | 2,381 English keys, ~57k characters |
| API pushes + bell | Social / chat / challenge notifications | `backend/api/src/NotificationI18n.php` (34 types × 18 locales, English at the call sites) | |
| API Daily pushes | Daily Challenge pushes | `backend/api/src/DailyPushText.php` (48 phrases × 18 locales, English in `DailyPushes.php`) | |
| API city names | City display names per locale (pushes, SEO pages) | `backend/api/src/CityNames.php` (generated) | |
| Daily content | Challenge headline, text, context, subtitle, share / compare question, unit, title, price label, Local Twists, specials, picks | DB columns `*_i18n` (jsonb, `{"en":…,"vi":…,"_src":…}`), written in the back office or the import JSON | 1 challenge / day |
| Emails | Password reset (Resend) | `AuthService::sendResetEmail` | **English only** |
| Admin broadcasts | Push broadcasts typed in Admin › Push | `PushBroadcastService` | one language per send (whatever is typed) |

Locales (same 19 everywhere): en, fr, vi, es, it, pt-br, pt-pt, de, nl, zh-hans, zh-hant, ja, ko, fil, th, id, hi, ru, ar.

The app and the web share most copy but with **different keys** (web `challenge:dc.*` ≈ app `daily:*`,
web `profile:pp.*` ≈ app `me:*`, web `city:*` ≈ app `chat:*` / `here:*` / `now:*`). Any rewrite must keep the two in step.

Keys per locale (flattened, plural forms counted separately, so languages with more plural forms have more keys):

| | en | fr | vi | es | it | pt-br | pt-pt | de | nl | zh-hans | zh-hant | ja | ko | fil | th | id | hi | ru | ar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| App | 2277 | 2340 | 2266 | 2346 | 2346 | 2365 | 2365 | 2329 | 2310 | 2597 | 2597 | 2598 | 2597 | 2279 | 2597 | 2259 | 2623 | 2747 | 2868 |
| Web | 2381 | 2440 | 2374 | 2445 | 2445 | 2464 | 2464 | 2432 | 2413 | 2705 | 2705 | 2706 | 2705 | 2382 | 2705 | 2367 | 2726 | 2856 | 2983 |

(zh/ja/ko/th carry ~300 extra `cityNames` entries; English only lists names that differ.)

## 2. Coverage

Validator before any fix: **136 errors, 3,716 warnings**.

**Errors (shown to users as English or broken text)**
- **Arabic plurals**: about 40 count strings exist only as `_one` / `_other`. Arabic needs zero / one / two / few / many / other, so "0 cities", "2 cities", "3 to 10 cities", "11 to 99 cities" fall back to **English** (`cities:members`, `cities:challenges`, `chat:people.*`, `city:picker.*`, `landing:join.*`).
- **Russian plurals**: the same strings lack `_few` / `_many`, so "2 участника" and "5 участников" also fall back to English.
- **Lost markup**: the landing `stories.screen*_invitation` (`<hi>…</hi>` highlight) lost its tags in 17 locales, so the highlighted word renders plain.
- **Lists**: the landing `how.steps` has empty items in 18 locales.
- **Missing keys**: `chat:*` (3) in a few locales.

**Warnings**
- **Same as English: 2,145** (outside city names). Mostly correct brand terms (Hi plan, Local, Top 10, Selfie). The real gaps:
  - `brand:vibe.*` (Party, Coffee, Music, Food, Chill) is untranslated in zh, ja, ko, th, hi, ru and ar;
  - `me:live` "Live", `now:nowTag` "Now", `now:laterTag` "Plan", `common:badge.ghost` "Ghost" are untranslated in the non-Latin locales;
  - `daily:propose.textPlaceholder` "Find a…" is English in **every** locale;
  - `daily:propose.typeChallenge` "Challenge" and `daily:dual.toggle` "Dual" are untranslated in several locales.
- **French**:
  - 61 em dashes (pushes, challenge, landing): the style rule is simple hyphens.
  - 373 plain spaces before `? ! : ;`. A plain space lets the sign wrap alone onto the next line; a no-break space is needed.
- **Brand terms dropped in 71 strings**: mostly "Most Local", translated as a phrase in de, nl, fil and others.
- **613 unused plural forms**: harmless (for example `_one` in vi, ja, ko, zh, th, id, where i18next only uses `_other`).

**Hardcoded strings (not going through i18n)**

App (outside the debug panel and the design gallery, which are internal):
- `apps/mobile/src/hooks/useFriendRequests.ts:102,114,126`: "Could not accept / decline / cancel" plus "Please check your connection and try again."
- `apps/mobile/app/daily/proof.tsx:619,735`: accessibilityLabel "Currency".

Web:
- `EventLimitReachedScreen.jsx`: "You've already created your event today!", "Your event", "Become a Legend", aria "Back".
- `OpenInAppBanner.jsx`: "Continue in the Hilads app for the full experience", "Open app", aria "Dismiss".
- `AppPromoBanner.jsx`: "Get the full Hilads experience", aria "Dismiss".
- `AppPromoInterstitial.jsx`: aria "Get the Hilads Android app".
- `AccountWelcome.jsx`: aria "Welcome".
- `DeleteAccountPage.jsx`: "Delete your account", "Back to Hilads".
- `ResetPasswordScreen.jsx`:
  - "Checking reset link…", "Link expired", "Password updated", "Choose a new password";
  - "New password", "Confirm password", "At least 8 characters", "Repeat your new password".
- `ForgotPasswordScreen.jsx`: "Forgot password?", "Check your inbox".
- `App.jsx`: "Tap to open in maps", "Sign up" (mention nudge), aria "Primary", "Dismiss".
- `LandingPage.jsx` (legacy landing mockups): "Launch a challenge", "Find me the best ramen in town", "Show me the best sunset spot", "See live challenges", "Coming soon", aria "About Hilads".
- aria-label "Close" in 8 components (Lightbox, ShowcasePreviewModal, ChallengeChatPage ×2, GroupSubmissionsGallery, ArrivalsBar, ChallengeChannelMembers, ProofReviewModal), plus "Cancel reply" and "Emoji picker".
- `ThreadScheduleBlock.jsx`: title "Approve".
- `ConversationsScreen.jsx:34`: "5m" relative time built by hand.

API:
- Error messages are English (`Response::json(['error' => …])`). The clients map known error codes to i18n keys (`daily:errors.*`) and only fall back to the server text for unknown ones.
- The password reset email is English only.

## 3. Plurals and formatting

**Count strings without plural forms** (English keys holding `{{count}}` with no `_one` / `_other`). They read "1 photos", "1 members", and never inflect in ru, ar, pl-style languages:
- `chat:world.online`, `chat:world.cities`, `chat:world.arrivals`, `chat:online`, `chat:onlineAria`;
- `chat:cityHero.members`, `chat:cityHero.nearby`, `chat:cityHero.recent`, `chat:people.hiNowA11y`, `chat:typingMany`, `chat:world.banner`, `chat:world.quietCard`;
- `cities:online`, `cities:msgs`;
- `event:here`, `event:going`, `event:manyGoing`, `event:shareGoing`, `dm:goingCount`, `hangout:manyIn`;
- `challenge:card.joinedCount`, `card.photosCount`, `card.daysLeft`, `card.whoJoined`, `members.countIn`, `postCreate.sendCta`, `postCreate.sentTitle`, `intl.proof.tryAgainCta`, `intl.proof.rejectModalHint` ("attempt(s)"), `scoreCelebration.event.andMore`, `group.validateConfirm`, `group.submissionsHeader`, `group.checkPhotos`, `pointExamples.line.*`;
- `daily:countCity`, `daily:event.stickers.max`, `daily:compare.boardCount`, `me:aboutLeft`, `me:passport.pageA11y`;
- `common:time.*` ("5m ago", "Expires in 3h").

The same set exists on the web under its keys.

**Concatenation**: few, and mostly harmless (`Label · 3` counters on tabs, `kicker: text` accessibility labels). `challenge/[id].tsx:1154` builds `mode + cityTail`, and `event/create.tsx:401` builds `every + days`. Both move to interpolation.

**Dates and times**:
- Mostly locale-aware: 115 `Intl` / `toLocale*` calls taking the i18n language. The `en-CA` / `en-US` calls are internal date keys and time-zone maths, which is correct.
- Relative times: the app uses `common:time.*` (Hermes has no `Intl.RelativeTimeFormat`); the web uses `Intl.RelativeTimeFormat` except `ConversationsScreen` ("5m").

**Numbers and distances**:
- `apps/mobile/src/lib/distance.ts`, `apps/mobile/src/features/today/format.ts` and `apps/web/src/distance.js` print `1.5 km` with `toFixed`. That's a decimal point in fr, de, vi, es, it, pt, nl, id and ru, where it should be `1,5 km`.
- The web map (`spotsShared.js`) already uses `Intl.NumberFormat`.

**Currencies**: the compare prices use `Intl.NumberFormat('en-US', currency)` for the symbol only, and the amounts are formatted separately. That's acceptable (symbol prefix), but the amount separator follows English. Noted for Phase 5.

## 4. Daily Challenge translation pipeline

How it works:
- **No translation service or model at runtime.** The texts are "written by hand" (`DailyI18n.php`): the founder pastes them into the back office (Admin › Daily › edit challenge: a field per locale for headline, text, context, subtitle, share question, compare question, unit, title, price label and Local Twist), or imports the week's JSON (`docs/daily-challenge/*.json`), produced with an LLM in a chat session.
- **Stored per locale.** Each field is jsonb `{"en":…, "<locale>":…, "_src": "<English at save time>"}`. The editor flags a translation as stale when the English changed since (`_src`), and warns when a brand term is dropped (`DailyI18n::BRAND_TERMS`).
- **Readers.** They get the viewer's locale (`?locale=` from the app, else `users.locale`), else English. Photo captions are never translated.
- **No prompt, glossary, style guide, length limits or review step exists.** Quality depends on the session that produced the JSON. A per-locale admin editor exists already (Admin › Daily › challenge › translations), so the "fix a translation without code" need is covered. Phase 4 adds the missing guide, the glossary and the per-field limits to the generation step.

Five recent challenges, as served by the production API (`/api/v1/daily/challenges/{date}?locale=`):

| Date | English headline | Vietnamese | French |
|---|---|---|---|
| 10-26 | Find the prettiest alley in town. | Tìm con hẻm đẹp nhất thành phố. / *Rời đường lớn và tìm một con hẻm đáng để chụp ảnh.* | Trouve la plus jolie ruelle de la ville. / *Quitte la grande rue et trouve une ruelle qui vaut une photo.* |
| 10-27 | Find a street food locals love. | Tìm món ăn đường phố được yêu thích. / *Tìm món ăn đường phố người địa phương ăn mỗi ngày, không chỉ dành cho khách du lịch.* | Trouve la street food préférée de ta ville. / *Trouve la street food que les locaux mangent tous les jours, pas seulement les touristes.* |
| 10-28 | Get around like a local. | Đi lại như người địa phương. / *Đi phương tiện mà người địa phương hay đi làm.* | Déplace-toi comme un local. / *Prends le transport que les locaux prennent pour aller bosser.* |
| 10-29 | Find a fruit locals love. | Tìm loại trái cây dân địa phương mê. / *Tìm một loại trái cây dân địa phương mê, và chia sẻ tên gọi ở đây của nó.* | Trouve un fruit que les locaux adorent ici. / *Trouve un fruit que les locaux adorent ici, et partage son nom local.* |
| 10-30 | Find the best night view. | Tìm góc ngắm đêm đẹp nhất. / *Tìm một nơi thành phố đẹp nhất khi trời tối.* | Trouve la plus belle vue de nuit. / *Trouve un endroit où la ville est la plus belle à la nuit tombée.* |

Verdict:
- **French** is good: casual "tu", natural "bosser" and "à la nuit tombée". Two small issues: the headline and the text repeat each other on 10-29, and on 10-28 the theme reads "Language" (an old theme key, see below).
- **Vietnamese** is understandable but stiff in places:
  - "người địa phương" is repeated everywhere; "dân ở đây" or "dân Sài Gòn" reads warmer;
  - "chia sẻ tên gọi ở đây của nó" is word for word ("its name here"); natural is "và cho mọi người biết ở đây gọi nó là gì";
  - "Tìm một nơi thành phố đẹp nhất khi trời tối" misses a relative pronoun ("nơi mà…"); natural is "Tìm chỗ ngắm thành phố về đêm đẹp nhất".
- **Theme names** come back in English (`theme.name: "Neighborhood"`, `"Language"`). They're brand terms by design, but 10-26 and 10-28 show keys from older weeks ("neighborhood", "language") that aren't in the current brand list.

## 5. Push notifications and emails

| Channel | Localized? |
|---|---|
| Social / chat / challenge pushes and bell (`NotificationI18n`, 34 types) | Yes, 18 locales (English = call-site text). User content (message previews, names) stays as is. |
| Daily pushes (`DailyPushText`, 48 phrases) | Yes, 18 locales, written to avoid plurals ("Votes: 3"), so they read a bit like a dashboard ("Votes pour ta photo d'hier : 3."). |
| Admin push broadcasts | Not localized: one text typed per send. |
| Password reset email | **English only** (subject, body, button). |
| Photo comment pushes (`PhotoCommentNotify`) | Yes, through `NotificationI18n` / `DailyPushText`. |

French pushes use em dashes ("Campagne Hilads — points x2"), against the hyphen rule.

## 6. Fonts

The app (`src/scaling.ts` maps every weight to Be Vietnam Pro) and the web (Google Fonts, Be Vietnam Pro 400 to 800) use **Be Vietnam Pro**, a typeface designed for Vietnamese.

- **Vietnamese glyphs**: all present, including the stacked marks (ầ ặ ễ ở ự ỗ ẫ ậ ẳ ẵ ỹ ỷ đ Ơ Ư), checked in the TTF cmap.
- **Clipping risk**:
  - The font's line box is 1.265 em (ascent 1000, descent 265 per 1000 units). An uppercase letter with a stacked mark (Ẫ, Ễ, Ấ, Ổ) reaches **1149**, above the ascent.
  - The marks therefore overflow the line box whenever the line height is below about 1.15× the font size, which happens with:
    - `textTransform: 'uppercase'` labels (15 in the app: kickers, section titles);
    - tight line heights (app: `challenge/[id].tsx` title 28/32; web: 70 rules at `line-height: 1` or `1.1`, mostly icons and flags, a few titles and pills).
  - On **Android** a Text clips at its line box, so the tops of the stacked marks are cut. On iOS and the web they overflow without clipping, unless a parent has `overflow: hidden` (pills, badges, line-clamped titles).
- **Other scripts**: Be Vietnam Pro has **no** Cyrillic, Thai, Arabic, Devanagari or CJK glyphs, so those locales render in the system fallback font (San Francisco / Roboto / Noto). That's expected and fine. One catch to check on a device: with a custom `fontFamily` per weight, the fallback font on Android may not pick up the weight, so bold headings in Russian, Hindi, Thai or Arabic may come out Regular. It's checked during Phase 2 on the emulator.

## 7. City names

Sources:
- the canonical name in the `cities` table (English, GeoNames since V5-01: "Ho Chi Minh City");
- per-locale display names in `cityNames.json` (app and web), plus the server's `CityNames.php` (generated from the same data), plus names the API sends per locale (`rememberCityNames`);
- **short names** (`SHORT_NAMES` in `src/i18n/cityName.ts`, `apps/web/src/i18n/cityName.js`, `CityNames::short`): ho-chi-minh-city → "Saigon" (vi "Sài Gòn"); also St. Petersburg, Rio, Trivandrum and others.

Two helpers decide what shows:
- `localizeCityName()`, the full name: 28 call sites in the app and 27 on the web, including the **story viewer header** (`app/daily/stories.tsx:212`), passport pages and share texts. It shows "Ho Chi Minh City" / "Thành phố Hồ Chí Minh" / "Ciudad Ho Chi Minh".
- `shortCityName()`: 74 app and 57 web call sites (cards, tour, mosaic, buttons). It shows "Saigon" / "Sài Gòn".

So the same city reads "Saigon" on the Today card and "Ho Chi Minh City" in the stories opened from it. Decision in the style guide (Phase 1) and fix in Phase 5: **one display name per city per locale, the short one when the city has one**.

## 8. What the next phases fix

| Finding | Phase |
|---|---|
| Literal / stiff Vietnamese, "challenge" vs "thử thách" mixed | 2 |
| Literal copy in other locales; untranslated brand-adjacent words; French typography | 3 |
| Daily content generation without a guide, glossary or limits | 4 |
| Missing plural forms (ar, ru), count strings without plurals, `1.5 km`, hardcoded strings, Saigon vs Ho Chi Minh City | 5 |
| No check in CI; no "how to add a string" | 6 |
| Stacked Vietnamese marks clipped on Android | 2 (fonts) |
