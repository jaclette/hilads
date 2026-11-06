import { memo, useRef } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar } from '@/ui';
import { tint } from '@/ui/joy';
import { thumbUrl } from '@/lib/imageThumb';
import type { InboxItem } from '@/api/notifications';
import { relativeTime } from './NotifRow';
import { rowText } from './inboxText';
import { CATEGORY_EMOJI, categoryColor } from './categories';

/** Game rows get a big emoji instead of an avatar. */
const GAME_ICON: Record<string, string> = { daily_result: '🏆', daily_local_pass: '🎟️', daily_rank: '📈', daily_twist_completed: '🌀', daily_twist_picked: '🌀' };

/**
 * One inbox item (V6): avatar (stacked when several people) with the
 * category's emoji on its corner, the sentence with bold names, a quote for
 * comments, the time, and the photo on the right. Unread: a soft orange
 * ground and a dot. Swipe right: read / unread; swipe left: delete.
 */
export const InboxRow = memo(function InboxRow({ item, onPress, onToggleRead, onDelete }: {
  item: InboxItem;
  onPress: (item: InboxItem) => void;
  onToggleRead: (item: InboxItem) => void;
  onDelete: (item: InboxItem) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors, theme } = useTheme();
  const { t } = useTranslation('notifications');
  const ref = useRef<SwipeableMethods>(null);
  const text = rowText(item, t);
  const cat = categoryColor(item.category, theme === 'dark');
  const unread = !item.read;
  const icon = GAME_ICON[item.type];
  const thumb = item.object?.kind === 'photo' ? item.object.thumbUrl : null;

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.6}
      leftThreshold={70}
      rightThreshold={70}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() => (
        <View style={[styles.action, styles.actionLeft, { backgroundColor: colors.primary }]}>
          <Ionicons name={unread ? 'mail-open-outline' : 'mail-unread-outline'} size={20} color={colors.white} />
          <Text style={styles.actionText}>{unread ? t('inbox.read') : t('inbox.unread')}</Text>
        </View>
      )}
      renderRightActions={() => (
        <View style={[styles.action, styles.actionRight, { backgroundColor: colors.red }]}>
          <Ionicons name="trash-outline" size={20} color={colors.white} />
          <Text style={styles.actionText}>{t('inbox.delete')}</Text>
        </View>
      )}
      onSwipeableOpen={dir => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        if (String(dir) === 'right') onToggleRead(item);   // swiped right: the left action (read / unread)
        else onDelete(item);
        ref.current?.close();
      }}
    >
      <Pressable onPress={() => onPress(item)} style={[styles.row, unread && { backgroundColor: tint(cat.fill, theme === 'dark' ? 0.14 : 0.1) }]}
                 accessibilityRole="button" testID="inbox-row"
                 accessibilityLabel={[text.parts.map(p => p.text).join(''), text.quote, relativeTime(item.created_at)].filter(Boolean).join('. ')}>
        <View style={styles.lead}>
          {icon ? (
            <View style={[styles.gameIcon, { backgroundColor: tint(cat.fill, 0.25) }]}><Text style={styles.gameEmoji}>{icon}</Text></View>
          ) : item.actors.length > 1 ? (
            <View style={styles.stack}>
              <View style={[styles.stackBack, { borderColor: colors.bg }]}><Avatar uri={item.actors[1].photoUrl} name={item.actors[1].name} size={32} /></View>
              <View style={[styles.stackFront, { borderColor: colors.bg }]}><Avatar uri={item.actors[0].photoUrl} name={item.actors[0].name} size={32} /></View>
            </View>
          ) : (
            <Avatar uri={item.actors[0]?.photoUrl ?? null} name={item.actors[0]?.name ?? '✨'} size={46} />
          )}
          {!icon && (
            <View style={[styles.catBadge, { backgroundColor: cat.fill, borderColor: colors.bg }]}>
              <Text style={styles.catEmoji}>{CATEGORY_EMOJI[item.category]}</Text>
            </View>
          )}
        </View>
        <View style={styles.body}>
          <Text style={styles.sentence} numberOfLines={3}>
            {text.parts.map((p, i) => <Text key={i} style={p.bold ? styles.bold : undefined}>{p.text}</Text>)}
          </Text>
          {!!text.quote && <Text style={styles.quote} numberOfLines={2}>“{text.quote}”</Text>}
          <Text style={[styles.time, unread && { color: cat.text }]}>{relativeTime(item.created_at)}</Text>
        </View>
        {thumb ? <Image source={{ uri: thumbUrl(thumb) ?? thumb }} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" /> : null}
        {unread && <View style={[styles.dot, { backgroundColor: cat.fill }]} />}
      </Pressable>
    </ReanimatedSwipeable>
  );
});

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 16, paddingRight: 22, backgroundColor: c.bg },
  lead:       { width: 46, height: 46 },
  stack:      { width: 46, height: 46 },
  stackBack:  { position: 'absolute', top: 0, right: 0, borderRadius: 18, borderWidth: 2 },
  stackFront: { position: 'absolute', bottom: 0, left: 0, borderRadius: 18, borderWidth: 2 },
  gameIcon:   { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  gameEmoji:  { fontSize: 24, lineHeight: 30 },
  catBadge:   { position: 'absolute', right: -4, bottom: -4, width: 22, height: 22, borderRadius: 11, borderWidth: 2,
                alignItems: 'center', justifyContent: 'center' },
  catEmoji:   { fontSize: 11, lineHeight: 14 },
  body:       { flex: 1, gap: 2 },
  sentence:   { fontSize: 15, lineHeight: 20, color: c.text },
  bold:       { fontWeight: '800' },
  quote:      { fontSize: 14, lineHeight: 19, color: c.muted },
  time:       { fontSize: 12, lineHeight: 16, fontWeight: '700', color: c.muted, marginTop: 2 },
  thumb:      { width: 48, height: 48, borderRadius: 10, backgroundColor: c.bg3 },
  dot:        { position: 'absolute', right: 8, top: '50%', width: 8, height: 8, borderRadius: 4 },
  action:     { width: 96, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionLeft: { borderTopRightRadius: Radius.card, borderBottomRightRadius: Radius.card },
  actionRight: { borderTopLeftRadius: Radius.card, borderBottomLeftRadius: Radius.card },
  actionText: { fontSize: 12, fontWeight: '800', color: c.white },
});
