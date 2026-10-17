import Constants from 'expo-constants';

/** The installed app's version ("1.8.0"), from app.json at build time (no OTA in this app). */
export const APP_BUILD_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

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
