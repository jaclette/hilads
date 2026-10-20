/**
 * Config plugin: let the app see whether Waze is installed (Directions chooser,
 * src/lib/directions.ts). iOS: LSApplicationQueriesSchemes (canOpenURL needs the
 * scheme listed); Android 11+: a <queries> intent for the waze: scheme
 * (package visibility). Google Maps and Apple Maps need nothing: https links.
 */
const { withAndroidManifest, withInfoPlist } = require('@expo/config-plugins');

const SCHEMES = ['waze'];

module.exports = function withMapsAppQueries(config) {
  config = withInfoPlist(config, (config) => {
    const list = config.modResults.LSApplicationQueriesSchemes ?? [];
    config.modResults.LSApplicationQueriesSchemes = [...new Set([...list, ...SCHEMES])];
    return config;
  });
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.queries = manifest.queries ?? [{}];
    const q = manifest.queries[0];
    q.intent = q.intent ?? [];
    for (const scheme of SCHEMES) {
      const has = q.intent.some(i => i.data?.some(d => d.$?.['android:scheme'] === scheme));
      if (!has) q.intent.push({ action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:scheme': scheme } }] });
    }
    return config;
  });
};
