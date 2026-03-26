/**
 * Persists the auth token in SecureStore so sessions survive app restarts.
 * Works alongside client.ts's in-memory token — this is the durable layer.
 */
import * as SecureStore from 'expo-secure-store';
import { setAuthToken, getAuthToken } from '@/api/client';

const TOKEN_KEY = 'hilads_session_token';

/** Read saved token and load it into the API client. Call on app boot. */
export async function loadSavedToken(): Promise<boolean> {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (token) {
      setAuthToken(token);
      return true;
    }
  } catch {
    // SecureStore unavailable (simulator quirk) — continue without
  }
  return false;
}

/** Persist the current in-memory token to SecureStore. Call after login/signup. */
export async function persistToken(): Promise<void> {
  const token = getAuthToken();
  if (!token) return;
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch { /* non-fatal */ }
}

/** Clear token from both SecureStore and API client. Call on logout. */
export async function clearToken(): Promise<void> {
  setAuthToken(null);
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch { /* non-fatal */ }
}
