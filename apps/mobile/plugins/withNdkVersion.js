/**
 * Config plugin: pin android/build.gradle's `ext.ndkVersion`.
 *
 * Why:
 *   Expo SDK 53's `expo-build-properties` doesn't expose an `ndkVersion`
 *   option (verified by grep — zero refs in v0.14.8 source). The
 *   `expo-root-project` Gradle plugin reads `ndkVersion` from the React
 *   Native version catalog (libs.versions.toml), which RN 0.79.6 pins to
 *   r27.1.12297006. NDK r27 supports 16 KB page sizes but doesn't enable
 *   them by default — Google Play's 16 KB requirement needs r28+.
 *
 *   This plugin injects `ext.ndkVersion = "28.0.13004108"` into the
 *   buildscript block of android/build.gradle BEFORE the expo-root-project
 *   plugin runs. That plugin uses `setIfNotExist`, so our value wins.
 *
 * Survives every `npx expo prebuild --clean` because it re-runs as part
 * of the plugins pipeline.
 */
const { withProjectBuildGradle } = require('@expo/config-plugins');

module.exports = function withNdkVersion(config, props = {}) {
  const ndkVersion = props.ndkVersion;
  if (!ndkVersion) {
    throw new Error("withNdkVersion: `ndkVersion` prop is required");
  }
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes('ext.ndkVersion')) return cfg;
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /buildscript\s*\{/,
      `buildscript {\n    ext.ndkVersion = "${ndkVersion}"`,
    );
    return cfg;
  });
};
