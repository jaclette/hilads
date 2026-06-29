/**
 * useShareToCity - one-tap "share this thing into my current city feed".
 *
 * Posts a single chat message (the deeplink URL only) into the user's CURRENT
 * city channel, then jumps to the city tab so they see it land. The city feed
 * already renders link-preview cards for these URLs, so no extra text is added.
 *
 * Used by the owner of a topic/event/challenge (and the taker of a challenge)
 * via the <ShareToCityPill> component.
 */

import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApp } from '@/context/AppContext';
import { sendMessage } from '@/api/channels';
import { useTranslation } from 'react-i18next';

export function useShareToCity() {
  const { city, sessionId, identity, account } = useApp();
  const { t } = useTranslation('common');
  const [sharing, setSharing] = useState(false);

  const nickname = account?.display_name ?? identity?.nickname ?? '';
  const canShare = !!(city?.channelId && identity?.guestId);

  const shareToCity = useCallback(async (url: string) => {
    if (!city?.channelId || !identity?.guestId || sharing) return;
    setSharing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await sendMessage(city.channelId, sessionId ?? '', identity.guestId, nickname, url);
      // Jump to the city feed so the freshly posted link card is visible.
      router.replace('/(tabs)/chat');
    } catch {
      Alert.alert(t('shareToCityError', { defaultValue: 'Could not share to your city. Try again.' }));
    } finally {
      setSharing(false);
    }
  }, [city?.channelId, sessionId, identity?.guestId, nickname, sharing, t]);

  return { canShare, sharing, shareToCity };
}
