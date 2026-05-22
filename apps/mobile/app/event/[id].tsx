import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { socket } from '@/lib/socket';
import {
  View, Text, FlatList, ActivityIndicator,
  TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Modal, ScrollView,
  Animated, Linking, ToastAndroid,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import * as Haptics from 'expo-haptics';
import { useEventDetail } from '@/hooks/useEventDetail';
import { useMessages } from '@/hooks/useMessages';
import { fetchEventMessages, sendEventMessage, sendEventImageMessage, fetchEventParticipants, toggleEventReaction } from '@/api/events';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput } from '@/features/chat/ChatInput';
import { MessageActionSheet } from '@/features/chat/MessageActionSheet';
import { AttendeeAvatars } from '@/components/AttendeeAvatars';
import { isSameDay, formatDateLabel } from '@/lib/messageTime';
import { track } from '@/services/analytics';
import { Colors, FontSizes, Spacing, Radius, buildEventUrl } from '@/constants';
import { avatarColor } from '@/lib/avatarColors';
import { shareLink } from '@/lib/shareLink';
import { canAccessProfile } from '@/lib/profileAccess';
import { reactionEmitter, EMOJI_TO_TYPE } from '@/lib/reactionEmitter';
import { BADGE_META } from '@/types';
import type { Message, EventParticipant, ReplyRef } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Open the venue in Google Maps ─────────────────────────────────────────────
// Prefer precise coordinates; fall back to a "venue name, address" text search.
// The universal maps URL opens the Google Maps app via universal link (iOS) /
// intent (Android), or the default browser if it isn't installed.
type MapsTarget = {
  venue_lat?: number | null;
  venue_lng?: number | null;
  venue?:     string | null;
  location?:  string | null;
};

function buildEventMapsUrl(event: MapsTarget): string | null {
  const lat = event.venue_lat;
  const lng = event.venue_lng;
  if (typeof lat === 'number' && typeof lng === 'number') {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  const address = event.location ?? event.venue ?? '';
  if (!address) return null;
  // Include the venue name when it's a distinct field (better match accuracy).
  const name = event.venue && event.venue !== address ? `${event.venue}, ` : '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + address)}`;
}

async function openEventMaps(event: MapsTarget): Promise<void> {
  const url = buildEventMapsUrl(event);
  if (!url) return;
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Linking.openURL(url);
  } catch (e) {
    console.warn('[event] could not open maps:', String(e));
    if (Platform.OS === 'android') ToastAndroid.show("Couldn't open maps", ToastAndroid.SHORT);
  }
}

// ── Ambient activity messages — mirrors web scheduleActivity ─────────────────
// Web: city-channel ambient timer bleeds into event subchannel as a side-effect.
// Native: we replicate the same behaviour explicitly for event screens.

