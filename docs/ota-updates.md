# Over-the-air updates (EAS Update)

`expo-updates` is in the app from commit `d3399566`: only store builds made after it can receive updates. Builds already in the stores **cannot**: they have no updater.

## How it is set up

- `apps/mobile/app.json` › `updates`: the EAS project URL, `checkAutomatically: ON_LOAD`, `fallbackToCacheTimeout: 0`. The app never waits for the network at launch: it starts on what it has, downloads a new update in the background, and **applies it on the next cold launch**.
- `runtimeVersion: { policy: "appVersion" }`: an update reaches only the builds of the **same app version** (`expo.version`, e.g. `1.9.0`). Bump the version for any native change (new native module, permission, config plugin, Info.plist / AndroidManifest change): those can never ship over the air.
- `apps/mobile/eas.json`: one channel per build profile, `development`, `preview`, `production`. A store build (`eas build --profile production`) listens to `production`.

## What can and cannot go over the air

- Yes: JavaScript / TypeScript, i18n JSON, images and other assets bundled by Metro.
- No: native modules and their versions (`expo install …` of a native package), `app.json` native config (permissions, plugins, icons, splash), anything needing `pod install` or a Gradle change. These need a store build with a new `version`.
- The JS of an update must match the native modules of the build: publish from the commit the build was made from, plus JS-only changes.

## Publish

From `apps/mobile`, on the commit to ship, with `.env.local` pointing at production (`EXPO_PUBLIC_API_URL=https://api.hilads.live`; Expo bundles it into the update):

```sh
npx eas update --channel production --message "Halloween polish" --platform all
# a careful start: 10 % of devices first, then raise it
npx eas update --channel production --message "…" --rollout-percentage 10
npx eas update:edit                       # raise the rollout of the latest group (interactive)
```

Check: `npx eas update:list --branch production` (groups, runtime, message) and `npx eas channel:view production`.

## Roll back

```sh
# back to a previous update group (its id from update:list)
npx eas update:republish --group <previous-group-id> --destination-channel production --message "Rollback"
# back to the JS embedded in the store build
npx eas update:roll-back-to-embedded --channel production --runtime-version 1.9.0 --message "Rollback to embedded"
# interactive helper for either
npx eas update:rollback
```

Devices pick the rollback up like an update: downloaded on a launch, applied on the next cold launch.

## Not verified yet

The release-build check was stopped before it ran (2026-10-29). Before relying on OTA, on the first store build with `expo-updates` (TestFlight / internal testing):

1. `npx eas update --channel production --message "OTA check"` with a harmless visible change (or `--channel preview` on a preview build).
2. Open the app (it downloads), close it fully, open it again: the change shows.
3. `npx eas update:roll-back-to-embedded --channel production --runtime-version <version>`, open twice: the change is gone.
