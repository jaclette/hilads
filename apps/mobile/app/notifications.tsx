/**
 * Notifications (V6): filter chips per category with their unread counts,
 * sections (New, Today, Yesterday, This week, Earlier), grouped rows ("Lan and
 * 3 others liked your photo") that open their target, swipe right to mark
 * read / unread, swipe left to delete, pull to refresh, endless scroll, a
 * playful empty state per filter. "Mark all read" sweeps the list; ⚙️ opens
 * the preferences (their own screen). New notifications slide in at the top.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, SectionList, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming, Easing } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import {
  deleteNotifications, fetchInbox, markNotificationCategoriesRead, markNotificationsRead, markNotificationsSeen,
  markNotificationsUnread, NOTIF_CATEGORIES, type InboxItem, type NotifCategory,
} from '@/api/notifications';
import { Radius, type ThemeColors } from '@/constants';
import { IconButton, Screen, ScreenHeader } from '@/ui';
import { tint } from '@/ui/joy';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { InboxRow } from '@/features/notifications/InboxRow';
import { sectionOf, type SectionKey } from '@/features/notifications/inboxText';
import { CATEGORY_EMOJI, categoryColor } from '@/features/notifications/categories';
import { patchNotifCounts, refreshNotifCounts, useNotifCounts } from '@/features/notifications/counts';
import { PushOffBanner } from '@/features/notifications/PushOffBanner';

type Filter = 'all' | NotifCategory;
const SECTIONS: SectionKey[] = ['new', 'today', 'yesterday', 'week', 'earlier'];
const EMPTY_EMOJI: Record<Filter, string> = { all: '📸', social: '💬', game: '🏆', plans: '📅', city: '👋', hilads: '✨' };

export default function NotificationsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors, theme } = useTheme();
  const { t } = useTranslation('notifications');
  const { t: tc } = useTranslation('common');
  const router = useRouter();
  const { account } = useApp();
  const counts = useNotifCounts();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();

  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const known = useRef(new Set<number>());   // ids already shown: new ones slide in
  const fresh = useRef(new Set<number>());

  const categories = filter === 'all' ? undefined : [filter];
  // The filter shown now: an answer for another one (a chip tapped while loading) is dropped.
  const current = useRef(filter);
  current.current = filter;
  const load = useCallback(async (mode: 'first' | 'refresh' | 'more') => {
    if (mode === 'more' && (!cursor || loadingMore)) return;
    if (mode === 'more') setLoadingMore(true);
    const asked = filter;
    try {
      const page = await fetchInbox({ categories, cursor: mode === 'more' ? cursor : null, limit: 30 });
      if (current.current !== asked) return;
      if (mode !== 'first') page.items.forEach(i => { if (!known.current.has(i.id)) fresh.current.add(i.id); });
      page.items.forEach(i => known.current.add(i.id));
      setItems(prev => (mode === 'more' && prev ? [...prev, ...page.items.filter(i => !prev.some(p => p.id === i.id))] : page.items));
      setCursor(page.nextCursor);
    } catch {
      if (current.current === asked) setItems(prev => prev ?? []);
    } finally {
      setLoadingMore(false);
    }
  }, [filter, cursor, loadingMore]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setItems(null); setCursor(null); known.current.clear(); load('first'); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once the first page is on screen (its "New" section drawn), everything is seen:
  // the "While you were away" card won't show it again.
  const markedSeen = useRef(false);
  useEffect(() => {
    if (items === null || markedSeen.current) return;
    markedSeen.current = true;
    markNotificationsSeen({ categories: NOTIF_CATEGORIES });
    patchNotifCounts(c => ({ ...c, unseen: { social: 0, game: 0, plans: 0, city: 0, hilads: 0 } }));
  }, [items]);

  // New notifications while the screen is open (the counts store polls): they slide in at the top.
  const lastTotal = useRef(counts.total);
  useEffect(() => {
    if (counts.total > lastTotal.current && items) load('refresh');
    lastTotal.current = counts.total;
  }, [counts.total]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([load('refresh'), refreshNotifCounts()]);
    setRefreshing(false);
  };

  const readLocally = (ids: number[], read: boolean) => {
    setItems(prev => prev?.map(i => (i.ids.some(id => ids.includes(id)) ? { ...i, read } : i)) ?? prev);
  };
  const open = (item: InboxItem) => {
    if (!item.read) {
      readLocally(item.ids, true);
      markNotificationsRead(item.ids).then(refreshNotifCounts);
    }
    const link = item.deep_link;
    if (!link) return;
    if (link.startsWith('/user/') && !canAccessProfile(account)) return;
    router.push(link as never);
  };
  const toggleRead = (item: InboxItem) => {
    readLocally(item.ids, !item.read);
    (item.read ? markNotificationsUnread(item.ids) : markNotificationsRead(item.ids)).then(refreshNotifCounts);
  };
  const remove = (item: InboxItem) => {
    setItems(prev => prev?.filter(i => i.id !== item.id) ?? prev);
    deleteNotifications(item.ids).then(refreshNotifCounts);
  };

  // "Mark all read": a light sweeps across the list, a success haptic, every row turns calm.
  const sweep = useSharedValue(-1);
  const sweepStyle = useAnimatedStyle(() => ({ transform: [{ translateX: sweep.value * width }], opacity: sweep.value > -1 && sweep.value < 1 ? 1 : 0 }));
  const markAll = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (!reduced) sweep.value = withSequence(withTiming(-1, { duration: 0 }), withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }));
    setItems(prev => prev?.map(i => ({ ...i, read: true })) ?? prev);
    patchNotifCounts(c => ({ ...c, total: filter === 'all' ? 0 : Math.max(0, c.total - (c.unread[filter] ?? 0)),
      unread: filter === 'all' ? { social: 0, game: 0, plans: 0, city: 0, hilads: 0 } : { ...c.unread, [filter]: 0 } }));
    (filter === 'all' ? markNotificationsRead() : markNotificationCategoriesRead([filter])).then(refreshNotifCounts);
  };

  const sections = useMemo(() => {
    const by = new Map<SectionKey, InboxItem[]>();
    for (const i of items ?? []) {
      const k = sectionOf(i);
      by.set(k, [...(by.get(k) ?? []), i]);
    }
    return SECTIONS.filter(k => by.has(k)).map(k => ({ key: k, data: by.get(k)! }));
  }, [items]);

  const anyUnread = filter === 'all' ? counts.total > 0 : (counts.unread[filter] ?? 0) > 0;
  const chips: Filter[] = ['all', ...NOTIF_CATEGORIES];

  return (
    <Screen>
      <ScreenHeader title={tc('notifications')} testID="notifications-screen" right={(
        <View style={styles.headerRight}>
          {anyUnread && (
            <Pressable onPress={markAll} hitSlop={8} accessibilityRole="button" testID="mark-all-read">
              <Text style={styles.markAll}>{t('markAllRead')}</Text>
            </Pressable>
          )}
          <IconButton icon="settings-outline" label={t('inbox.settings')} onPress={() => router.push('/notification-settings' as never)} />
        </View>
      )} />

      {/* Filters, always in view above the list. */}
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {chips.map(f => {
            const on = filter === f;
            const c = f === 'all' ? null : categoryColor(f, theme === 'dark');
            const n = f === 'all' ? counts.total : counts.unread[f] ?? 0;
            return (
              <Pressable key={f} onPress={() => { Haptics.selectionAsync().catch(() => {}); setFilter(f); }} accessibilityRole="tab"
                         accessibilityState={{ selected: on }} testID={`inbox-chip-${f}`}
                         style={[styles.chip, on && { backgroundColor: c ? c.fill : colors.text, borderColor: c ? c.fill : colors.text }]}>
                <Text style={[styles.chipText, on && { color: c ? c.onFill : colors.bg }]}>
                  {f === 'all' ? t('inbox.all') : `${CATEGORY_EMOJI[f]} ${t(`inbox.cat.${f}`)}`}
                </Text>
                {n > 0 && (
                  <View style={[styles.chipCount, { backgroundColor: on ? tint('#000000', 0.15) : c ? tint(c.fill, 0.3) : colors.primaryTint }]}>
                    <Text style={[styles.chipCountText, on && { color: c ? c.onFill : colors.bg }]}>{n > 99 ? '99+' : n}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <PushOffBanner />

      <View style={styles.flex}>
        {items === null ? <Skeleton /> : (
          <SectionList
            sections={sections}
            keyExtractor={i => String(i.id)}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => <Text style={styles.section}>{t(`inbox.sec.${section.key}`)}</Text>}
            renderItem={({ item }) => {
              const row = <InboxRow item={item} onPress={open} onToggleRead={toggleRead} onDelete={remove} />;
              if (!fresh.current.has(item.id) || reduced) return row;
              fresh.current.delete(item.id);
              return <Animated.View entering={FadeInDown.springify().damping(14)}>{row}</Animated.View>;
            }}
            onEndReached={() => load('more')}
            onEndReachedThreshold={0.5}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} title="🔔" />}
            contentContainerStyle={!items.length ? styles.emptyWrap : styles.list}
            ListEmptyComponent={(
              <View style={styles.empty} testID="inbox-empty">
                <View style={[styles.emptyBubble, { backgroundColor: filter === 'all' ? colors.primaryTint : tint(categoryColor(filter, theme === 'dark').fill, 0.25) }]}>
                  <Text style={styles.emptyEmoji}>{EMPTY_EMOJI[filter]}</Text>
                </View>
                <Text style={styles.emptyText}>{t(`inbox.empty.${filter}`)}</Text>
              </View>
            )}
          />
        )}
        <Animated.View pointerEvents="none" style={[styles.sweep, { width: width * 0.5, backgroundColor: tint(colors.cta, 0.18) }, sweepStyle]} />
      </View>
    </Screen>
  );
}

/** Placeholder rows while the first page loads, gently breathing. */
function Skeleton() {
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();
  const o = useSharedValue(0.5);
  useEffect(() => {
    if (!reduced) o.value = withSequence(withTiming(1, { duration: 600 }), withTiming(0.5, { duration: 600 }), withTiming(1, { duration: 600 }), withTiming(0.5, { duration: 600 }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View style={[styles.list, style]} accessibilityLabel="…">
      {Array.from({ length: 7 }, (_, i) => (
        <View key={i} style={styles.skelRow}>
          <View style={styles.skelAvatar} />
          <View style={styles.skelBody}><View style={[styles.skelLine, { width: '80%' }]} /><View style={[styles.skelLine, { width: '45%' }]} /></View>
        </View>
      ))}
    </Animated.View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  flex:          { flex: 1 },
  headerRight:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  markAll:       { fontSize: 14, fontWeight: '800', color: c.primaryText },
  chips:         { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  chip:          { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: Radius.full,
                   borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2 },
  chipText:      { fontSize: 14, lineHeight: 18, fontWeight: '800', color: c.text },
  chipCount:     { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipCountText: { fontSize: 11, lineHeight: 14, fontWeight: '800', color: c.text },
  list:          { paddingBottom: 32 },
  section:       { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, fontSize: 13, lineHeight: 17, fontWeight: '800', color: c.muted, backgroundColor: c.bg },
  emptyWrap:     { flexGrow: 1 },
  empty:         { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingVertical: 60, gap: 16 },
  emptyBubble:   { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji:    { fontSize: 44, lineHeight: 54 },
  emptyText:     { fontSize: 16, lineHeight: 22, fontWeight: '700', color: c.text, textAlign: 'center' },
  sweep:         { position: 'absolute', top: 0, bottom: 0, left: 0 },
  skelRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  skelAvatar:    { width: 46, height: 46, borderRadius: 23, backgroundColor: c.bg3 },
  skelBody:      { flex: 1, gap: 8 },
  skelLine:      { height: 12, borderRadius: 6, backgroundColor: c.bg3 },
});
