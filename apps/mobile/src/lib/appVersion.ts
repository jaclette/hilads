import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

/** The installed app's version ("1.8.0"): the store build's own, else app.json's (OTA updates never change it). */
export const APP_BUILD_VERSION: string =
  Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';

/**
 * Who is calling, on every request to the API (the client and the few raw
 * fetches): the platform and this version. The server answers GET /app/config
 * for this platform, and only blocks apps that send no version (up to 1.7.1).
 */
export function appHeaders(): Record<string, string> {
  return { 'X-Platform': Platform.OS, 'X-App-Version': APP_BUILD_VERSION };
}

/** "1.8" / "1.8.0" → [1, 8, 0]; null when not a version. */
function parts(v: string | null | undefined): number[] | null {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec((v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** Is `version` older than `than`? False when either is not a version. Numeric: 1.10.0 > 1.9.2. */
export function isOlderVersion(version: string | null | undefined, than: string | null | undefined): boolean {
  const a = parts(version);
  const b = parts(than);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/**
 * What this phone really runs, for Settings and the debug screen: the store version and
 * build, then the update it launched ("built-in" = the store bundle, no update applied).
 * Ex. "v2.2.1 (305) · update 01a1f851 · Nov 20". Not translated: it is read back to support.
 */
export function appVersionLabel(): string {
  const build = Application.nativeBuildVersion;
  let update = 'built-in';
  if (!Updates.isEmbeddedLaunch && Updates.updateId) {
    const at = Updates.createdAt;
    update = `update ${Updates.updateId.slice(0, 8)}`
      + (at ? ` · ${at.toLocaleDateString('en', { month: 'short', day: 'numeric' })}` : '');
  }
  return `v${APP_BUILD_VERSION}${build ? ` (${build})` : ''} · ${update}`;
}
