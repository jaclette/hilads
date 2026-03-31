/**
 * Config plugin: change MainActivity launchMode from singleTask → singleTop.
 *
 * Why:
 *   Expo prebuild hardcodes android:launchMode="singleTask" on MainActivity.
 *   On Android 14, when the camera activity (running in a separate task) sends
 *   RESULT_OK back to a singleTask host activity, Android can drop the result
 *   across task boundaries — the ActivityResultLauncher inside expo-image-picker
 *   never resumes, and launchCameraAsync hangs indefinitely.
 *
 *   singleTop provides the same single-instance guarantee and correctly handles
 *   onNewIntent (deep links, notifications) while allowing cross-task activity
 *   result delivery to work on Android 14+.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withSingleTopActivity(config) {
  return withAndroidManifest(config, (config) => {
    const activities = config.modResults.manifest.application?.[0]?.activity ?? [];
    const main = activities.find(
      (a) => a.$?.['android:name'] === '.MainActivity'
    );
    if (main) {
      main.$['android:launchMode'] = 'singleTop';
    }
    return config;
  });
};
