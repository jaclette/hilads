import AsyncStorage from '@react-native-async-storage/async-storage';
import type { City, GuestIdentity } from '@/types';

const STORAGE_KEY = 'hilads_guest_identity';

// ── UUID generation ───────────────────────────────────────────────────────────
// Produces a 32-char hex string (no dashes), matching the backend's format.

function generateHex(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}

export function generateGuestId(): string {
  return generateHex(32);
}

/** UUID v4 for per-session presence tracking (not persisted). */
export function generateSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Nickname generation ───────────────────────────────────────────────────────
// Mirrors the web NicknameGenerator pattern.

const ADJECTIVES = [
  'Urban', 'Night', 'City', 'Neon', 'Wild', 'Fast', 'Cool', 'Electric',
  'Velvet', 'Cosmic', 'Atomic', 'Solar', 'Lunar', 'Misty', 'Golden',
  'Silent', 'Brave', 'Sharp', 'Sleek', 'Bold',
];

const NOUNS = [
  'Fox', 'Owl', 'Wolf', 'Hawk', 'Bear', 'Tiger', 'Lynx', 'Raven',
  'Falcon', 'Viper', 'Rider', 'Drifter', 'Nomad', 'Ranger', 'Scout',
  'Spark', 'Flash', 'Storm', 'Blaze', 'Ghost',
];

export function generateNickname(): string {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}${noun}`;
}

// ── Storage ───────────────────────────────────────────────────────────────────

export async function loadOrCreateIdentity(): Promise<GuestIdentity> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GuestIdentity;
      if (parsed.guestId && parsed.nickname) {
        return parsed;
      }
    }
  } catch {
    // Corrupted storage — create fresh identity
  }

  const identity: GuestIdentity = {
    guestId:  generateGuestId(),
    nickname: generateNickname(),
    mode:     'exploring',
  };

  await saveIdentity(identity);
  return identity;
}

export async function saveIdentity(identity: GuestIdentity): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

export async function clearIdentity(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

// ── Detected (geo) city persistence ──────────────────────────────────────────
// Stored separately from the session identity so that "Back to my location"
// is immediately available on app start, before the background geo resolves.

const DETECTED_CITY_KEY = 'hilads_detected_city';

export async function saveDetectedCity(city: City | null): Promise<void> {
  try {
    if (!city) {
      await AsyncStorage.removeItem(DETECTED_CITY_KEY);
    } else {
      await AsyncStorage.setItem(DETECTED_CITY_KEY, JSON.stringify(city));
    }
  } catch {
    // Non-critical — worst case the button appears a few seconds late
  }
}

export async function loadDetectedCity(): Promise<City | null> {
  try {
    const raw = await AsyncStorage.getItem(DETECTED_CITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as City;
    return parsed?.channelId ? parsed : null;
  } catch {
    return null;
  }
}
