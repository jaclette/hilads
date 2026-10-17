import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * The former MY PROFILE tab (V3-10): Passport and Settings replace it. The
 * route stays for old pushes and links: ?tab=friends / ?tab=vibes open the
 * friends screen, anything else opens Passport.
 */
export default function MeRedirect() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const to = tab === 'friends' || tab === 'vibes' ? '/friends' : '/(tabs)/passport';
  return <Redirect href={to as never} />;
}
