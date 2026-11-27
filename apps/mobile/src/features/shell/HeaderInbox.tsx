import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Space } from '@/constants';
import { useApp } from '@/context/AppContext';
import { BellButton } from '@/features/notifications/BellButton';
import { MessagesButton } from '@/features/messages/MessagesButton';

/**
 * The messages button and the bell, with their counts, for the tabs whose header isn't AppHeader
 * (Passport, Map, Trip): unread notifications and DMs stay visible from every tab. Members only
 * (a guest has neither; Today and World show them the Sign up button).
 */
export function HeaderInbox({ gap = Space.sm }: { gap?: number }) {
  const router = useRouter();
  const { account } = useApp();
  if (!account) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap }}>
      <MessagesButton onPress={() => router.push('/messages' as never)} />
      <BellButton onPress={() => router.push('/notifications' as never)} />
    </View>
  );
}
