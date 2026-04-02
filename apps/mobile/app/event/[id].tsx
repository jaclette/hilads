import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { socket } from '@/lib/socket';
import {
  View, Text, FlatList, ActivityIndicator,
  TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import * as Haptics from 'expo-haptics';
import { useEventDetail } from '@/hooks/useEventDetail';
import { useMessages } from '@/hooks/useMessages';
import { fetchEventMessages, sendEventMessage, sendEventImageMessage, fetchEventParticipants } from '@/api/events';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput } from '@/features/chat/ChatInput';
import { isSameDay, formatDateLabel } from '@/lib/messageTime';
import { track } from '@/services/analytics';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { canAccessProfile } from '@/lib/profileAccess';
import { BADGE_META } from '@/types';
import type { Message, EventParticipant } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const AVATAR_PALETTES: [string, string][] = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
];
function avatarColor(name: string): string {
  const hash = (name ?? '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length][0];
}

// ── Ambient activity messages — mirrors web scheduleActivity ─────────────────
// Web: city-channel ambient timer bleeds into event subchannel as a side-effect.
// Native: we replicate the same behaviour explicitly for event screens.

const AMBIENT = [
  '🔥 People are arriving',
  '🎉 The vibe is alive right now',
  '💬 The city is waking up',
  '👀 Someone just arrived',
  '🔥 New face in the city',
  '🗺️ Explorers checking in',
  '🍻 Who\'s out tonight?',
];

function toMs(ts: number | string | undefined): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts < 1e10 ? ts * 1000 : ts;
  return new Date(ts).getTime();
}

// ── Participants strip ────────────────────────────────────────────────────────

