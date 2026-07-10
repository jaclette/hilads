/**
 * useShareToWorld - one-tap "share this (international) challenge into the global
 * World channel". The World version of useShareToCity: posts the challenge
 * deeplink as a World message (rendered as a clickable link card), then opens
 * the chat tab in World scope so the sharer sees it land.
 */

import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApp } from '@/context/AppContext';
import { sendWorldMessage } from '@/api/world';
import { requestWorldScopeOpen } from '@/lib/worldScopeOpen';
import { useTranslation } from 'react-i18next';

export function useShareToWorld() {
  const { identity, account } = useApp();
  const { t } = useTranslation('common');
  const [sharing, setSharing] = useState(false);

  const nickname = account?.display_name ?? identity?.nickname ?? '';
  const canShare = !!identity?.guestId;

  const shareToWorld = useCallback(async (url: string) => {
    if (!identity?.guestId || sharing) return;
    setSharing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await sendWorldMessage(identity.guestId, nickname, url);
      // Chat tab is persistent + city-default; flag it to open in World scope on
      // focus so the freshly posted card is visible, then jump there.
      requestWorldScopeOpen();
      router.replace('/(tabs)/chat');
    } catch {
      Alert.alert(t('shareToWorldError', { defaultValue: 'Could not share to World. Try again.' }));
    } finally {
      setSharing(false);
    }
  }, [identity?.guestId, nickname, sharing, t]);

  return { canShare, sharing, shareToWorld };
}
