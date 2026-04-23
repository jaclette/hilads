/**
 * City channel screen — faithful port of the web "ready" state.
 *
 * Web source: App.jsx (status === 'ready'), index.css (.chat-header, .messages, .input-bar)
 *
 * Header mirrors web renderCityHero() on mobile:
 *   Logo icon → city name + flag → online count pill ("N hanging out" / "live now")
 *
 * Messages mirror web feed: system pills, regular messages with avatar + author + grouped bubbles.
 * Input mirrors web .input-bar: pill input, image button, send button.
 */

import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import {
  View, Text, FlatList, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform,
  TouchableOpacity, Animated, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useMessages } from '@/hooks/useMessages';
import { fetchMessages, sendMessage, sendImageMessage, toggleChannelReaction } from '@/api/channels';
import { fetchCityEvents } from '@/api/events';
import { fetchCityTopics } from '@/api/topics';
import type { HiladsEvent } from '@/types';
import { socket } from '@/lib/socket';
import { reactionEmitter, EMOJI_TO_TYPE } from '@/lib/reactionEmitter';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput, getPlaceholder } from '@/features/chat/ChatInput';
import { MessageActionSheet } from '@/features/chat/MessageActionSheet';
import { HiladsIcon } from '@/components/HiladsIcon';
import { Colors, FontSizes, Spacing, BASE_URL } from '@/constants';
import { isSameDay, formatDateLabel, toMs } from '@/lib/messageTime';
import type { Message, ReplyRef } from '@/types';

// ── EventBannerStrip — ephemeral overlay above the input ─────────────────────
// Appears when a new event is broadcast via WS. Auto-dismissed after 10 s.
// Throttled: max once every 2 minutes per session.

interface BannerProps {
  title:     string;
  eventId:   string;
  onDismiss: () => void;
}

function EventBannerStrip({ title, eventId, onDismiss }: BannerProps) {
  const router  = useRouter();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, []);

  function handleJoin() {
    onDismiss();
    router.push(`/event/${eventId}`);
  }

  return (
    <Animated.View style={[styles.bannerStrip, { opacity }]}>
      <Text style={styles.bannerText} numberOfLines={1}>
        🔥 New event: {title}
      </Text>
      <TouchableOpacity style={styles.bannerBtn} onPress={handleJoin} activeOpacity={0.8}>
        <Text style={styles.bannerBtnText}>Join</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.bannerDismiss} onPress={onDismiss} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.bannerDismissText}>✕</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Flag emoji — mirrors web cityFlag() ──────────────────────────────────────

function cityFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '';
  return [...countryCode.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

// ── Chip live dot — red pulsing dot for the "hanging out" chip ───────────────
// Gentle scale 1→1.15→1 over 2s, matching web .chip-live-dot @keyframes.

function ChipLiveDot() {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.15, duration: 1000, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,    duration: 1000, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  return (
    <Animated.View style={[styles.chipLiveDot, { transform: [{ scale }] }]} />
  );
}

// ── Ambient activity messages — mirrors web AMBIENT_MESSAGES ─────────────────

const AMBIENT_MESSAGES = [
  '🔥 People are arriving',
  "🍻 Who's out tonight?",
  '💬 The city is waking up',
  '🌙 Night owls are online',
  '👀 Someone just arrived',
  '🔥 New face in the city',
  '🎉 People are here right now',
  '🌆 Locals checking in',
];

// ── Screen ────────────────────────────────────────────────────────────────────

// ── Screen ────────────────────────────────────────────────────────────────────
// Tab bar is in-flow (flex-column sibling), so the screen content area ends
// exactly at the tab bar top. No paddingBottom needed on the SafeAreaView.
// ChatInput uses elevation: 30 to render above the tab bar's upward shadow.

export default function ChatTab() {
  const router = useRouter();
  const {
    city, identity, sessionId, account,
    unreadDMs, setUnreadDMs,
    unreadNotifications,
    clearEventChatCounts,
    bootstrapData,
  } = useApp();
  const nickname = account?.display_name ?? identity?.nickname ?? '';

  // Online count — populated by WS presenceSnapshot, fallback "live now"
  const [onlineCount, setOnlineCount] = useState<number | null>(null);

  useEffect(() => {
    const off = socket.on('presenceSnapshot', (data: { count?: number; users?: unknown[] }) => {
      const next = data.count != null ? data.count
                 : Array.isArray(data.users) ? data.users.length
                 : null;
      if (next !== null) setOnlineCount(next);
    });
    return off;
  }, []);

  const channelId = city?.channelId ?? '';

  // ── Typing indicators ─────────────────────────────────────────────────────
  // Server broadcasts typingUsers to the city room whenever typingStart/Stop fires.
  // We filter out our own session so we never show "you are typing".

  type TypingUser = { sessionId: string; nickname: string };
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);

  useEffect(() => {
    const off = socket.on('typingUsers', (data: Record<string, unknown>) => {
      const users = (data.users as TypingUser[] | undefined) ?? [];
      setTypingUsers(users);
    });
    // Clear on channel switch so stale indicators don't bleed across cities
    return () => { off(); setTypingUsers([]); };
  }, [channelId]);

  const typingLabel = useMemo<string | null>(() => {
    const others = typingUsers.filter(u => u.sessionId !== sessionId);
    if (others.length === 0) return null;
    if (others.length === 1) return `${others[0].nickname} is typing…`;
    if (others.length === 2) return `${others[0].nickname} and ${others[1].nickname} are typing…`;
    return `${others[0].nickname} and ${others.length - 1} others are typing…`;
  }, [typingUsers, sessionId]);

  const handleTypingStart = useCallback(() => {
    if (!city?.channelId || !sessionId) return;
    socket.typingStart(city.channelId, sessionId, nickname);
  }, [city?.channelId, sessionId, nickname]);

  const handleTypingStop = useCallback(() => {
    if (!city?.channelId || !sessionId) return;
    socket.typingStop(city.channelId, sessionId);
  }, [city?.channelId, sessionId]);

  // ── Ephemeral event banners ────────────────────────────────────────────────
  // New events arrive via WS and show as temporary strips above the input.
  // Up to 3 banners shown simultaneously; each auto-expires independently.
  // No global throttle — every new event in this channel gets a banner.

  // ── Event feed synthesis state — declared before WS effect that uses it ─────
  const seenEventIds   = useRef(new Set<string>());
  const [eventFeedItems, setEventFeedItems] = useState<Message[]>([]);

  type BannerEntry = { id: string; title: string };
  const [eventBanners, setEventBanners] = useState<BannerEntry[]>([]);
  // Per-banner timers keyed by event id
  const bannerTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissBanner = useCallback((id: string) => {
    const t = bannerTimers.current.get(id);
    if (t) { clearTimeout(t); bannerTimers.current.delete(id); }
    setEventBanners(prev => prev.filter(b => b.id !== id));
    console.log('[event-banners] dismissed banner', id);
  }, []);

  useEffect(() => {
    // data.event is the WS event name string ('new_event') — event payload is in data.hiladsEvent
    const off = socket.on('new_event', (data: { hiladsEvent?: HiladsEvent; channelId?: string | number }) => {
      console.log('[event-banners] incoming event', data.hiladsEvent?.id,
        '| ws channelId:', data.channelId, '| local channelId:', channelId);

      // String coercion handles server sending channelId as number vs string
      if (!data.hiladsEvent || String(data.channelId) !== String(channelId)) return;

      const { id, title } = data.hiladsEvent;
      console.log('[event-banners] adding banner id=' + id + ' title=' + title);

      setEventBanners(prev => {
        if (prev.some(b => b.id === id)) {
          console.log('[event-banners] dedup — banner already shown for', id);
          return prev;
        }
        const next = [{ id, title }, ...prev].slice(0, 3); // cap at 3
        console.log('[event-banners] active banners count =', next.length);
        return next;
      });

      // Also inject into the chat feed (same as web setFeed pattern)
      if (!seenEventIds.current.has(id)) {
        seenEventIds.current.add(id);
        const feedMsg: Message = {
          id:        `event-msg-${id}`,
          type:      'event',
          eventId:   id,
          content:   title,
          nickname:  '',
          createdAt: Date.now() / 1000,
        };
        setEventFeedItems(prev => [feedMsg, ...prev]);
        console.log('[event-feed] injected feed item via WS for event', id);
      }

      // Each banner gets its own 20s auto-expire timer
      if (bannerTimers.current.has(id)) clearTimeout(bannerTimers.current.get(id)!);
      const t = setTimeout(() => {
        console.log('[event-banners] expiring banner', id);
        setEventBanners(prev => prev.filter(b => b.id !== id));
        bannerTimers.current.delete(id);
      }, 20_000);
      bannerTimers.current.set(id, t);
    });

    return () => {
      off();
      bannerTimers.current.forEach(t => clearTimeout(t));
      bannerTimers.current.clear();
      console.log('[event-banners] cleared due to channel change or unmount');
    };
  }, [channelId]);

  // ── Event feed item synthesis (mirrors web prevEventCountRef pattern) ───────
  // Web: when events array grows, inject { type: 'event', id: 'event-msg-{id}', ... }
  // into the feed. Native mirrors this: on channel load, fetch events and synthesize.

  useEffect(() => {
    if (!channelId) return;
    seenEventIds.current.clear();
    setEventFeedItems([]);

    // Fetch current events for this city and synthesize feed pills.
    fetchCityEvents(channelId).then(evts => {
      const now = Date.now() / 1000;
      const fresh: Message[] = [];
      for (const e of evts) {
        if (!seenEventIds.current.has(e.id)) {
          seenEventIds.current.add(e.id);
          fresh.push({ id: `event-msg-${e.id}`, type: 'event', eventId: e.id,
                       content: e.title, nickname: '', createdAt: now });
        }
      }
      if (fresh.length > 0) setEventFeedItems(prev => [...prev, ...fresh]);
    }).catch(() => {});

    // WS: new event created in this city — append pill immediately (no poll needed).
    const offEvent = socket.on('new_event', (data: Record<string, unknown>) => {
      if (String(data.channelId) !== String(channelId)) return;
      const ev = data.hiladsEvent as Record<string, unknown> | undefined;
      const eventId = (ev?.id ?? '') as string;
      if (!eventId || seenEventIds.current.has(eventId)) return;
      seenEventIds.current.add(eventId);
      setEventFeedItems(prev => [...prev, {
        id:        `event-msg-${eventId}`,
        type:      'event' as const,
        eventId,
        content:   (ev?.title as string) ?? '',
        nickname:  '',
        createdAt: Date.now() / 1000,
      }]);
    });

    return () => { offEvent(); };
  }, [channelId]);

  // ── Topic feed item synthesis ─────────────────────────────────────────────
  // Active topics appear as blue pills in the city chat.
  // WS `newTopic` handles instant append; 5-min poll handles expiry cleanup.

  const [topicFeedItems, setTopicFeedItems] = useState<Message[]>([]);

  useEffect(() => {
    if (!channelId) return;

    async function loadTopics() {
      try {
        const topics = await fetchCityTopics(channelId);
        const now = Date.now() / 1000;
        setTopicFeedItems(topics.map(t => ({
          id:        `topic-msg-${t.id}`,
          type:      'topic' as const,
          topicId:   t.id,
          content:   t.title,
          nickname:  '',
          createdAt: now,
        })));
      } catch {}
    }

    loadTopics();

    // Fallback poll for topic expiry cleanup — runs only when WS is disconnected.
    // New topics arrive instantly via newTopic WS event; this only removes expired ones.
    let pollId: ReturnType<typeof setInterval> | null = null;

    function startTopicPoll() {
      if (pollId !== null) return;
      pollId = setInterval(loadTopics, 5 * 60_000);
    }
    function stopTopicPoll() {
      if (pollId !== null) { clearInterval(pollId); pollId = null; }
    }

    if (!socket.isConnected) startTopicPoll();
    const offDisconnected = socket.on('disconnected', () => startTopicPoll());
    const offConnected    = socket.on('connected', () => { stopTopicPoll(); loadTopics(); });

    // WS: new topic created — append pill immediately.
    const offTopic = socket.on('newTopic', (data: Record<string, unknown>) => {
      if (String(data.channelId) !== String(channelId)) return;
      const t = data.topic as Record<string, unknown> | undefined;
      const topicId = (t?.id ?? '') as string;
      if (!topicId) return;
      const now = Date.now() / 1000;
      setTopicFeedItems(prev => {
        if (prev.some(p => p.topicId === topicId)) return prev;
        return [...prev, {
          id:        `topic-msg-${topicId}`,
          type:      'topic' as const,
          topicId,
          content:   (t?.title as string) ?? '',
          nickname:  '',
          createdAt: now,
        }];
      });
    });

    return () => { stopTopicPoll(); offDisconnected(); offConnected(); offTopic(); };
  }, [channelId]);

  const loadFn = useCallback(
    (opts?: { beforeId?: string }) => fetchMessages(channelId, opts),
    [channelId],
  );

  const postTextFn = useCallback(
    (content: string, replyToId?: string | null): Promise<Message> => {
      if (!identity || !sessionId) return Promise.reject(new Error('Not ready'));
      return sendMessage(channelId, sessionId, identity.guestId, nickname, content, replyToId);
    },
    [channelId, identity, sessionId, nickname],
  );

  const postImageFn = useCallback(
    (imageUrl: string): Promise<Message> => {
      if (!identity || !sessionId) return Promise.reject(new Error('Not ready'));
      return sendImageMessage(channelId, sessionId, identity.guestId, nickname, imageUrl);
    },
    [channelId, identity, sessionId, nickname],
  );

  // Use pre-loaded data from the bootstrap endpoint if available for the current channel.
  const chatBootstrap = bootstrapData?.channelId === channelId ? bootstrapData : undefined;

  const { messages, loading, loadingOlder, hasMore, sending, error, clearError, sendText, sendImage, loadOlder, setMessageReactions } = useMessages({
    channelId,
    loadFn,
    postTextFn,
    postImageFn,
    initialData: chatBootstrap ? { messages: chatBootstrap.messages, hasMore: chatBootstrap.hasMore } : undefined,
  });

  // ── System feed prompts + ambient activity messages ────────────────────────
  // Mirrors web App.jsx schedulePrompts() + scheduleActivity().
  // Injected locally after join; never sent to the server.

  const [promptItems,    setPromptItems]    = useState<Message[]>([]);
  const promptsShownRef  = useRef(new Set<string>());
  const isActiveRef      = useRef(false);
  const messagesRef      = useRef(messages);
  messagesRef.current    = messages;          // updated every render — safe to read in timers
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptTimersRef  = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pickImageRef     = useRef<(() => void) | null>(null);
  const flatListRef      = useRef<FlatList<Message>>(null);
  const [replyingTo,       setReplyingTo]       = useState<ReplyRef | null>(null);
  const replyingToRef    = useRef<ReplyRef | null>(null);
  replyingToRef.current  = replyingTo;
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [actionSheetMsg,   setActionSheetMsg]   = useState<Message | null>(null);

  function realMessageCount() {
    return messagesRef.current.filter(m => m.type === 'text' || m.type === 'image').length;
  }

  function scheduleActivity(isFirst = false) {
    if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
    const delay = isFirst ? 30_000 : 60_000 + Math.random() * 60_000;
    activityTimerRef.current = setTimeout(() => {
      if (!isActiveRef.current) return;
      if (realMessageCount() < 3) {
        const text = AMBIENT_MESSAGES[Math.floor(Math.random() * AMBIENT_MESSAGES.length)];
        setPromptItems(prev => [...prev, {
          id:        `act-${Date.now()}`,
          type:      'activity' as const,
          subtype:   'crowd',
          content:   text,
          nickname:  '',
          createdAt: Date.now() / 1000,
        }]);
      }
      scheduleActivity();
    }, delay);
  }

  function schedulePrompts() {
    const t1 = setTimeout(() => {
      if (!isActiveRef.current || promptsShownRef.current.has('explore')) return;
      if (realMessageCount() > 0) return; // only inject if feed is still empty
      promptsShownRef.current.add('explore');
      setPromptItems(prev => [...prev, {
        id: `prompt-explore-${Date.now()}`, type: 'prompt' as const,
        subtype: 'explore', content: "🔥 See what's happening now", cta: 'Explore',
        nickname: '', createdAt: Date.now() / 1000,
      }]);
    }, 15_000);

    const t2 = setTimeout(() => {
      if (!isActiveRef.current || promptsShownRef.current.has('photo')) return;
      if (realMessageCount() >= 3) return;
      promptsShownRef.current.add('photo');
      setPromptItems(prev => [...prev, {
        id: `prompt-photo-${Date.now()}`, type: 'prompt' as const,
        subtype: 'photo', content: "📸 Share what's happening", cta: 'Shoot',
        nickname: '', createdAt: Date.now() / 1000,
      }]);
    }, 30_000);

    const t3 = setTimeout(() => {
      if (!isActiveRef.current || promptsShownRef.current.has('create-event')) return;
      if (realMessageCount() >= 3) return;
      promptsShownRef.current.add('create-event');
      setPromptItems(prev => [...prev, {
        id: `prompt-create-${Date.now()}`, type: 'prompt' as const,
        subtype: 'create-event', content: '🎉 Got a plan tonight?', cta: 'Create event',
        nickname: '', createdAt: Date.now() / 1000,
      }]);
    }, 60_000);

    promptTimersRef.current.push(t1, t2, t3);
  }

  function handlePromptCta(subtype: string) {
    setPromptItems(prev => prev.filter(p => p.subtype !== subtype));
    if (subtype === 'photo') {
      pickImageRef.current?.();
    } else if (subtype === 'create-event') {
      router.push('/event/create');
    } else if (subtype === 'explore') {
      router.push('/(tabs)/now');
    }
  }

  // Start scheduling when the channel becomes active; cancel on channel change or unmount.
  useEffect(() => {
    if (!channelId) return;
    isActiveRef.current = true;
    promptsShownRef.current = new Set();
    setPromptItems([]);
    promptTimersRef.current.forEach(clearTimeout);
    promptTimersRef.current = [];

    scheduleActivity(true);
    schedulePrompts();

    return () => {
      isActiveRef.current = false;
      promptTimersRef.current.forEach(clearTimeout);
      if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
    };
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Weather — extracted from messages for header display, not rendered in the feed.
  const weatherLabel = useMemo<string | null>(() => {
    const w = messages.find(m => m.type === 'system' && m.event === 'weather');
    if (!w?.content) return null;
    // Strip " in CityName — " to avoid repeating the city name already shown in the header
    // e.g. "☀️ 22°C in Paris — it's gorgeous" → "☀️ 22°C · it's gorgeous"
    return w.content.replace(/ in [A-Z][^\u2014\n]*(\u2014\s*)?/, (_: string, dash: string) => dash ? '\u00B7 ' : '').trim();
  }, [messages]);

  // Unified feed — weather excluded (shown in header only).
  //
  // Sorted newest-first for the inverted FlatList:
  //   index 0 = bottom of screen (newest message, near input)
  //   high index = top of screen (oldest, user scrolls up)
  //
  // Event/topic/prompt items are synthesised with createdAt ≈ load time.
  // Sorting by timestamp places them naturally at the bottom of history.
  const allMessages = useMemo<Message[]>(() => {
    const chat = messages.filter(m => !(m.type === 'system' && m.event === 'weather'));
    return [...chat, ...eventFeedItems, ...topicFeedItems, ...promptItems]
      .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
  }, [messages, eventFeedItems, topicFeedItems, promptItems]);

  // ── Reply callbacks ───────────────────────────────────────────────────────────

  const scrollToMessage = useCallback((id: string) => {
    const idx = allMessages.findIndex(m => m.id === id);
    if (idx === -1) return;
    flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
    setHighlightedMsgId(id);
    setTimeout(() => setHighlightedMsgId(null), 1500);
  }, [allMessages]);

  const handleMessageLongPress = useCallback((msg: Message) => {
    // City channel messages arrive from the PHP API without a `type` field
    // (undefined at runtime). We only block local/optimistic placeholders —
    // the type guard is unnecessary here because ChatMessage's own early-return
    // branches ensure only text/image bubbles get a Pressable with this handler.
    if (!msg.id || msg.id.startsWith('local-')) return;
    setActionSheetMsg(msg);
  }, []);

  const handleReply = useCallback((msg: Message) => {
    setReplyingTo({
      id:       msg.id,
      nickname: msg.nickname,
      content:  msg.content ?? '',
      type:     msg.type ?? 'text',
    });
  }, []);

  // Wraps useMessages sendText to inject the current replyingTo before clearing it.
  const handleSendText = useCallback((text: string) => {
    const reply = replyingToRef.current;
    setReplyingTo(null);
    sendText(text, reply);
  }, [sendText]);

  const handleReact = useCallback(async (msg: Message, emoji: string) => {
    if (!msg.id || !identity) return;
    // Fire local animation + broadcast to other clients
    const type = EMOJI_TO_TYPE[emoji];
    if (type) {
      reactionEmitter.emit(msg.id, type);
      socket.sendReaction(type, msg.id, String(channelId), account?.id ?? null);
    }
    try {
      const reactions = await toggleChannelReaction(String(channelId), msg.id, emoji, identity.guestId);
      setMessageReactions(msg.id, reactions);
    } catch (e) {
      console.warn('[chat] reaction failed:', e);
    }
  }, [channelId, identity, account, setMessageReactions]);

  // No city yet — prompt to pick one
  if (!city) {
    return (
      <SafeAreaView style={[styles.container, { paddingBottom: 0 }]}>
        <View style={styles.noCityWrap}>
          <Text style={styles.noCityTitle}>No city selected</Text>
          <Text style={styles.noCitySubtitle}>
            We couldn't detect your location.{'\n'}Go to Cities to pick one.
          </Text>
          <TouchableOpacity
            style={styles.citiesBtn}
            onPress={() => router.push('/switch-city' as never)}
            activeOpacity={0.8}
          >
            <Text style={styles.citiesBtnText}>Browse cities →</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const flag = cityFlag(city.country);

  return (
    <SafeAreaView style={[styles.container, { paddingBottom: 0 }]} edges={['top']}>

      {/* ── Header — 3-section redesign ── */}
      <View style={styles.header}>

        {/* ── Section 1: Top bar — bell | logo+tagline | share+DMs ── */}
        <View style={styles.topBar}>

          {/* Left: notification bell */}
          <View style={styles.topLeft}>
            {account && (
              <TouchableOpacity
                style={[styles.iconBtn, unreadNotifications > 0 && styles.iconBtnUnread]}
                activeOpacity={0.65}
                onPress={() => router.push('/notifications' as never)}
                accessibilityLabel="Notifications"
              >
                <Ionicons name="notifications-outline" size={20} color={Colors.text} />
                {unreadNotifications > 0 && (
                  <View style={styles.iconBadge}>
                    <Text style={styles.iconBadgeText}>
                      {unreadNotifications > 9 ? '9+' : String(unreadNotifications)}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Center: logo + tagline stacked */}
          <View style={styles.topCenter}>
            <View style={styles.iconGlow}>
              <HiladsIcon size={36} />
            </View>
            <Text style={styles.headerTagline}>Feel local. Anywhere.</Text>
          </View>

          {/* Right: share + DMs */}
          <View style={styles.topRight}>
            {city && (
              <TouchableOpacity
                style={styles.iconBtn}
                activeOpacity={0.65}
                onPress={async () => {
                  const url = `${BASE_URL}/city/${city.slug}`;
                  await Share.share({ title: `Who's in ${city.name} right now | Hilads`, url, message: `Who's in ${city.name} right now | Hilads ${url}` });
                }}
                accessibilityLabel="Share city"
              >
                <Feather name="share" size={18} color={Colors.text} />
              </TouchableOpacity>
            )}
            {account && (
              <TouchableOpacity
                style={[styles.iconBtn, unreadDMs > 0 && styles.iconBtnUnread]}
                activeOpacity={0.65}
                onPress={() => {
                  setUnreadDMs(0);
                  clearEventChatCounts();
                  router.push('/messages');
                }}
                accessibilityLabel="Messages"
              >
                <Feather name="message-square" size={18} color={Colors.text} />
                {unreadDMs > 0 && (
                  <View style={styles.iconBadge}>
                    <Text style={styles.iconBadgeText}>
                      {unreadDMs > 9 ? '9+' : String(unreadDMs)}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          </View>

        </View>

        {/* ── Section 2: City hero name — tappable → switch city ── */}
        <TouchableOpacity
          style={styles.cityHeroRow}
          onPress={() => router.push('/switch-city' as never)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Change city"
        >
          <Text style={styles.cityHeroName} numberOfLines={2}>
            {flag ? `${flag} ` : ''}{city.name}
          </Text>
          <Ionicons
            name="chevron-down"
            size={18}
            color="rgba(255,255,255,0.45)"
            style={styles.cityHeroChevron}
          />
        </TouchableOpacity>

        {/* ── Section 3: Context chips ── */}
        <View style={styles.chipsRow}>
          {weatherLabel && (
            <TouchableOpacity
              style={[styles.chip, styles.chipWeather]}
              activeOpacity={0.75}
              onPress={() => { /* TODO: open weather detail view */ }}
              accessibilityLabel={`Current weather: ${weatherLabel}`}
              accessibilityRole="button"
            >
              <Ionicons name="cloud-outline" size={13} color="rgba(255,255,255,0.45)" />
              <Text style={styles.chipWeatherText}>{weatherLabel}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.chip, styles.chipOnline]}
            activeOpacity={0.75}
            onPress={() => router.push('/(tabs)/here' as never)}
            accessibilityLabel={`${onlineCount ?? 0} people hanging out, tap to see who`}
            accessibilityRole="button"
          >
            <ChipLiveDot />
            <Text style={styles.chipOnlineText}>
              {onlineCount != null ? `${onlineCount} hanging out` : 'live now'}
            </Text>
          </TouchableOpacity>
        </View>

      </View>

      {/* Error banner */}
      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8}>
          <Text style={styles.errorBannerText}>{error} · tap to dismiss</Text>
        </TouchableOpacity>
      )}

      {/* ── Messages — web: .messages ── */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={allMessages}
            keyExtractor={(m, idx) => (m.id ? m.id : String(idx))}
            renderItem={({ item, index }) => {
              const olderMsg = allMessages[index + 1]; // older (higher index in inverted list)
              const newerMsg = allMessages[index - 1]; // newer (lower index)
              const isGrouped =
                !!olderMsg &&
                olderMsg.guestId === item.guestId &&
                olderMsg.type !== 'system' &&
                olderMsg.type !== 'event' &&
                olderMsg.type !== 'topic' &&
                olderMsg.type !== 'activity' &&
                olderMsg.type !== 'prompt' &&
                item.type !== 'system' &&
                item.type !== 'event' &&
                item.type !== 'topic' &&
                item.type !== 'activity' &&
                item.type !== 'prompt';
              // showTime: last (newest) message in a sender run — newerMsg differs or absent
              const showTime =
                item.type !== 'system' && item.type !== 'event' && item.type !== 'topic' &&
                item.type !== 'activity' && item.type !== 'prompt' && (
                  !newerMsg ||
                  newerMsg.guestId !== item.guestId ||
                  newerMsg.type === 'system'
                );
              // dateLabel: show when this item starts a new calendar day vs the older message
              const dateLabel =
                item.type !== 'event' && item.type !== 'topic' &&
                item.type !== 'activity' && item.type !== 'prompt' &&
                !isSameDay(item.createdAt, olderMsg?.createdAt)
                  ? formatDateLabel(item.createdAt)
                  : undefined;
              return (
                <ChatMessage
                  message={item}
                  myGuestId={identity?.guestId}
                  index={index}
                  isGrouped={isGrouped}
                  showTime={showTime}
                  dateLabel={dateLabel}
                  onPromptCta={handlePromptCta}
                  onLongPress={handleMessageLongPress}
                  onReplyQuotePress={scrollToMessage}
                  isHighlighted={highlightedMsgId === item.id}
                  onReact={handleReact}
                />
              );
            }}
            inverted
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            onEndReached={hasMore ? loadOlder : undefined}
            onEndReachedThreshold={0.2}
            ListFooterComponent={
              loadingOlder ? (
                <View style={styles.loadingOlderWrap}>
                  <ActivityIndicator size="small" color={Colors.muted} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyIcon}>🔥</Text>
                <Text style={styles.emptyTitle}>People are arriving</Text>
                <Text style={styles.emptySub}>Be the first to say hi 👇</Text>
              </View>
            }
          />
        )}

        {/* ── Ephemeral event banners — slide in above input, auto-dismissed ── */}
        {eventBanners.map(banner => (
          <EventBannerStrip
            key={banner.id}
            title={banner.title}
            eventId={banner.id}
            onDismiss={() => dismissBanner(banner.id)}
          />
        ))}

        {/* ── Typing indicator bar ── */}
        {typingLabel && (
          <View style={styles.typingBar}>
            <Text style={styles.typingText}>{typingLabel}</Text>
          </View>
        )}

        {/* ── Input — web: .input-bar ── */}
        <ChatInput
          sending={sending}
          onSendText={handleSendText}
          onSendImage={sendImage}
          placeholder={getPlaceholder(channelId)}
          pickImageRef={pickImageRef}
          onTypingStart={handleTypingStart}
          onTypingStop={handleTypingStop}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
        />
      </KeyboardAvoidingView>

      <MessageActionSheet
        visible={actionSheetMsg !== null}
        reactions={actionSheetMsg?.reactions ?? []}
        onReact={emoji => { if (actionSheetMsg) handleReact(actionSheetMsg, emoji); }}
        onReply={actionSheetMsg ? () => handleReply(actionSheetMsg) : undefined}
        onClose={() => setActionSheetMsg(null)}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex:      { flex: 1 },

  // ── Header container ───────────────────────────────────────────────────────
  header: {
    flexDirection:     'column',
    gap:               14,
    paddingTop:        14,
    paddingBottom:     16,
    paddingHorizontal: 16,
    backgroundColor:   Colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    shadowColor:       '#C24A38',
    shadowOffset:      { width: 0, height: 6 },
    shadowOpacity:     0.08,
    shadowRadius:      20,
    elevation:         3,
  },

  // ── Section 1: Top bar ─────────────────────────────────────────────────────
  topBar: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  topLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    // Fixed min-width keeps center block truly centered
    minWidth:      36,
  },
  // Center block: logo + tagline side-by-side
  topCenter: {
    flex:             1,
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'center',
    gap:              8,
    paddingHorizontal: 8,
  },
  topRight: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },

  // Icon buttons — 36×36, border-radius 10
  iconBtn: {
    width:           36,
    height:          36,
    borderRadius:    10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
    position:        'relative',
  },
  iconBtnUnread: {
    backgroundColor: 'rgba(255,122,60,0.08)',
    borderColor:     'rgba(255,122,60,0.18)',
  },
  iconBadge: {
    position:          'absolute',
    top:               -5,
    right:             -5,
    minWidth:          16,
    height:            16,
    borderRadius:      8,
    backgroundColor:   '#ef4444',
    borderWidth:       1.5,
    borderColor:       Colors.bg2,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: 2,
  },
  iconBadgeText: {
    color:      Colors.white,
    fontSize:   9,
    fontWeight: '700',
    lineHeight: 11,
  },

  // Logo + tagline
  headerTagline: {
    fontSize:      11,
    lineHeight:    14,   /* 11 × 1.3 ≈ 14 */
    color:         'rgba(255,255,255,0.5)',
    fontWeight:    '400',
    letterSpacing: 0.2,
    // Narrow enough to force "Feel local." / "Anywhere." onto separate lines
    maxWidth:      72,
  },

  // ── Logo glow — web: .chat-header .logo svg { drop-shadow orange } ─────────
  iconGlow: {
    shadowColor:   '#C24A38',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius:  14,
    elevation:     10,
  },

  // ── Section 2: City hero name ─────────────────────────────────────────────
  cityHeroRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            6,
  },
  cityHeroName: {
    fontSize:      24,
    fontWeight:    '500',
    color:         Colors.text,
    lineHeight:    29,
    letterSpacing: -0.3,
    textAlign:     'center',
  },
  cityHeroChevron: {
    marginTop: 2,   // visually align with the text x-height, not its box
  },

  // ── Section 3: Context chips ───────────────────────────────────────────────
  chipsRow: {
    flexDirection:  'row',
    flexWrap:       'wrap',
    gap:            8,
    justifyContent: 'center',
  },
  chip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    paddingVertical:   7,
    paddingHorizontal: 13,
    borderRadius:      999,
    borderWidth:       1,
  },
  chipWeather: {
    backgroundColor: '#1a1a1a',
    borderColor:     'rgba(255,255,255,0.08)',
  },
  chipWeatherText: {
    fontSize:   12,
    fontWeight: '500',
    color:      'rgba(255,255,255,0.45)',
  },
  chipOnline: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor:     'rgba(239,68,68,0.28)',
  },
  chipOnlineText: {
    fontSize:   12,
    fontWeight: '500',
    color:      '#fca5a5',
  },
  // Red animated dot inside the online chip
  chipLiveDot: {
    width:           7,
    height:          7,
    borderRadius:    4,
    backgroundColor: '#ef4444',
    flexShrink:      0,
  },

  // ── Error banner ─────────────────────────────────────────────────────────
  errorBanner:     { backgroundColor: Colors.red, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  errorBannerText: { color: Colors.white, fontSize: FontSizes.xs, textAlign: 'center' },

  // ── Typing indicator bar ──────────────────────────────────────────────────
  // Sits between messages and input. Subtle — just a dim text label.
  typingBar: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   6,
  },
  typingText: {
    fontSize:   FontSizes.xs,
    color:      Colors.muted,
    fontStyle:  'italic',
  },

  // ── Messages ─────────────────────────────────────────────────────────────
  // web: .messages { padding: 22px 18px 14px; gap: 8px }
  listContent: {
    paddingTop:    28,
    paddingBottom: 18,
  },

  // ── Empty state — web: .empty ─────────────────────────────────────────────
  emptyWrap: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    padding:        Spacing.xl,
    gap:            8,
  },
  emptyIcon:  { fontSize: 36 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  emptySub:   { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center' },

  // ── No city state ─────────────────────────────────────────────────────────
  noCityWrap: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    padding:        Spacing.xl,
    gap:            8,
  },
  noCityTitle:    { fontSize: FontSizes.md, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  noCitySubtitle: { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
  citiesBtn: {
    marginTop:         Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    backgroundColor:   Colors.accentDim,
    borderRadius:      999,
  },
  citiesBtnText: { color: Colors.accent, fontWeight: '600', fontSize: FontSizes.sm },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingOlderWrap: { paddingVertical: 14, alignItems: 'center' },

  // ── EventBannerStrip ──────────────────────────────────────────────────────
  bannerStrip: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 14,
    paddingVertical:   10,
    backgroundColor:   'rgba(194,74,56,0.12)',
    borderTopWidth:    1,
    borderTopColor:    'rgba(255,122,60,0.22)',
    gap:               10,
  },
  bannerText: {
    flex:       1,
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      Colors.text,
  },
  bannerBtn: {
    backgroundColor:   'rgba(255,122,60,0.55)',
    borderRadius:      10,
    paddingHorizontal: 12,
    paddingVertical:   5,
    flexShrink:        0,
  },
  bannerBtnText: { color: '#fff', fontSize: FontSizes.sm, fontWeight: '700' },
  bannerDismiss: { flexShrink: 0, padding: 2 },
  bannerDismissText: { fontSize: 13, color: Colors.muted2 },
});