const AMBIENT = [
  '🔥 People are arriving',
  '🎉 People are here right now',
  '💬 The city is waking up',
  '👀 Someone just arrived',
  '🔥 New face in the city',
  '🌆 Locals checking in',
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

  return (
    <TouchableOpacity style={stripStyles.row} onPress={onPress} activeOpacity={0.75}>
      <AttendeeAvatars
        preview={participants.map(p => ({ id: p.id, displayName: p.displayName, thumbAvatarUrl: p.thumbAvatarUrl }))}
        total={participants.length}
        borderColor={Colors.bg}
      />
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
  const { id: routeParam } = useLocalSearchParams<{ id: string }>();
  // The route param can be a slug (`cong-ca-phe-2e617620a3f3b6f7`) or a bare
  // hex ID. Backend, WS rooms, analytics all key off the canonical hex.
  // `id` everywhere below is the hex; only the URL bar / share path uses slug.
  const id = (routeParam || '').match(/([a-f0-9]{16})$/i)?.[1]?.toLowerCase()
            ?? routeParam;
  // Diagnostic: surface the route param + extracted id so deep-link arrivals
  // are visible in Metro / `adb logcat -s ReactNativeJS` / iOS device logs.
  // Helps catch any future Expo Router quirk that mangles the slug.
  if (routeParam !== id) {
    console.log('[deeplink] event/[id] extract', { routeParam, id });
  }
  const { identity, sessionId, city, account, setActiveEventId, removeEventChatPreview, setUnreadDMs, eventChatPreviews } = useApp(); // sessionId still used for WS joinEvent
  const nickname = account?.display_name ?? identity?.nickname ?? '';

  // Stable ref so the cleanup effect can read the current preview count without
  // adding eventChatPreviews to the dependency array (which would re-run the effect).
  const eventChatPreviewsRef = useRef(eventChatPreviews);
  eventChatPreviewsRef.current = eventChatPreviews;

  const [replyingTo, setReplyingTo] = useState<ReplyRef | null>(null);
  const replyingToRef = useRef<ReplyRef | null>(null);
  replyingToRef.current = replyingTo;

  const flatListRef = useRef<FlatList<Message>>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [actionSheetMsg,   setActionSheetMsg]   = useState<Message | null>(null);

  // Header collapses (hides meta + address + host) once the user scrolls into
  // older messages. The FlatList is inverted, so scrollY > 0 = scrolled up
  // through history. Drives an Animated.Value (0 → expanded, 1 → collapsed)
  // that the secondary lines bind to via opacity + maxHeight.
  const headerCollapse = useRef(new Animated.Value(0)).current;
  const handleListScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y;
    const next = y > 30 ? 1 : 0;
    Animated.timing(headerCollapse, {
      toValue:         next,
      duration:        160,
      useNativeDriver: false,   // animating maxHeight / paddingBottom — JS-driven
    }).start();
  }, [headerCollapse]);
  const secondaryHeight = headerCollapse.interpolate({ inputRange: [0, 1], outputRange: [80, 0] });
  const secondaryOpacity = headerCollapse.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const blockPaddingBottom = headerCollapse.interpolate({ inputRange: [0, 1], outputRange: [10, 4] });

  function scrollToMessage(id: string) {
    const idx = feed.findIndex(m => m.id === id);
    if (idx === -1) return;
    flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
    setHighlightedMsgId(id);
    setTimeout(() => setHighlightedMsgId(null), 1500);
  }

  const {
    event, cityName: eventCityName, loading: eventLoading, error: eventError,
    toggling, toggleParticipation, isOwner,
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
  // Also clear any accumulated unread preview for this event on open, and deduct
  // the event's unread count from the global badge so the dot clears correctly.
  useEffect(() => {
    if (!id) return;
    setActiveEventId(id);
    const count = eventChatPreviewsRef.current[id]?.count ?? 0;
    removeEventChatPreview(id);
    if (count > 0) setUnreadDMs(prev => Math.max(0, prev - count));
    return () => setActiveEventId(null);
  }, [id, setActiveEventId, removeEventChatPreview, setUnreadDMs]);

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

  async function handleShare() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const url = event ? buildEventUrl(event) : buildEventUrl(id);
    const title = event?.title ?? 'Check out this hangout on Hilads';

    // Descriptive text shown to iOS receivers in the share sheet preview.
    // Crucially does NOT contain the URL — shareLink() handles platform
    // differences (iOS uses separate fields, Android sends URL alone to
    // avoid WhatsApp's "Copy Link" concatenation bug).
    let message = title;
    if (event) {
      const where = event.location ? ` at ${event.location}` : '';
      const when  = ` — ${formatTime(event.starts_at)}${event.ends_at ? ` → ${formatTime(event.ends_at)}` : ''}`;
      const who   = (event.participant_count ?? 0) > 0
        ? ` ${event.participant_count} going.`
        : '';
      message = `${title}${where}${when}.${who} See who's there on Hilads.`;
    }
    await shareLink({ title, message, url });
  }

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
    (_opts?: { beforeId?: string }) => fetchEventMessages(id),
    [id],
  );

  const postTextFn = useCallback(
    (content: string, replyToId?: string | null, mentions?: import('@/types').MentionRef[]): Promise<Message> => {
      if (!identity) return Promise.reject(new Error('Not ready'));
      return sendEventMessage(id, identity.guestId, nickname, content, replyToId, mentions);
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

  const { messages, loading: msgsLoading, sending, error: msgError, clearError, sendText, sendImage, setMessageReactions } = useMessages({
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

  // City name for back button — prefer API response (works for deeplinks), fall back to context city
  const cityName = eventCityName ?? city?.name ?? 'Back';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>

      {/* ── Nav — web: back pill + share button ── */}
      <View style={styles.nav}>
        <TouchableOpacity
          style={styles.backPill}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/chat')}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={18} color={Colors.text} />
          <Text style={styles.backPillText} numberOfLines={1}>{cityName}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.75}>
          <Ionicons name="share-outline" size={16} color={Colors.accent} />
          <Text style={styles.shareBtnText}>Bring people ✨</Text>
        </TouchableOpacity>
      </View>

      {/* ── Event info block — web: sits at top, no card, just padding + border ── */}
      {eventLoading ? (
        <View style={styles.eventBlockLoading}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : eventError || !event ? (
        <View style={styles.eventBlockLoading}>
          <Text style={styles.errorText}>{eventError ?? 'Hangout not found'}</Text>
        </View>
      ) : (
        <Animated.View style={[styles.eventBlock, { paddingBottom: blockPaddingBottom }]}>
          {/* Title row + Join/Edit button — always visible */}
          <View style={styles.titleRow}>
            <Text
              style={styles.eventTitle}
              numberOfLines={1}
              accessibilityRole="header"
            >
              {event.title}
            </Text>
            {isOwner ? (
              <TouchableOpacity
                style={[styles.joinBtn, styles.editBtn]}
                onPress={() => router.push(`/event/${event.id}/edit` as never)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Edit hangout"
              >
                <Text style={[styles.joinBtnText, styles.editBtnText]}>
                  ✏️ Edit
                </Text>
              </TouchableOpacity>
            ) : (
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
                    {event.is_participating ? 'Joined ✓' : 'Join'}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Secondary lines — collapse on scroll. maxHeight + opacity drive the
              transition; native driver is off because we're animating layout. */}
          <Animated.View
            style={{ maxHeight: secondaryHeight, opacity: secondaryOpacity, overflow: 'hidden', gap: 4 }}
          >
            {/* Time + here + going on a single muted line */}
            <Text style={styles.eventMeta} numberOfLines={1}>
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

            {/* Location — orange accent, single-line ellipsis. Tappable → Google Maps. */}
            {(event.location ?? event.venue) ? (
              <TouchableOpacity
                onPress={() => openEventMaps(event)}
                activeOpacity={0.6}
                style={styles.eventLocationRow}
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                accessibilityRole="link"
                accessibilityLabel={`Open address in Google Maps: ${event.location ?? event.venue}`}
                accessibilityHint="Opens Google Maps with this venue's location"
              >
                <Text style={styles.eventLocation} numberOfLines={1}>
                  {'📍 '}
                  {event.location ?? event.venue}
                </Text>
              </TouchableOpacity>
            ) : null}

            {/* Host name — suppressed for the host themselves */}
            {event.host_nickname && !isOwner ? (
              <Text style={styles.eventHost} numberOfLines={1}>
                Hosted by {event.host_nickname}
              </Text>
            ) : null}
          </Animated.View>
        </Animated.View>
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
            ref={flatListRef}
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
                  isHighlighted={highlightedMsgId === item.id}
                  onLongPress={(msg) => {
                    if (!msg.id || msg.id.startsWith('local-')) return;
                    setActionSheetMsg(msg);
                  }}
                  onReplyQuotePress={scrollToMessage}
                  onReact={async (msg, emoji) => {
                    if (!msg.id || !identity) return;
                    try {
                      const reactions = await toggleEventReaction(id, msg.id, emoji, identity.guestId);
                      setMessageReactions(msg.id, reactions);
                    } catch (e) {
                      console.warn('[event] reaction failed:', e);
                    }
                  }}
                />
              );
            }}
            inverted
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            onScrollToIndexFailed={() => {}}
            onScroll={handleListScroll}
            scrollEventThrottle={16}
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
            mentionContext="event"
            mentionChannelId={id}
            onSendText={(text, mentions) => {
              const reply = replyingToRef.current;
              setReplyingTo(null);
              sendText(text, reply, mentions);
            }}
            onSendImage={sendImage}
            placeholder={
              messages.some(m => m.type !== 'system')
                ? `Say something at ${event.title} ✨`
                : `Be the first at ${event.title} ✨`
            }
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
          />
        </KeyboardAvoidingView>
      )}
      <MessageActionSheet
        visible={actionSheetMsg !== null}
        reactions={actionSheetMsg?.reactions ?? []}
        onReact={async (emoji) => {
          if (!actionSheetMsg?.id || !identity) return;
          reactionEmitter.emit(actionSheetMsg.id, EMOJI_TO_TYPE[emoji] ?? 'heart');
          try {
            const reactions = await toggleEventReaction(id, actionSheetMsg.id, emoji, identity.guestId);
            setMessageReactions(actionSheetMsg.id, reactions);
          } catch (e) {
            console.warn('[event] reaction failed:', e);
          }
        }}
        onReply={actionSheetMsg ? () => {
          setReplyingTo({ id: actionSheetMsg.id, nickname: actionSheetMsg.nickname, content: actionSheetMsg.content ?? '', type: actionSheetMsg.type });
        } : undefined}
        onClose={() => setActionSheetMsg(null)}
      />

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
                const color     = avatarColor(p.id);
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

  shareBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius:    14,
    backgroundColor: 'rgba(194,74,56,0.12)',
    borderWidth:     1,
    borderColor:     'rgba(194,74,56,0.30)',
  },
  shareBtnText: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      Colors.accent,
  },

  // Web: share button — same dark pill style (kept for reference)
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

  // ── Event info block — compact: glanceable summary above the chat ────────
  // paddingBottom is animated when the secondary lines collapse (see
  // blockPaddingBottom interpolation in the screen component).
  eventBlock: {
    paddingHorizontal: Spacing.md,
    paddingTop:        8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap:               6,
  },
  eventBlockLoading: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.lg,
    alignItems:        'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },

  // Title row — title fills flex (single-line ellipsis), Join button on right
  titleRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            10,
  },

  // Compact title — was 40/800/lh46, now 20/700/lh26 (~–50% height).
  eventTitle: {
    flex:          1,
    fontSize:      FontSizes.lg,   // 20
    fontWeight:    '700',
    color:         Colors.text,
    letterSpacing: -0.3,
    lineHeight:    26,
    minWidth:      0,              // ensures ellipsis kicks in inside the row
  },

  // Compact Join button — was 22×12 padding / fontSize 20, now 14×6 / 13.
  joinBtn: {
    paddingHorizontal: 14,
    paddingVertical:   6,
    borderRadius:      999,
    borderWidth:       1.5,
    borderColor:       Colors.accent,
    backgroundColor:   'transparent',
    minWidth:          74,         // wide enough for "Joined ✓" so layout doesn't shift
    minHeight:         32,         // ≥32 tap target (touchable area extends)
    alignItems:        'center',
    justifyContent:    'center',
    flexShrink:        0,
  },
  joinBtnActive: {
    backgroundColor: Colors.accent,
    borderColor:     Colors.accent,
  },
  joinBtnText: {
    fontSize:   13,
    fontWeight: '700',
    color:      Colors.accent,
    letterSpacing: 0.1,
  },
  joinBtnTextActive: {
    color: Colors.white,
  },
  // Host-only "Edit event" CTA — violet to distinguish from the orange Join
  // button (matches web .event-join-btn--edit).
  editBtn: {
    borderColor:     Colors.violet,
  },
  editBtnText: {
    color:    Colors.violet,
    fontSize: 13,
  },

  // Time + participants — single tight muted line
  eventMeta: {
    fontSize:   13,
    color:      Colors.muted,
    lineHeight: 18,
  },

  // "X going" — tappable inline span
  goingLink: {
    color:               Colors.text,
    fontWeight:          '600',
    textDecorationLine:  'underline',
    textDecorationStyle: 'dashed',
    textDecorationColor: 'rgba(255,255,255,0.3)',
  },

  // Address — orange accent, single-line ellipsis
  eventLocationRow: {
    paddingVertical: 4,   // full-width row; + hitSlop on the touchable → ≥44pt tap target
  },
  eventLocation: {
    fontSize:   13,
    fontWeight: '600',
    color:      Colors.accent,
    lineHeight: 18,
  },
  eventHost: {
    fontSize:   12,
    fontWeight: '500',
    color:      Colors.muted,
    lineHeight: 16,
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
