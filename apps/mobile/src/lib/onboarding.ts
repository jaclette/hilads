import AsyncStorage from '@react-native-async-storage/async-storage';

// First-time onboarding carousel - "seen once" flag (guests only).
// Local-only (AsyncStorage); there is no persistent server-side guest record to
// hang this on, so a reinstall will show it once more - acceptable for a
// lightweight one-off intro. On a read error we deliberately default to SHOWING
// it (better one extra view than a crash); an in-memory fallback prevents a
// re-show in the same session if writes also fail.

const STORAGE_KEY = 'onboarding_seen';
let seenInMemory = false;

export async function hasSeenOnboarding(): Promise<boolean> {
  if (seenInMemory) return true;
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) === '1';
  } catch {
    return false; // unreadable storage → show once
  }
}

export async function markOnboardingSeen(): Promise<void> {
  seenInMemory = true;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // keep the in-memory flag so it won't re-show this session
  }
}
