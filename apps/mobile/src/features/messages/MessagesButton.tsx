import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Space, FontSizes, Border, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { badgeCount, useUnreadMessages } from './unread';

/**
 * The header's messages button, next to the bell (same round shape): a chat
 * bubble with the unread count in a red badge ("3", "9+"), opening the
 * Messages list. The count is the one of every messages badge (unread.ts).
 */
export function MessagesButton({ onPress }: { onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const n = useUnreadMessages();
  return (
    <Pressable onPress={onPress} style={styles.round} accessibilityRole="button" testID="header-messages"
               accessibilityLabel={n > 0 ? `${t('messages')}, ${n}` : t('messages')}>
      <Ionicons name={n > 0 ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'} size={21} color={colors.text} />
      {n > 0 && <View style={styles.badge}><Text style={styles.badgeText} numberOfLines={1}>{badgeCount(n)}</Text></View>}
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  round:     { width: 44, height: 44, borderRadius: Radius.full, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2,
               alignItems: 'center', justifyContent: 'center' },
  badge:     { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, paddingHorizontal: Space.xs, borderRadius: 10,
               backgroundColor: c.red, borderWidth: 2, borderColor: c.bg, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: FontSizes.tiny, lineHeight: 14, fontWeight: '800', color: c.white },
});
