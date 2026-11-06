import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeOutUp, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Avatar } from '@/ui';
import { shortCityName } from '@/i18n/cityName';
import { fetchInbox, markNotificationsSeen, type InboxActor, type InboxItem } from '@/api/notifications';
import { patchNotifCounts, useNotifCounts } from './counts';

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** One short fragment per item ("🏆 #2 in the world yesterday", "💬 Lan commented on your photo"); likes are summed. */
export function awayLine(items: InboxItem[], t: TFn, max = 3): string {
  const parts: string[] = [];
  const game = items.filter(i => i.category === 'game');
  for (const g of game) {
    const d = g.data;
    if (g.type === 'daily_result') {
      const city = shortCityName(d.cityName);
      parts.push(d.worldRank ? t('away.rankWorld', { rank: d.worldRank })
        : d.cityBest ? t('away.cityBest', { city })
        : d.cityRank ? t('away.rankCity', { rank: d.cityRank, city })
        : t('away.votes', { count: d.votes ?? 0 }));
    } else if (g.type === 'daily_local_pass') {
      parts.push(t('away.localPass', { city: shortCityName(d.cityName ?? '') }));
    }
  }
  const comments = items.filter(i => i.type === 'photo_comment');
  if (comments.length === 1 && comments[0].count === 1 && comments[0].actors[0]) {
    parts.push(t('away.comment', { name: comments[0].actors[0].name }));
  } else if (comments.length) {
    parts.push(t('away.comments'));
  }
  const likes = items.filter(i => i.type === 'daily_vote').reduce((n, i) => n + i.count, 0);
  if (likes > 0) parts.push(t('away.likes', { count: likes }));
  for (const i of items) {
    const name = i.actors[0]?.name;
    if (!name) continue;
    if (i.type === 'mention' || i.type === 'photo_mention') parts.push(t('away.mention', { name }));
    else if (i.type === 'friend_request_received') parts.push(t('away.friend', { name }));
    else if (i.type === 'profile_view') parts.push(t('away.view', { name }));
  }
  if (!parts.length) parts.push(t('away.other'));
  return parts.slice(0, max).join(' · ');
}

/**
 * "While you were away" (V6), at the top of Today: when there are unseen
 * Social or Game notifications, stacked avatars and a one-liner of the most
 * important ones. A tap opens the notifications; ✕ or a swipe sideways
 * dismisses it (seen, not read), so the same items never show twice.
 */
export function WhileAwayCard() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('notifications');
  const router = useRouter();
  const { account } = useApp();
  const { unseen } = useNotifCounts();
  const reduced = useReducedMotion();
  const pending = (unseen.social ?? 0) + (unseen.game ?? 0);
  const [items, setItems] = useState<InboxItem[] | null>(null);

  useEffect(() => {
    if (!account || pending === 0) { setItems(null); return; }
    let alive = true;
    fetchInbox({ categories: ['social', 'game'], unseen: true, limit: 8 })
      .then(r => { if (alive) setItems(r.items); })
      .catch(() => {});
    return () => { alive = false; };
  }, [account, pending]);

  const ids = useMemo(() => (items ?? []).flatMap(i => i.ids), [items]);
  const seen = useCallback(() => {
    markNotificationsSeen({ ids });
    patchNotifCounts(c => ({ ...c, unseen: { ...c.unseen, social: 0, game: 0 } }));
    setItems(null);
  }, [ids]);
  const dismiss = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    seen();
  }, [seen]);
  const open = () => {
    seen();
    router.push('/notifications' as never);
  };

  // Swipe it away sideways; short of the threshold it springs back.
  const tx = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-10, 10])
    .onUpdate(e => { tx.value = e.translationX; })
    .onEnd(e => {
      if (Math.abs(e.translationX) > 110 || Math.abs(e.velocityX) > 800) {
        tx.value = withTiming(Math.sign(e.translationX || 1) * 500, { duration: 180 }, () => runOnJS(dismiss)());
      } else {
        tx.value = withSpring(0);
      }
    });
  const move = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }], opacity: 1 - Math.min(0.6, Math.abs(tx.value) / 400) }));

  if (!items?.length) return null;
  const actors: InboxActor[] = [];
  for (const i of items) for (const a of i.actors) {
    if (actors.length < 3 && !actors.some(x => (x.id ?? x.name) === (a.id ?? a.name))) actors.push(a);
  }
  const line = awayLine(items, t);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View entering={reduced ? undefined : FadeInDown.springify().damping(13)} exiting={reduced ? undefined : FadeOutUp}
                     style={[styles.card, move]} testID="while-away">
        <Pressable onPress={open} style={styles.row} accessibilityRole="button" accessibilityLabel={`${t('away.title')}. ${line}`}
                   accessibilityHint={t('away.open')}>
          {actors.length > 0 && (
            <View style={[styles.stack, { width: 30 + (actors.length - 1) * 18 }]}>
              {actors.map((a, i) => (
                <View key={a.id ?? a.name} style={[styles.avatar, { left: i * 18, zIndex: 3 - i }]}>
                  <Avatar uri={a.photoUrl} name={a.name} size={30} />
                </View>
              ))}
            </View>
          )}
          <View style={styles.body}>
            <Text style={styles.title} numberOfLines={1}>{t('away.title')}</Text>
            <Text style={styles.line} numberOfLines={2}>{line}</Text>
          </View>
        </Pressable>
        <Pressable onPress={dismiss} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel={t('away.dismiss')}>
          <Ionicons name="close" size={18} color={colors.muted} />
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 8, paddingVertical: 10,
            borderRadius: Radius.card, backgroundColor: c.primaryTint, borderWidth: 1.5, borderColor: c.primary },
  row:    { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  stack:  { height: 34 },
  avatar: { position: 'absolute', top: 0, borderRadius: 17, borderWidth: 2, borderColor: c.primaryTint },
  body:   { flex: 1 },
  title:  { fontSize: 12, lineHeight: 16, fontWeight: '800', color: c.primaryOnTint },
  line:   { fontSize: 14, lineHeight: 19, fontWeight: '700', color: c.text, marginTop: 1 },
  close:  { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
