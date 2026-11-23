import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { PlayerProfile } from '@/features/profile/PlayerProfile';

/**
 * A player's profile (opened when tapping another user): the "mini Passport"
 * (features/profile/PlayerProfile). ?preview=1 on my own id: "View as others see me".
 */
export default function PublicProfileScreen() {
  const router = useRouter();
  const { id, preview } = useLocalSearchParams<{ id: string; preview?: string }>();
  const { account } = useApp();
  useEffect(() => {
    if (!canAccessProfile(account)) router.replace('/auth-gate');
  }, [account, router]);
  if (!id) return null;
  return <PlayerProfile userId={id} preview={preview === '1'} />;
}
