import * as Localization from 'expo-localization';

/** The device's IANA timezone ("Asia/Ho_Chi_Minh"), or null if unknown. */
export function deviceTimezone(): string | null {
  try {
    const tz = Localization.getCalendars()[0]?.timeZone;
    if (tz) return tz;
  } catch { /* fall through */ }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
