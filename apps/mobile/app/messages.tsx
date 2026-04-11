/**
 * Messages screen — Direct Messages + Event Chats with filter pills.
 *
 * Three filter pills at the top:
 *   All            → both sections visible (default)
 *   Direct Messages → DM section only
 *   Event Chats     → Event Chats section only
 *
 * Filtering is purely visual — no re-fetch on switch.
 * Each pill shows an orange dot when its section has unread items.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useConversations } from '@/hooks/useConversations';
import { fetchMyEvents } from '@/api/events';
import { UpgradePrompt } from '@/features/auth/UpgradePrompt';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { Conversation, HiladsEvent, EventChatPreview } from '@/types';

type FilterKey = 'all' | 'dms' | 'events';

// ── Avatar palette ────────────────────────────────────────────────────────────

const AVATAR_PALETTE = [
  '#C24A38', '#B87228', '#3ddc84', '#8B5CF6',
  '#0EA5E9', '#E879A0', '#F59E0B', '#14B8A6',
];

function avatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

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
  if (diffSec < 60)    return 'now';
  if (diffSec < 3600)  return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
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
  const hasUnread = (unread?.count ?? 0) > 0;
  const preview   = unread?.preview
    ?? (event.city_name
      ? `${event.city_name}${event.participant_count != null ? ` · ${event.participant_count} going` : ''}`
      : 'Event chat');
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

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',    label: 'All' },
  { key: 'dms',    label: 'Direct Messages' },
  { key: 'events', label: 'Event Chats' },
];

function FilterBar({
  active, dmUnread, eventsUnread, onSelect,
}: {
  active:       FilterKey;
  dmUnread:     boolean;
  eventsUnread: boolean;
  onSelect:     (f: FilterKey) => void;
}) {
  return (
    <View style={styles.filterBar}>
      {FILTERS.map(({ key, label }) => {
        const isActive  = active === key;
        const hasUnread = key === 'dms' ? dmUnread : key === 'events' ? eventsUnread : (dmUnread || eventsUnread);
        return (
          <TouchableOpacity
            key={key}
            style={[styles.pill, isActive && styles.pillActive]}
            onPress={() => onSelect(key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.pillLabel, isActive && styles.pillLabelActive]}>{label}</Text>
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

  useFocusEffect(useCallback(() => {
    clearEventChatCounts();
    setUnreadDMs(0);
  }, [clearEventChatCounts, setUnreadDMs]));

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

  const reload = useCallback(() => { reloadDMs(); loadEvents(); }, [reloadDMs, loadEvents]);

  if (!account) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <BackButton />
          <Text style={styles.headerTitle}>Messages</Text>
          <View style={styles.markReadBtn} />
        </View>
        <UpgradePrompt
          title="Messages are for members"
          subtitle="Create a free account to send direct messages and stay connected."
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
        <Text style={styles.headerTitle}>Messages</Text>
        {hasUnread ? (
          <TouchableOpacity onPress={markAllRead} activeOpacity={0.7} style={styles.markReadBtn}>
            <Text style={styles.markReadText}>Mark all read</Text>
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
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : filteredEmpty ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>
            {activeFilter === 'events' ? '🔥' : '💬'}
          </Text>
          <Text style={styles.emptyTitle}>
            {activeFilter === 'events' ? 'No event chats yet' : 'No messages yet'}
          </Text>
          <Text style={styles.emptySub}>
            {activeFilter === 'events'
              ? 'Create or join an event to chat with people going.'
              : 'Connect with people you meet in the city.'}
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
              {activeFilter === 'all' && <SectionHeader title="DIRECT MESSAGES" />}
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
                {activeFilter === 'all' && <SectionHeader title="EVENT CHATS" />}
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
        </ScrollView>
      )}
    </SafeAreaView>
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
});
