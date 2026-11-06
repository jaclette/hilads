# V6 QA

What was checked here, and the device pass still to do. V6 commits: cbcb6832 (phase 1) to the phase 8 commit.

## Done without a device

- **API**:
  - Full PHPUnit suite: 296 tests.
  - The one failure, `ImageStripTest::testLargeUploadIsCappedAt1600`, also fails before V6. It depends on the local GD build and doesn't touch V6.
  - New tests: `NotificationCategoryTest` (categories, dedupe, grouping, deep links, quiet hours) and `RanksTest` (periods, ranking).
- **App**:
  - `tsc`: no new errors (16, all in files V6 doesn't touch).
  - `expo export` bundles for iOS and Android.
- **i18n**: `node tools/i18n/validate.mjs` gives 0 errors in the 19 locales.
- **Not run**: nothing in V6 has run against the production database, on a simulator or on a phone.

## Before testing

1. Deploy the API, then run `php migrate.php` on prod. It adds:
   - `notifications.category`, `dedupe_key`, `seen_at` and their indexes, with the category backfill;
   - the new `notification_preferences` columns.

   Until it runs, the new inbox routes answer 503 `not_migrated` and the old v1 routes keep working.
2. Build 2.0.5 (release) for iOS and a low-end Android: `react-native-gesture-handler` (2.0.4+) is native; `@gorhom/bottom-sheet` is JavaScript on top of it.

## Device pass

Every screen in light, dark and Halloween, on a small screen, in en, fr, vi, ar (RTL) and ja.

**Notifications**
- [ ] Bell neutral when all is read, orange with a count (9+) and a wiggle on launch or when a new one arrives (Reduce Motion: no wiggle).
- [ ] "While you were away" on Today, with unread social or game items:
  - avatars and one line;
  - a tap opens Notifications;
  - ✕ or a sideways swipe dismisses it and it never comes back for the same items.
- [ ] Filter chips and their counts. Sections New / Today / Yesterday / This week / Earlier.
- [ ] Grouped rows ("Lan and 3 others liked your photo"). Comment quotes. Photo thumbnails.
- [ ] Swipes: right marks read or unread, left deletes. Pull to refresh, endless scroll, skeleton, empty state per filter.
- [ ] Mark all read: sweep and haptic, the bell goes back to neutral.
- [ ] Tapping each row type opens the right screen: comment (photo with its comments), like, friend request, profile view, plan, results (Ranks › Photos › Yesterday), Local Pass (Passport), rank up (Ranks › Players).
- [ ] No "New arrival in Omaha" for a Saigon user. A friend landing anywhere does notify. The same arrival appears only once.
- [ ] English notifications say "Saigon", not "Ho Chi Minh City".
- [ ] ⚙️ settings:
  - master toggles;
  - every toggle saves (✓);
  - quiet hours (no push between them, the bell row still written);
  - push status, and Turn on opens the OS settings.
- [ ] Push off: the banner in Notifications, dismissible.
- [ ] Tab badges:
  - Hi (mentions count) clears when Hi opens;
  - Passport (new Local Pass) and Ranks (results out) show a dot that clears when the tab opens.

**Ranks**
- [ ] 5 tabs fit at 360 dp. Ranks is gold when active.
- [ ] Photos:
  - today (time left to vote, podium);
  - yesterday (podium plus best per city);
  - week and all time (hall-of-fame grid, medals);
  - a tap plays the ranking in order in the feed.
- [ ] Players:
  - My city / World × Today / This week / All time;
  - movement ▲ ▼ new;
  - Local / Traveler badge;
  - the You bar text and tap-to-scroll;
  - a tap opens the profile.
- [ ] Cities:
  - race bars animate;
  - my city highlighted;
  - the fun line;
  - the You bar;
  - a tap opens that city's photos.
- [ ] Podium with 1 or 2 entries. Empty states. Confetti once per session. Count-up.
- [ ] Today shows the 🏁 race card (positions slide when they change) and a one-time 🏆 Results are in!
- [ ] Entry points:
  - the Passport week card and Most Local row;
  - the top-10 push;
  - old `/leaderboard` links (profile rank row, score celebration).

**Map**
- [ ] The sheet:
  - peek, half and full;
  - the first-visit hint;
  - no conflict with panning the map;
  - the floating buttons stay above the peek.
- [ ] Pins:
  - a tapped pin's card leads the sheet at half;
  - a tapped row flies the map to the pin and bounces it;
  - the list follows the visible area and the filters;
  - Nearest, Most liked and Newest sorts.
- [ ] The look:
  - photo pins with their theme rings;
  - today's pins pulse;
  - ⭐ on picks;
  - clusters as stacks;
  - plans as calendar pins from zoom 14, never over clusters;
  - my avatar with its pulse;
  - the palette in light and dark.
- [ ] 🎲 Surprise me. "Nothing here yet" in an empty area. Pins drop in again on a filter change.
- [ ] Performance with ~300 pins on a low-end Android.

**Passport rivals**
- [ ] Your rivals: flags and duel counts, or the empty state.
- [ ] The face-off:
  - the score (likes per shared challenge), trophy, confetti when leading;
  - pairs of photos with the winner crowned;
  - a tap on a photo opens it in the feed.
- [ ] A city that hasn't played today: the "send them a challenge" card and its share card.

**Small fixes**
- [ ] The hero subtitle is hidden when it only rephrases the headline, and kept when it adds the how.
- [ ] Nobody played yet in my city: the compact "📸 Saigon? Be first today" call, and yesterday's cards are readable.
- [ ] A word answer up to 40 characters, and long captions end with "…".
