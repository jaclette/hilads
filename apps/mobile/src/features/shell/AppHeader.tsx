/**
 * Shared app header (V3, SPEC 9.1 / mockups): the "Hi" mark, the app-wide
 * scope selector (current city or World, shared by every tab), then the
 * tab-specific extras, the private messages button where asked (Chat) and
 * the notification bell (members) - or a Sign up button for guests (V3-11).
 *
 * Pulls unread counts + setters from AppContext to avoid prop drilling.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { Space, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { BrandMark, Button } from '@/ui';
import { ScopeSelector } from './ScopeSelector';
import { LogoHat } from '@/features/event/SeasonalArt';
import { BellButton } from '@/features/notifications/BellButton';
import { MessagesButton } from '@/features/messages/MessagesButton';

interface Props {
  /** Optional nodes injected before the messages / bell buttons. */
  rightExtra?: React.ReactNode;
  /** Show the private messages button next to the bell (members; on by default: DMs never buried in Passport). */
  messages?: boolean;
}

export function AppHeader({ rightExtra, messages = true }: Props) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { t } = useTranslation('common');
  const { account } = useApp();

  return (
    <View style={styles.bar}>
      {/* A seasonal event's live day: the logo wears its hat. */}
      <View style={styles.logo}><BrandMark /><LogoHat logoSize={40} /></View>

      <ScopeSelector />

      {rightExtra}

      {/* Its count clears when the messages are read (the Messages list), never just on tap. */}
      {messages && account && <MessagesButton onPress={() => router.push('/messages' as never)} />}

      {account ? (
        <BellButton onPress={() => router.push('/notifications' as never)} />
      ) : (
        <Button size="sm" label={t('signUp')} onPress={() => router.push('/sign-up?action=header' as never)} testID="header-signup" />
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  // No horizontal padding: each tab's header container sets it.
  bar:            { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingTop: Space.md, paddingBottom: Space.sm },
  logo:           { overflow: 'visible' },
});
