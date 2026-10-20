/**
 * Shared app header (V3, SPEC 9.1 / mockups): the "Hi" mark, the app-wide
 * scope selector (current city or World, shared by every tab), then the
 * tab-specific extras, the private messages button where asked (Chat) and
 * the notification bell (members) - or a Sign up button for guests (V3-11).
 *
 * Pulls unread counts + setters from AppContext to avoid prop drilling.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { BrandMark, IconButton } from '@/ui';
import { ScopeSelector } from './ScopeSelector';

interface Props {
  /** Optional nodes injected before the messages / bell buttons. */
  rightExtra?: React.ReactNode;
  /** Show the private messages button (Chat, SPEC 9.6). */
  messages?: boolean;
}

export function AppHeader({ rightExtra, messages = false }: Props) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { t } = useTranslation('common');
  const { account, unreadDMs, setUnreadDMs, unreadNotifications, clearEventChatCounts } = useApp();

  return (
    <View style={styles.bar}>
      <BrandMark />

      <ScopeSelector />

      {rightExtra}

      {messages && account && (
        <IconButton icon="paper-plane-outline" iconSize={20} label={t('messages')} badge={unreadDMs > 0}
                    onPress={() => { setUnreadDMs(0); clearEventChatCounts(); router.push('/messages'); }} />
      )}

      {account ? (
        <IconButton icon="notifications-outline" iconSize={21} badge={unreadNotifications > 0}
                    label={unreadNotifications > 0 ? t('notificationsUnread', { count: unreadNotifications }) : t('notifications')}
                    onPress={() => router.push('/notifications' as never)} />
      ) : (
        <TouchableOpacity
          style={styles.signUp}
          onPress={() => router.push('/sign-up?action=header' as never)}
          accessibilityRole="button"
        >
          <Text style={styles.signUpText} numberOfLines={1}>{t('signUp')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  // No horizontal padding: each tab's header container sets it.
  bar:            { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, paddingBottom: 6 },
  signUp:         { height: 44, paddingHorizontal: 16, borderRadius: Radius.full, backgroundColor: c.cta, alignItems: 'center', justifyContent: 'center' },
  signUpText:     { color: c.onCta, fontSize: 14, fontWeight: '800' },
});
