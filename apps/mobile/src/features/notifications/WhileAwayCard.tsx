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
import { fetchInbox, markNotificationsRead, markNotificationsSeen, type InboxActor, type InboxItem } from '@/api/notifications';
import { canAccessProfile } from '@/lib/profileAccess';
import { track } from '@/services/analytics';
import { patchNotifCounts, refreshNotifCounts, useNotifCounts } from './counts';
import { setAwayShowsResults } from './awayResults';

type TFn = (key: string, opts?: Record<string, unknown>) => string;

// What counts most, first: results, then comments, mentions, likes, friends, the Local Pass, profile views.
const PRIORITY = ['daily_result', 'daily_rank', 'photo_comment', 'photo_mention', 'mention', 'daily_vote',
  'friend_request_received', 'daily_local_pass', 'profile_view'];
const rank = (i: InboxItem) => { const r = PRIORITY.indexOf(i.type); return r < 0 ? PRIORITY.length : r; };

/** The unseen items, the most important first (newest first within a type). */
export function byImportance(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => rank(a) - rank(b) || b.created_at.localeCompare(a.created_at));
}

/** One item's fragment ("🏆 #2 in the world yesterday", "💬 Lan commented on your photo"); likes are summed. */
function fragment(i: InboxItem, items: InboxItem[], t: TFn): string | null {
  const d = i.data;
  const name = i.actors[0]?.name;
  switch (i.type) {
    case 'daily_result': {
      const city = shortCityName(d.cityName);
      return d.worldRank ? t('away.rankWorld', { rank: d.worldRank })
        : d.cityBest ? t('away.cityBest', { city })
        : d.cityRank ? t('away.rankCity', { rank: d.cityRank, city })
        : t('away.votes', { count: d.votes ?? 0 });
    }
    case 'daily_local_pass': return t('away.localPass', { city: shortCityName(d.cityName ?? '') });
    case 'photo_comment': {
      const all = items.filter(x => x.type === 'photo_comment');
      return all.length === 1 && i.count === 1 && name ? t('away.comment', { name }) : t('away.comments');
    }
    case 'daily_vote': return t('away.likes', { count: items.filter(x => x.type === 'daily_vote').reduce((n, x) => n + x.count, 0) });
    case 'mention': case 'photo_mention': return name ? t('away.mention', { name }) : null;
    case 'friend_request_received': return name ? t('away.friend', { name }) : null;
    case 'profile_view': return name ? t('away.view', { name }) : null;
    default: return null;
  }
}

/** The one-liner: the fragments, most important first, each kind once ("💬 New comments on your photo · ❤️ +3"). */
export function awayLine(items: InboxItem[], t: TFn, max = 3): string {
  const parts: string[] = [];
  for (const i of byImportance(items)) {
    const f = fragment(i, items, t);
    if (f && !parts.includes(f)) parts.push(f);
  }
  if (!parts.length) parts.push(t('away.other'));
  return parts.slice(0, max).join(' · ');
}

/** The object every item is about, when they all are about the same one (a photo, a plan). */
function sameObject(items: InboxItem[]): string | null {
  const keys = items.map(i => (i.object && 'id' in i.object && i.object.id ? `${i.object.kind}:${i.object.id}` : null));
  return keys[0] && keys.every(k => k === keys[0]) ? keys[0] : null;
}

/**
 * "While you were away" (V6), at the top of Today: when there are unseen
 * Social or Game notifications, stacked avatars and a one-liner, most
 * important first, on one line (cut with an ellipsis). A tap on it opens that
 * most important thing itself (new comments: the photo with its comments open
 * on the latest; a like: the photo; results: Ranks; a plan: the plan); when
 * every item is about the same photo, the whole card goes there. The others
 * show as a "+3" pill next to ✕, which opens the notifications on just those.
 * Opening marks the related notifications read and the card slides away. ✕ or
 * a swipe sideways dismisses it (seen, not read).
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
  // Yesterday's results among the items: this card carries them (the results card stays hidden).
  useEffect(() => {
    setAwayShowsResults(!!items?.some(i => i.type === 'daily_result'));
    return () => setAwayShowsResults(false);
  }, [items]);
  // New items: the card comes back in place (a swipe left it off-screen).
  useEffect(() => { tx.value = 0; }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items?.length) return null;
  const sorted = byImportance(items);
  const main = sorted[0];
  const single = items.length === 1 || sameObject(items) !== null;
  const more = single ? 0 : items.length - 1;
  const actors: InboxActor[] = [];
  for (const i of sorted) for (const a of i.actors) {
    if (actors.length < 3 && !actors.some(x => (x.id ?? x.name) === (a.id ?? a.name))) actors.push(a);
  }
  const line = awayLine(items, t);

  // The card slides out, then the item opens (its notifications read: the related ones, or all on the same object).
  const leave = (then: () => void, readIds: number[] | null) => {
    Haptics.selectionAsync().catch(() => {});
    if (readIds?.length) markNotificationsRead(readIds).then(refreshNotifCounts);
    const go = () => { seen(); then(); };
    if (reduced) { go(); return; }
    tx.value = withTiming(-500, { duration: 200 }, () => runOnJS(go)());
  };
  const openMain = () => {
    const link = main.deep_link;
    const readIds = single ? ids : sorted.filter(i => i.type === main.type && sameKey(i, main)).flatMap(i => i.ids);
    track('away_card_opened', { type: main.type, single, more });
    leave(() => {
      if (!link || (link.startsWith('/user/') && !canAccessProfile(account))) { router.push('/notifications' as never); return; }
      // Results: yesterday's photos ranking, on my photo (with a little confetti).
      router.push((main.type === 'daily_result' ? '/ranks?tab=photos&period=yesterday&focus=me' : link) as never);
    }, readIds);
  };
  const openMore = () => {
    track('away_card_more', { count: more });
    // The notifications, on just the items the card stands for (the screen can show them all again).
    leave(() => router.push(`/notifications?only=${items.map(i => i.id).join(',')}` as never), null);
  };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View entering={reduced ? undefined : FadeInDown.springify().damping(13)} exiting={reduced ? undefined : FadeOutUp}
                     style={[styles.card, move]} testID="while-away">
        <Pressable onPress={openMain} style={styles.row} accessibilityRole="button" accessibilityLabel={`${t('away.title')}. ${line}`}
                   accessibilityHint={t('away.open')} testID="while-away-main">
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
            <Text style={styles.line} numberOfLines={1}>{line}</Text>
          </View>
        </Pressable>
        {more > 0 && (
          <Pressable onPress={openMore} hitSlop={8} style={styles.more} accessibilityRole="button"
                     accessibilityLabel={t('away.more', { count: more })} testID="while-away-more">
            <Text style={styles.moreText}>+{more}</Text>
          </Pressable>
        )}
        <Pressable onPress={dismiss} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel={t('away.dismiss')}>
          <Ionicons name="close" size={18} color={colors.muted} />
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

/** Same thing: the same photo / plan, else the same type. */
function sameKey(a: InboxItem, b: InboxItem): boolean {
  const k = (i: InboxItem) => (i.object && 'id' in i.object ? `${i.object.kind}:${i.object.id}` : i.type);
  return k(a) === k(b);
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
  more:   { minWidth: 34, height: 26, paddingHorizontal: 8, borderRadius: 13, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 13, lineHeight: 17, fontWeight: '800', color: c.white },
  close:  { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
