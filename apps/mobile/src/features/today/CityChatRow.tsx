import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ListRow, RowGroup } from '@/ui';
import { markNotificationTypesRead } from '@/api/notifications';
import { patchNotifCounts, refreshNotifCounts, useNotifCounts } from '@/features/notifications/counts';
import { track } from '@/services/analytics';

/**
 * The city's chat (Hi), from Today (UX audit option B: Hi is a screen of the city, no longer a
 * tab). "Say hi to your city. Join a plan."; its badge counts my unread mentions, which opening
 * it marks read (what visiting the Hi tab did).
 */
export function CityChatRow() {
  const { t } = useTranslation('common');
  const router = useRouter();
  const { badges } = useNotifCounts();
  const mentions = badges.chat ?? 0;
  const open = () => {
    track('city_chat_opened', { source: 'today', mentions });
    if (mentions > 0) {
      patchNotifCounts(c => ({ ...c, badges: { ...c.badges, chat: 0 } }));
      markNotificationTypesRead(['mention', 'city_here']).then(refreshNotifCounts);
    }
    router.navigate('/(tabs)/chat' as never);
  };
  return (
    <View testID="today-city-chat">
      <RowGroup>
        <ListRow icon="chatbubble-outline" title={t('subtitles.hi')} badge={mentions} onPress={open} />
      </RowGroup>
    </View>
  );
}