function ParticipantsStrip({ participants, onPress }: { participants: EventParticipant[]; onPress: () => void }) {
  if (participants.length === 0) return null;
  const visible = participants.slice(0, 5);
  const extra   = participants.length - visible.length;

  return (
    <TouchableOpacity style={stripStyles.row} onPress={onPress} activeOpacity={0.75}>
      <View style={stripStyles.avatars}>
        {visible.map((p, i) => (
          <View
            key={p.id}
            style={[stripStyles.avatar, { backgroundColor: avatarColor(p.displayName), marginLeft: i > 0 ? -10 : 0 }]}
          >
            <Text style={stripStyles.avatarLetter}>{(p.displayName[0] ?? '?').toUpperCase()}</Text>
          </View>
        ))}
        {extra > 0 && (
          <View style={[stripStyles.avatar, stripStyles.avatarExtra, { marginLeft: -10 }]}>
            <Text style={stripStyles.avatarExtraText}>+{extra}</Text>
          </View>
        )}
      </View>
      <Text style={stripStyles.label}>
        {participants.length === 1
          ? `${participants[0].displayName} is going`
          : `${participants[0].displayName} + ${participants.length - 1} going`}
      </Text>
      <Text style={stripStyles.seeAll}>See all →</Text>
    </TouchableOpacity>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function EventDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { identity, sessionId, city, account, setActiveEventId, removeEventChatPreview } = useApp(); // sessionId still used for WS joinEvent
  const nickname = account?.display_name ?? identity?.nickname ?? '';

  const {
    event, loading: eventLoading, error: eventError,
    toggling, toggleParticipation,
  } = useEventDetail(id);

  const [participants,   setParticipants]  = useState<EventParticipant[]>([]);
  const [presenceCount,  setPresenceCount] = useState<number | null>(null);
  const [ambientFeed,    setAmbientFeed]   = useState<Message[]>([]);
  const [showGoingSheet, setShowGoingSheet] = useState(false);
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    if (id) track('event_opened', { eventId: id });
  }, [id]);

  // Register this as the active event so useEventChatNotifications skips unread for it.
  // Also clear any accumulated unread preview for this event on open.
  useEffect(() => {
    if (!id) return;
    setActiveEventId(id);
    removeEventChatPreview(id);
    return () => setActiveEventId(null);
  }, [id, setActiveEventId, removeEventChatPreview]);

  useEffect(() => {
    if (!id) return;
    // Use guestId (persistent) for participation lookup — survives app restarts
    fetchEventParticipants(id, identity?.guestId).then(({ participants: p }) => setParticipants(p));
  }, [id, identity?.guestId]);

  // Live presence count — server emits event_presence_update { eventId, count }
  useEffect(() => {
    const off = socket.on('event_presence_update', (data: Record<string, unknown>) => {
      if (data.eventId === id) setPresenceCount(data.count as number);
    });
    return off;
  }, [id]);

  // Refetch participants after join/leave toggle
  const handleToggle = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // joined_event is tracked server-side — no frontend duplicate
    await toggleParticipation();
    fetchEventParticipants(id, identity?.guestId).then(({ participants: p }) => setParticipants(p));
  }, [event, toggleParticipation, id, identity?.guestId]);

  // Join / leave WS event room so the server routes newMessage events here
  useEffect(() => {
    if (!event?.id || !sessionId) return;
    const nick = identity?.nickname;
    if (socket.isConnected) socket.joinEvent(event.id, sessionId, nick);
    const offConnect = socket.on('connected', () => {
      socket.joinEvent(event.id, sessionId, nick);
    });
    return () => {
      offConnect();
      socket.leaveEvent(event.id, sessionId);
    };
  }, [event?.id, sessionId]);

  const channelId = event?.id ?? id;

  const loadFn = useCallback(
    () => fetchEventMessages(id),
    [id],
  );

  const postTextFn = useCallback(
    (content: string): Promise<Message> => {
      if (!identity) return Promise.reject(new Error('Not ready'));
      return sendEventMessage(id, identity.guestId, nickname, content);
    },
    [id, identity, nickname],
  );

  const postImageFn = useCallback(
    (imageUrl: string): Promise<Message> => {
      if (!identity) return Promise.reject(new Error('Not ready'));
      return sendEventImageMessage(id, identity.guestId, nickname, imageUrl);
    },
    [id, identity, nickname],
  );

  const { messages, loading: msgsLoading, sending, error: msgError, clearError, sendText, sendImage } = useMessages({
    channelId,
    loadFn,
    postTextFn,
    postImageFn,
  });

  // Keep a stable ref to messages count so the ambient timer can read it without closure staleness
  messagesRef.current = messages;

  // Ambient activity scheduling — mirrors web scheduleActivity.
  // Web: city ambient timer bleeds into event feed (shared state). We replicate explicitly.
  // First injection: 30s after entering. Recurring: every 60–120s.
  // Suppressed when there are already 3+ real user messages.
  useEffect(() => {
    if (!event?.id) return;
    let tid: ReturnType<typeof setTimeout>;

    const schedule = (isFirst = false) => {
      const delay = isFirst ? 30_000 : 60_000 + Math.random() * 60_000;
      tid = setTimeout(() => {
        const realCount = messagesRef.current.filter(m => m.type !== 'system').length;
        if (realCount < 3) {
          const text = AMBIENT[Math.floor(Math.random() * AMBIENT.length)];
          const item: Message = {
            id:        `ambient-${Date.now()}`,
            type:      'system',
            nickname:  '',
            content:   text,
            createdAt: Date.now() / 1000,
          };
          setAmbientFeed(prev => [item, ...prev]);
        }
        schedule();
      }, delay);
    };

    schedule(true);
    return () => clearTimeout(tid);
  }, [event?.id]);

  // Merge real messages + ambient items, keeping newest-first order for inverted FlatList
  const feed = useMemo<Message[]>(() => {
    if (ambientFeed.length === 0) return messages;
    return [...messages, ...ambientFeed].sort(
      (a, b) => toMs(b.createdAt) - toMs(a.createdAt),
    );
  }, [messages, ambientFeed]);

  // City name for back button — prefer live city, fall back to event metadata
  const cityName = city?.name ?? event?.city_name ?? 'Back';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>

      {/* ── Nav — web: back pill + share button ── */}
      <View style={styles.nav}>
        <TouchableOpacity
          style={styles.backPill}
          onPress={() => router.back()}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={18} color={Colors.text} />
          <Text style={styles.backPillText} numberOfLines={1}>{cityName}</Text>
        </TouchableOpacity>

        {/* Share — placeholder; real share sheet can be wired later */}
        <TouchableOpacity style={styles.iconBtn} activeOpacity={0.75}>
          <Ionicons name="share-outline" size={20} color={Colors.muted} />
        </TouchableOpacity>
      </View>

      {/* ── Event info block — web: sits at top, no card, just padding + border ── */}
      {eventLoading ? (
        <View style={styles.eventBlockLoading}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : eventError || !event ? (
        <View style={styles.eventBlockLoading}>
          <Text style={styles.errorText}>{eventError ?? 'Event not found'}</Text>
        </View>
      ) : (
        <View style={styles.eventBlock}>
          {/* Title row + Join button */}
          <View style={styles.titleRow}>
            <Text style={styles.eventTitle} numberOfLines={3}>{event.title}</Text>
            <TouchableOpacity
              style={[styles.joinBtn, event.is_participating && styles.joinBtnActive]}
              onPress={handleToggle}
              disabled={toggling}
              activeOpacity={0.8}
            >
              {toggling ? (
                <ActivityIndicator size="small" color={Colors.accent} />
              ) : (
                <Text style={[styles.joinBtnText, event.is_participating && styles.joinBtnTextActive]}>
                  {event.is_participating ? 'Going ✓' : 'Join'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Time + here + going — mirrors web: "HH:MM → HH:MM · X here · X going" */}
          <Text style={styles.eventMeta}>
            {'🕐 '}
            {formatTime(event.starts_at)}
            {event.ends_at ? ` → ${formatTime(event.ends_at)}` : ''}
            {presenceCount != null ? ` · ${presenceCount} here` : ''}
            {event.participant_count != null ? (
              <>
                {' · '}
                <Text
                  style={styles.goingLink}
                  onPress={() => setShowGoingSheet(true)}
                >
                  {event.participant_count} going
                </Text>
              </>
            ) : null}
          </Text>

          {/* Location — orange in web */}
          {(event.location ?? event.venue) ? (
            <Text style={styles.eventLocation} numberOfLines={2}>
              {'📍 '}
              {event.location ?? event.venue}
            </Text>
          ) : null}
        </View>
      )}

      {/* ── Participants activity strip ── */}
      {event && <ParticipantsStrip participants={participants} onPress={() => setShowGoingSheet(true)} />}

      {/* Error banner */}
      {msgError && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8}>
          <Text style={styles.errorBannerText}>{msgError} · tap to dismiss</Text>
        </TouchableOpacity>
      )}

      {/* ── Messages ── */}
      {event && (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior="padding"
        >
          <FlatList
            data={feed}
            keyExtractor={(m, i) => m.id ?? String(i)}
            renderItem={({ item, index }) => {
              const olderMsg = feed[index + 1];
              const newerMsg = feed[index - 1];
              const isGrouped =
                !!olderMsg &&
                olderMsg.guestId === item.guestId &&
                olderMsg.type !== 'system' &&
                item.type !== 'system';
              const showTime =
                item.type !== 'system' && item.type !== 'event' && (
                  !newerMsg ||
                  newerMsg.guestId !== item.guestId ||
                  newerMsg.type === 'system'
                );
              const dateLabel =
                item.type !== 'event' && !isSameDay(item.createdAt, olderMsg?.createdAt)
                  ? formatDateLabel(item.createdAt)
                  : undefined;
              return (
                <ChatMessage
                  message={item}
                  myGuestId={identity?.guestId}
                  isGrouped={isGrouped}
                  showTime={showTime}
                  dateLabel={dateLabel}
                />
              );
            }}
            inverted
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              msgsLoading ? (
                <View style={styles.msgsLoading}>
                  <ActivityIndicator color={Colors.muted} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              msgsLoading ? null : (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText}>No messages yet. Say something! 👋</Text>
                </View>
              )
            }
          />

          <ChatInput
            sending={sending}
            onSendText={sendText}
            onSendImage={sendImage}
            placeholder={
              messages.some(m => m.type !== 'system')
                ? `Say something at ${event.title} ✨`
                : `Be the first at ${event.title} ✨`
            }
          />
        </KeyboardAvoidingView>
      )}
      {/* ── Going list sheet ── */}
      <Modal
        visible={showGoingSheet}
        animationType="slide"
        transparent
        onRequestClose={() => setShowGoingSheet(false)}
      >
        <TouchableOpacity
          style={sheetStyles.backdrop}
          activeOpacity={1}
          onPress={() => setShowGoingSheet(false)}
        />
        <View style={sheetStyles.sheet}>
          {/* Handle */}
          <View style={sheetStyles.handle} />

          {/* Header */}
          <View style={sheetStyles.header}>
            <Text style={sheetStyles.title}>
              {participants.length > 0
                ? `${participants.length} going`
                : event ? `${event.participant_count ?? 0} going` : 'Going'}
            </Text>
            <TouchableOpacity onPress={() => setShowGoingSheet(false)} hitSlop={12}>
              <Text style={sheetStyles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* List */}
          <ScrollView
            style={sheetStyles.list}
            contentContainerStyle={sheetStyles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {participants.length === 0 ? (
              <Text style={sheetStyles.emptyText}>No one yet — be the first to join! 🙌</Text>
            ) : (
              participants.map(p => {
                const isRegistered = p.accountType === 'registered';
                const badgeKey = p.badges?.[0];
                const badgeMeta = badgeKey ? BADGE_META[badgeKey] : null;
                const initials  = (p.displayName ?? '?').slice(0, 2).toUpperCase();
                const color     = avatarColor(p.displayName ?? '');
                const canTap    = isRegistered;

                const handleTap = () => {
                  if (!isRegistered) return;
                  setShowGoingSheet(false);
                  if (!canAccessProfile(account)) {
                    router.push('/auth-gate');
                    return;
                  }
                  router.push({ pathname: '/user/[id]', params: { id: p.id } });
                };

                return (
                  <TouchableOpacity
                    key={p.id}
                    style={sheetStyles.row}
                    onPress={canTap ? handleTap : undefined}
                    activeOpacity={canTap ? 0.7 : 1}
                    disabled={!canTap}
                  >
                    <View style={[sheetStyles.avatar, { backgroundColor: color + '28', borderColor: color + '50' }]}>
                      <Text style={[sheetStyles.avatarText, { color }]}>{initials}</Text>
                    </View>
                    <View style={sheetStyles.rowInfo}>
                      <Text style={sheetStyles.name}>{p.displayName}</Text>
                      {badgeMeta && (
                        <View style={[sheetStyles.badge, { backgroundColor: badgeMeta.bg, borderColor: badgeMeta.border }]}>
                          <Text style={[sheetStyles.badgeText, { color: badgeMeta.color }]}>{badgeMeta.label}</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex:      { flex: 1 },

  // ── Nav bar ───────────────────────────────────────────────────────────────
  // Web: back pill (← City name) left, share icon right
  nav: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical:   10,
  },

  // Web: back button pill — rounded rect, dark bg, border
  backPill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    paddingHorizontal: 16,
    paddingVertical:   11,
    borderRadius:      14,
    backgroundColor:   'rgba(255,255,255,0.08)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.12)',
    maxWidth:          220,
  },
  backPillText: {
    fontSize:      FontSizes.md,
    fontWeight:    '700',
    color:         Colors.text,
    letterSpacing: -0.2,
  },

  // Web: share button — same dark pill style
  iconBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
  },

  // ── Event info block — web: flat, top of screen, padded, border-bottom ───
  eventBlock: {
    paddingHorizontal: Spacing.md,
    paddingTop:        4,
    paddingBottom:     18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap:               8,
  },
  eventBlockLoading: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.lg,
    alignItems:        'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },

  // Title row — title fills flex, Join button on the right
  titleRow: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    gap:            12,
  },

  // Web: event title — large, bold, white (~2.6rem on web)
  eventTitle: {
    flex:          1,
    fontSize:      40,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.8,
    lineHeight:    46,
  },

  // Web: Join button — orange outlined pill, fills on "going"
  joinBtn: {
    paddingHorizontal: 22,
    paddingVertical:   12,
    borderRadius:      999,
    borderWidth:       2,
    borderColor:       Colors.accent,
    backgroundColor:   'transparent',
    minWidth:          80,
    alignItems:        'center',
    justifyContent:    'center',
    marginTop:         6,
    flexShrink:        0,
  },
  joinBtnActive: {
    backgroundColor: Colors.accent,
    borderColor:     Colors.accent,
  },
  joinBtnText: {
    fontSize:   FontSizes.lg,
    fontWeight: '700',
    color:      Colors.accent,
  },
  joinBtnTextActive: {
    color: Colors.white,
  },

  // Web: time + participants — single muted line
  eventMeta: {
    fontSize:   FontSizes.sm,
    color:      Colors.muted,
    lineHeight: 20,
  },

  // "X going" — tappable inline span
  goingLink: {
    color:          Colors.text,
    fontWeight:     '600',
    textDecorationLine: 'underline',
    textDecorationStyle: 'dashed',
    textDecorationColor: 'rgba(255,255,255,0.3)',
  },

  // Web: location — orange accent
  eventLocation: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      Colors.accent,
    lineHeight: 20,
  },

  errorBanner:     { backgroundColor: Colors.red, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  errorBannerText: { color: Colors.white, fontSize: FontSizes.xs, textAlign: 'center' },
  errorText:       { color: Colors.red, fontSize: FontSizes.sm },

  listContent: { paddingVertical: Spacing.sm },
  msgsLoading: { paddingVertical: Spacing.md, alignItems: 'center' },
  emptyWrap:   { paddingHorizontal: Spacing.md, paddingVertical: Spacing.lg, alignItems: 'center' },
  emptyText:   { color: Colors.muted, fontSize: FontSizes.sm, textAlign: 'center' },
});

// ── Participants strip styles ─────────────────────────────────────────────────

const stripStyles = StyleSheet.create({
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               12,
    paddingHorizontal: Spacing.md,
    paddingVertical:   14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  avatars: {
    flexDirection: 'row',
    alignItems:    'center',
  },
  avatar: {
    width:          32,
    height:         32,
    borderRadius:   16,
    alignItems:     'center',
    justifyContent: 'center',
    borderWidth:    2,
    borderColor:    Colors.bg,
  },
  avatarLetter: {
    color:      '#fff',
    fontSize:   12,
    fontWeight: '700',
  },
  avatarExtra: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  avatarExtraText: {
    color:      Colors.muted,
    fontSize:   11,
    fontWeight: '700',
  },
  label: {
    fontSize:   FontSizes.sm,
    color:      Colors.muted,
    fontWeight: '500',
    flex:       1,
  },
  seeAll: {
    fontSize:   FontSizes.xs,
    color:      Colors.accent,
    fontWeight: '600',
    flexShrink: 0,
  },
});

// ── Going sheet styles ────────────────────────────────────────────────────────

const sheetStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position:        'absolute',
    bottom:          0,
    left:            0,
    right:           0,
    backgroundColor: '#161210',
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    borderTopWidth:  1,
    borderTopColor:  'rgba(255,255,255,0.08)',
    maxHeight:       '72%',
  },
  handle: {
    width:           40,
    height:          4,
    borderRadius:    2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf:       'center',
    marginTop:       10,
    marginBottom:    2,
  },
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical:   14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize:      FontSizes.sm,
    fontWeight:    '700',
    color:         Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  closeBtn: {
    fontSize: FontSizes.md,
    color:    Colors.muted,
  },
  list:        { flex: 1 },
  listContent: { padding: Spacing.md, gap: 6 },
  emptyText: {
    color:      Colors.muted,
    fontSize:   FontSizes.sm,
    textAlign:  'center',
    paddingVertical: Spacing.lg,
  },
  row: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            14,
    padding:        14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth:    1,
    borderColor:    'rgba(255,255,255,0.05)',
    borderRadius:   Radius.lg,
  },
  avatar: {
    width:          40,
    height:         40,
    borderRadius:   20,
    borderWidth:    1.5,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  avatarText: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
  },
  rowInfo: { flex: 1, gap: 4 },
  name: {
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      Colors.text,
  },
  badge: {
    alignSelf:         'flex-start',
    borderRadius:      999,
    paddingHorizontal: 7,
    paddingVertical:   3,
    borderWidth:       1,
  },
  badgeText: { fontSize: 10, fontWeight: '700' },
});
