/**
 * Messages screen - Direct Messages + Event Chats with filter pills.
 *
 * Three filter pills at the top:
 *   All            → both sections visible (default)
 *   Direct Messages → DM section only
 *   Event Chats     → Event Chats section only
 *
 * Filtering is purely visual - no re-fetch on switch.
 * Each pill shows an orange dot when its section has unread items.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image, Switch,
  ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useConversations } from '@/hooks/useConversations';
import { fetchMyEvents } from '@/api/events';
import {
  fetchNotificationPreferences, updateNotificationPreferences,
  type NotificationPreferences,
} from '@/api/notifications';
import { UpgradePrompt } from '@/features/auth/UpgradePrompt';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { avatarColor } from '@/lib/avatarColors';
import type { Conversation, HiladsEvent, EventChatPreview } from '@/types';

type FilterKey = 'all' | 'dms' | 'events';

// ── Relative timestamp ────────────────────────────────────────────────────────

function relativeTime(raw?: string | null): string {
  if (!raw) return '';
  let ms = Date.parse(raw);
  if (isNaN(ms)) {
    const n = Number(raw);
    if (!isNaN(n)) ms = n < 1e10 ? n * 1000 : n;
  }
  if (isNaN(ms)) return '';
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60)    return i18n.t('time.nowShort', { ns: 'common' });
  if (diffSec < 3600)  return i18n.t('time.mShort', { ns: 'common', count: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return i18n.t('time.hShort', { ns: 'common', count: Math.floor(diffSec / 3600) });
  return i18n.t('time.dShort', { ns: 'common', count: Math.floor(diffSec / 86400) });
}

// ── DM row ────────────────────────────────────────────────────────────────────

function DMRow({ convo, onPress }: { convo: Conversation; onPress: () => void }) {
  const name    = convo.other_display_name;
  const color   = avatarColor(name);
  const initial = name.slice(0, 1).toUpperCase();
  const time    = relativeTime(convo.last_message_at);

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {convo.other_photo_url ? (
        <Image source={{ uri: convo.other_photo_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatarCircle, { backgroundColor: color + '28', borderColor: color + '50' }]}>
          <Text style={[styles.avatarInitial, { color }]}>{initial}</Text>
        </View>
      )}
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowName, convo.has_unread && styles.rowNameUnread]} numberOfLines={1}>
            {name}
          </Text>
          {time ? <Text style={styles.rowTime}>{time}</Text> : null}
        </View>
        {convo.last_message ? (
          <Text
            style={[styles.rowPreview, convo.has_unread && styles.rowPreviewUnread]}
            numberOfLines={1}
          >
            {convo.last_message}
          </Text>
        ) : null}
      </View>
      {convo.has_unread && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({
  event, unread, onPress,
}: {
  event:   HiladsEvent;
  unread?: EventChatPreview;
  onPress: () => void;
}) {
  const { t } = useTranslation('dm');
  const hasUnread = (unread?.count ?? 0) > 0;
  const preview   = unread?.preview
    ?? (event.city_name
      ? `${event.city_name}${event.participant_count != null ? ` · ${t('goingCount', { count: event.participant_count })}` : ''}`
      : t('eventChatFallback'));
  const time = unread?.previewAt ? relativeTime(unread.previewAt) : '';

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.eventIcon}>
        <Text style={styles.eventEmoji}>🔥</Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowName, hasUnread && styles.rowNameUnread]} numberOfLines={1}>
            {event.title}
          </Text>
          {time ? <Text style={styles.rowTime}>{time}</Text> : null}
        </View>
        <Text style={[styles.rowPreview, hasUnread && styles.rowPreviewUnread]} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      {hasUnread && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

// ── Filter pills ──────────────────────────────────────────────────────────────

const FILTERS: { key: FilterKey; labelKey: string }[] = [
  { key: 'all',    labelKey: 'filterAll' },
  { key: 'dms',    labelKey: 'filterDms' },
  { key: 'events', labelKey: 'filterEvents' },
];

function FilterBar({
  active, dmUnread, eventsUnread, onSelect,
}: {
  active:       FilterKey;
  dmUnread:     boolean;
  eventsUnread: boolean;
  onSelect:     (f: FilterKey) => void;
}) {
  const { t } = useTranslation('dm');
  return (
    <View style={styles.filterBar}>
      {FILTERS.map(({ key, labelKey }) => {
        const isActive  = active === key;
        const hasUnread = key === 'dms' ? dmUnread : key === 'events' ? eventsUnread : (dmUnread || eventsUnread);
        return (
          <TouchableOpacity
            key={key}
            style={[styles.pill, isActive && styles.pillActive]}
            onPress={() => onSelect(key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.pillLabel, isActive && styles.pillLabelActive]}>{t(labelKey)}</Text>
            {hasUnread && <View style={[styles.pillDot, isActive && styles.pillDotActive]} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Back button ───────────────────────────────────────────────────────────────

function BackButton() {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={styles.backBtn}
      onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/chat')}
      activeOpacity={0.7}
    >
      <Feather name="chevron-left" size={22} color={Colors.text} />
    </TouchableOpacity>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MessagesScreen() {
  const router = useRouter();
  const { t } = useTranslation('dm');
  const { account, identity, eventChatPreviews, clearEventChatCounts, setUnreadDMs } = useApp();
  const { conversations, loading: loadingDMs, error, reload: reloadDMs, markAllRead: markDMsRead } = useConversations();

  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');

  const dmUnread     = conversations.some(c => c.has_unread);
  const eventsUnread = Object.values(eventChatPreviews).some(p => p.count > 0);
  const hasUnread    = dmUnread || eventsUnread;

  const markAllRead = useCallback(() => {
    markDMsRead();
    clearEventChatCounts();
  }, [markDMsRead, clearEventChatCounts]);

  // Skip refetch on initial mount - useConversations already loads on mount.
  // On subsequent focuses (returning from a DM) refetch so has_unread flags reflect
  // what the user has actually read.
  const hasMountedRef = useRef(false);
  useFocusEffect(useCallback(() => {
    clearEventChatCounts();
    setUnreadDMs(0);
    if (hasMountedRef.current) {
      reloadDMs();
    }
    hasMountedRef.current = true;
  }, [reloadDMs, clearEventChatCounts, setUnreadDMs]));

  const [events,      setEvents]      = useState<HiladsEvent[]>([]);
  const [loadingEvts, setLoadingEvts] = useState(false);

  const loadEvents = useCallback(async () => {
    if (!account || !identity?.guestId) return;
    setLoadingEvts(true);
    try {
      const evts = await fetchMyEvents(identity.guestId);
      setEvents(evts);
    } catch { /* silent */ }
    finally { setLoadingEvts(false); }
  }, [account, identity?.guestId]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // ── Envelope-scoped notification preferences ─────────────────────────────
  // Three toggles: DMs, event-chat, city-chat - mirroring the three notification
  // types that route to the envelope icon. Other prefs live on the bell screen.
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  useEffect(() => {
    if (!account) return;
    fetchNotificationPreferences().then(setPrefs).catch(() => {});
  }, [account]);

  const togglePref = useCallback((key: keyof NotificationPreferences, value: boolean) => {
    if (!prefs) return;
    const prev = prefs;
    setPrefs({ ...prefs, [key]: value });
    updateNotificationPreferences({ [key]: value }).catch(() => setPrefs(prev));
  }, [prefs]);

  const reload = useCallback(() => { reloadDMs(); loadEvents(); }, [reloadDMs, loadEvents]);

  if (!account) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <BackButton />
          <Text style={styles.headerTitle}>{t('messages', { ns: 'common' })}</Text>
          <View style={styles.markReadBtn} />
        </View>
        <UpgradePrompt
          title={t('upgradeTitle')}
          subtitle={t('upgradeSub')}
        />
      </SafeAreaView>
    );
  }

  const initialLoading = loadingDMs && conversations.length === 0 && events.length === 0;

  // Which sections to show based on active filter
  const showDMs    = activeFilter === 'all' || activeFilter === 'dms';
  const showEvents = activeFilter === 'all' || activeFilter === 'events';

  // Empty state: nothing to show for the current filter
  const filteredEmpty =
    !initialLoading && !error &&
    (showDMs    ? conversations.length === 0 : true) &&
    (showEvents ? events.length === 0        : true);

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.headerTitle}>{t('messages', { ns: 'common' })}</Text>
        {hasUnread ? (
          <TouchableOpacity onPress={markAllRead} activeOpacity={0.7} style={styles.markReadBtn}>
            <Text style={styles.markReadText}>{t('markAllRead')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.markReadBtn} />
        )}
      </View>

      {/* Filter pills */}
      <FilterBar
        active={activeFilter}
        dmUnread={dmUnread}
        eventsUnread={eventsUnread}
        onSelect={setActiveFilter}
      />

      {/* Content */}
      {initialLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={reload} activeOpacity={0.8}>
            <Text style={styles.retryText}>{t('retry', { ns: 'common' })}</Text>
          </TouchableOpacity>
        </View>
      ) : filteredEmpty ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>
            {activeFilter === 'events' ? '🔥' : '💬'}
          </Text>
          <Text style={styles.emptyTitle}>
            {activeFilter === 'events' ? t('emptyEventsTitle') : t('emptyDmsTitle')}
          </Text>
          <Text style={styles.emptySub}>
            {activeFilter === 'events'
              ? t('emptyEventsSub')
              : t('emptyDmsSub')}
          </Text>
        </View>
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={loadingDMs || loadingEvts}
              onRefresh={reload}
              tintColor={Colors.accent}
            />
          }
          contentContainerStyle={styles.listContent}
        >
          {/* Direct Messages section */}
          {showDMs && conversations.length > 0 && (
            <>
              {activeFilter === 'all' && <SectionHeader title={t('sectionDms')} />}
              {conversations.map(convo => (
                <DMRow
                  key={convo.id}
                  convo={convo}
                  onPress={() => router.push({
                    pathname: '/dm/[id]',
                    params: { id: convo.other_user_id, name: convo.other_display_name },
                  })}
                />
              ))}
            </>
          )}

          {/* Event Chats section */}
          {showEvents && (
            loadingEvts && events.length === 0 ? (
              <View style={styles.sectionLoader}>
                <ActivityIndicator color={Colors.accent} size="small" />
              </View>
            ) : events.length > 0 ? (
              <>
                {activeFilter === 'all' && <SectionHeader title={t('sectionEvents')} />}
                {events.map(event => (
                  <EventRow
                    key={event.id}
                    event={event}
                    unread={eventChatPreviews[event.id]}
                    onPress={() => router.push({
                      pathname: '/event/[id]',
                      params: { id: event.id },
                    })}
                  />
                ))}
              </>
            ) : activeFilter === 'events' ? null : null
          )}

          {/* ── Notification preferences (envelope-scoped) ────────────────── */}
          {prefs && (
            <View style={styles.prefSection}>
              <Text style={styles.prefSectionTitle}>{t('prefTitle')}</Text>
              <View style={styles.prefCard}>
                <PrefRow
                  label={t('pref.dmLabel')}
                  subtitle={t('pref.dmSub')}
                  value={prefs.dm_push}
                  onChange={v => togglePref('dm_push', v)}
                />
                <View style={styles.prefDivider} />
                <PrefRow
                  label={t('pref.eventLabel')}
                  subtitle={t('pref.eventSub')}
                  value={prefs.event_message_push}
                  onChange={v => togglePref('event_message_push', v)}
                />
                <View style={styles.prefDivider} />
                <PrefRow
                  label={t('pref.cityLabel')}
                  subtitle={t('pref.citySub')}
                  value={prefs.channel_message_push}
                  onChange={v => togglePref('channel_message_push', v)}
                />
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Preference toggle row (local - same shape as the bell screen's PrefRow) ──

function PrefRow({
  label, subtitle, value, onChange,
}: { label: string; subtitle: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.prefRow}>
      <View style={styles.prefText}>
        <Text style={styles.prefLabel}>{label}</Text>
        <Text style={styles.prefSub}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: Colors.bg3, true: Colors.accent }}
        thumbColor={Colors.white}
        ios_backgroundColor={Colors.bg3}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.bg },
  listContent: { paddingBottom: Spacing.xl },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  headerTitle: {
    flex:          1,
    textAlign:     'center',
    fontSize:      FontSizes.lg,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.4,
  },
  markReadBtn: {
    width:          80,
    alignItems:     'flex-end',
    justifyContent: 'center',
  },
  markReadText: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      Colors.accent,
  },

  // ── Filter pills ──────────────────────────────────────────────────────────
  filterBar: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   10,
    gap:               8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               5,
    paddingHorizontal: 12,
    paddingVertical:   6,
    borderRadius:      20,
    borderWidth:       1,
    borderColor:       Colors.border,
    backgroundColor:   Colors.bg2,
  },
  pillActive: {
    borderColor:     Colors.accent,
    backgroundColor: Colors.accent + '18',
  },
  pillLabel: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      Colors.muted,
  },
  pillLabelActive: {
    color: Colors.accent,
  },
  pillDot: {
    width:           6,
    height:          6,
    borderRadius:    3,
    backgroundColor: Colors.muted,
  },
  pillDotActive: {
    backgroundColor: Colors.accent,
  },

  // ── Section header ────────────────────────────────────────────────────────
  sectionHeader: {
    paddingHorizontal: Spacing.md,
    paddingTop:        Spacing.lg,
    paddingBottom:     Spacing.sm,
  },
  sectionTitle: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted2,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionLoader: {
    paddingVertical: Spacing.lg,
    alignItems:      'center',
  },

  // ── Row ───────────────────────────────────────────────────────────────────
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   14,
    gap:               Spacing.md,
  },

  avatar: {
    width: 52, height: 52, borderRadius: Radius.full,
  },
  avatarCircle: {
    width:          52,
    height:         52,
    borderRadius:   Radius.full,
    borderWidth:    1.5,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  avatarInitial: {
    fontSize:   FontSizes.lg,
    fontWeight: '700',
  },

  eventIcon: {
    width:           52,
    height:          52,
    borderRadius:    16,
    backgroundColor: Colors.bg3,
    borderWidth:     1,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },
  eventEmoji: { fontSize: 24 },

  rowBody: { flex: 1, gap: 5 },
  rowTop:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },

  rowName: {
    flex:       1,
    fontSize:   FontSizes.md,
    fontWeight: '600',
    color:      Colors.text,
  },
  rowNameUnread: { fontWeight: '800', color: Colors.white },

  rowTime: {
    fontSize:   FontSizes.xs,
    color:      Colors.muted2,
    flexShrink: 0,
  },
  rowPreview: {
    fontSize:   FontSizes.sm,
    color:      Colors.muted,
    lineHeight: 20,
  },
  rowPreviewUnread: { color: Colors.text },

  unreadDot: {
    width:           10,
    height:          10,
    borderRadius:    5,
    backgroundColor: Colors.accent,
    flexShrink:      0,
  },

  // ── States ────────────────────────────────────────────────────────────────
  center: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: Spacing.xl, gap: Spacing.sm,
  },
  errorText:  { fontSize: FontSizes.sm, color: Colors.red },
  retryBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.bg3, borderRadius: Radius.md,
  },
  retryText:  { color: Colors.accent, fontWeight: '600', fontSize: FontSizes.sm },
  emptyIcon:  { fontSize: 40, marginBottom: Spacing.sm },
  emptyTitle: { fontSize: FontSizes.md, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  emptySub:   { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', lineHeight: 20 },

  // ── Preferences (envelope-scoped - DM, event-chat, city-chat) ────────────
  prefSection:      { marginTop: Spacing.xl, paddingHorizontal: Spacing.md },
  prefSectionTitle: { fontSize: FontSizes.xs, fontWeight: '700', color: Colors.muted2, letterSpacing: 0.8, marginBottom: Spacing.sm },
  prefCard:         { backgroundColor: Colors.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  prefRow:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, gap: Spacing.md },
  prefText:         { flex: 1, gap: 3 },
  prefLabel:        { fontSize: FontSizes.md, fontWeight: '600', color: Colors.text },
  prefSub:          { fontSize: FontSizes.xs, color: Colors.muted, lineHeight: 17 },
  prefDivider:      { height: 1, backgroundColor: Colors.border, marginHorizontal: Spacing.md },
});
