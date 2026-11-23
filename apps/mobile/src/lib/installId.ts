import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * This install's id, sent as X-Install-Id (scoring v2: one credited invite per phone,
 * the back office's fair-play report). iOS: a random id kept in the Keychain (it
 * survives a reinstall); Android: the Android ID (stable per app signing key and
 * device). Loaded once at start; until then calls go without it.
 */
const KEY = 'hilads_install_id';
let cached: string | null = Platform.OS === 'android' ? (Application.getAndroidId() || null) : null;

function randomId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const installIdReady: Promise<void> = (async () => {
  if (cached) return;
  try {
    let id = await SecureStore.getItemAsync(KEY);
    if (!id) {
      id = randomId();
      await SecureStore.setItemAsync(KEY, id, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    }
    cached = id;
  } catch {
    // no secure storage (simulator edge cases): no header
  }
})();

export function installId(): string | null {
  return cached;
}
