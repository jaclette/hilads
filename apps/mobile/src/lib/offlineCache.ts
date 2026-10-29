import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The last good answer of a few screens (cities, Today, my account), kept on the phone so
 * they still show something while the API can't be reached (a deploy, no network).
 * Best effort: a failed read or write is ignored.
 */
const PREFIX = 'hilads_offline_v1:';

export async function readOffline<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeOffline(key: string, value: unknown): void {
  AsyncStorage.setItem(PREFIX + key, JSON.stringify(value)).catch(() => {});
}

export function clearOffline(key: string): void {
  AsyncStorage.removeItem(PREFIX + key).catch(() => {});
}
