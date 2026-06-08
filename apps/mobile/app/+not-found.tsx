import { Redirect } from 'expo-router';
import { useApp } from '@/context/AppContext';

/**
 * Catch-all for any route Expo Router can't match - stale deeplinks, old
 * builds still pointing at renamed routes (e.g. the removed `/(tabs)/hot`),
 * or future regressions. Instead of dead-ending on the "Unmatched Route"
 * screen, redirect into a valid screen: chat for joined users, the Now feed
 * otherwise (LandingScreen overlays it until a city is joined).
 *
 * This makes the unmatched-route dead-end unreachable in normal flows while
 * the underlying redirect targets in app/index.tsx + NotificationHandler stay
 * the source of truth.
 */
export default function NotFound() {
  const { joined } = useApp();
  return <Redirect href={joined ? '/(tabs)/chat' : '/(tabs)/now'} />;
}
