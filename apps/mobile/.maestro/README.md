# UI tests (Maestro)

Run them on Android and on iOS before every release.

```sh
cd apps/mobile
maestro --platform android test .maestro
maestro --platform ios test .maestro --exclude-tags camera   # the iOS simulator has no camera; on an iPhone, run all
```

First run on a fresh install: `maestro test .maestro/setup/sign_in.yaml` (permissions, city, sign in).

`navigation/` checks the back rule: back closes the top layer (modal, sheet,
screen); another tab's root goes back to Today; only Today with nothing open
leaves the app; a link or a push lands with Today under it.

The device needs:

- a release build (a dev build works too, with `-e DEV_URL="exp+hilads://expo-development-client/?url=http%3A%2F%2F<metro-host>%3A8081"`, but its debug JS is slow);
- an account signed in, placed in a city with today's challenge live and
  players' photos (the store demo database `hilads_store` has all of it:
  linh.nguyen@example.com in Saigon), with at least one private conversation,
  and that has not played today (09 takes a photo with the camera, then
  discards it: nothing is posted);
- for 09, a camera (the emulator's virtual scene is fine) with its permission granted.

`keyboard/` checks the keyboard rule: each field is typed into, then tapped
again and its text checked - a field under the keyboard would get that tap on a
key instead; the steps' main buttons are tapped over the keyboard.

Back is the platform's own (`subflows/back.yaml`): Android's back key; on iOS
the swipe from the left edge, the swipe down of a viewer or sheet, or the
screen's own button.

Selectors are `testID`s (Android resource-id), never texts, so the tests run in any language.
