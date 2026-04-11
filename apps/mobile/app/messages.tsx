/**
 * Messages screen — Direct Messages + Event Chats in two tabs.
 *
 * Tab bar at the top switches between:
 *   1. DIRECT MESSAGES — 1:1 conversations
 *   2. EVENT CHATS — events the user created / joined
 *
 * Each tab carries an orange unread badge so users know what needs attention
 * before they tap.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image,
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

type TabKey = 'dms' | 'events';

// ── Avatar palette — same hash system as People here / DM screen ──────────────

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

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar({
  active, dmUnread, eventsUnread, onSelect,
}: {
  active:       TabKey;
  dmUnread:     boolean;
  eventsUnread: boolean;
  onSelect:     (tab: TabKey) => void;
}) {
  return (
    <View style={styles.tabBar}>
      {(['dms', 'events'] as TabKey[]).map(tab => {
        const isActive  = active === tab;
        const hasUnread = tab === 'dms' ? dmUnread : eventsUnread;
        const label     = tab === 'dms' ? 'Direct Messages' : 'Event Chats';
        return (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onSelect(tab)}
            activeOpacity={0.7}
          >
            <View style={styles.tabLabelRow}>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {label}
              </Text>
              {hasUnread && <View style={styles.tabDot} />}
            </View>
            {isActive && <View style={styles.tabUnderline} />}
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

  const [activeTab, setActiveTab] = useState<TabKey>('dms');

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

      {/* Tab bar */}
      <TabBar
        active={activeTab}
        dmUnread={dmUnread}
        eventsUnread={eventsUnread}
        onSelect={setActiveTab}
      />

      {/* Tab content */}
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
      ) : activeTab === 'dms' ? (
        conversations.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyIcon}>💬</Text>
            <Text style={styles.emptyTitle}>No direct messages yet</Text>
            <Text style={styles.emptySub}>Tap the message icon next to someone in the city to start a DM.</Text>
          </View>
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <DMRow
                convo={item}
                onPress={() => router.push({
                  pathname: '/dm/[id]',
                  params: { id: item.other_user_id, name: item.other_display_name },
                })}
              />
            )}
            refreshControl={
              <RefreshControl refreshing={loadingDMs} onRefresh={reloadDMs} tintColor={Colors.accent} />
            }
            contentContainerStyle={styles.listContent}
          />
        )
      ) : (
        loadingEvts && events.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : events.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyIcon}>🔥</Text>
            <Text style={styles.emptyTitle}>No event chats yet</Text>
            <Text style={styles.emptySub}>Create or join an event to chat with people going.</Text>
          </View>
        ) : (
          <FlatList
            data={events}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <EventRow
                event={item}
                unread={eventChatPreviews[item.id]}
                onPress={() => router.push({
                  pathname: '/event/[id]',
                  params: { id: item.id },
                })}
              />
            )}
            refreshControl={
              <RefreshControl refreshing={loadingEvts} onRefresh={loadEvents} tintColor={Colors.accent} />
            }
            contentContainerStyle={styles.listContent}
          />
        )
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

  // ── Tab bar ───────────────────────────────────────────────────────────────
  tabBar: {
    flexDirection:     'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: {
    flex:            1,
    alignItems:      'center',
    paddingVertical: 12,
    position:        'relative',
  },
  tabActive: {},
  tabLabelRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  tabLabel: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      Colors.muted,
  },
  tabLabelActive: {
    color:      Colors.text,
    fontWeight: '700',
  },
  tabDot: {
    width:           7,
    height:          7,
    borderRadius:    4,
    backgroundColor: Colors.accent,
  },
  tabUnderline: {
    position:        'absolute',
    bottom:          0,
    left:            '15%' as any,
    right:           '15%' as any,
    height:          2,
    borderRadius:    1,
    backgroundColor: Colors.accent,
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
