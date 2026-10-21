/**
 * Config plugin: opt out of Android's predictive back (enableOnBackInvokedCallback="false").
 *
 * Why:
 *   With targetSdkVersion 36, Android 16 turns predictive back on and no longer
 *   calls Activity.onBackPressed(). React Native 0.79 forwards the back button to
 *   JS from onBackPressed (BackHandler, React Navigation, Modal), so on Android 16
 *   every back press skipped JS and closed the app, from any screen.
 *   Opting out restores onBackPressed: back pops the top screen again.
 *   Remove once React Native handles OnBackInvokedCallback itself.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withLegacyBackHandling(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (app) {
      app.$['android:enableOnBackInvokedCallback'] = 'false';
      const main = (app.activity ?? []).find((a) => a.$?.['android:name'] === '.MainActivity');
      if (main) main.$['android:enableOnBackInvokedCallback'] = 'false';
    }
    return config;
  });
};
