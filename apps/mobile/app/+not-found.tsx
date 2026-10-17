import { Redirect } from 'expo-router';

/**
 * Catch-all for any route Expo Router can't match - stale deeplinks, old
 * builds still pointing at renamed routes (e.g. the removed `/(tabs)/hot`),
 * or future regressions. Instead of dead-ending on the "Unmatched Route"
 * screen, redirect into Today, the home (V3).
 *
 * This makes the unmatched-route dead-end unreachable in normal flows while
 * the underlying redirect targets in app/index.tsx + NotificationHandler stay
 * the source of truth.
 */
export default function NotFound() {
  return <Redirect href={'/(tabs)/today' as never} />;
}
