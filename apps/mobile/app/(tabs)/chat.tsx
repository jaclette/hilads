/**
 * City channel screen - faithful port of the web "ready" state.
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
  StyleSheet, KeyboardAvoidingView,
  TouchableOpacity, Animated, AppState, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { useMessages } from '@/hooks/useMessages';
import { fetchMessages, sendMessage, sendImageMessage, toggleChannelReaction } from '@/api/channels';
import { fetchCityEvents, fetchCanCreateEvent } from '@/api/events';
import { fetchCityTopics } from '@/api/topics';
import { fetchCityChallenges } from '@/api/challenges';
import type { HiladsEvent } from '@/types';
import { socket } from '@/lib/socket';
import { reactionEmitter, EMOJI_TO_TYPE } from '@/lib/reactionEmitter';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput } from '@/features/chat/ChatInput';
import { MessageActionSheet } from '@/features/chat/MessageActionSheet';
import { ArrivalsBar } from '@/features/chat/ArrivalsBar';
import { ArrivalsSheet } from '@/features/chat/ArrivalsSheet';
import * as Clipboard from 'expo-clipboard';
import { HiladsIcon } from '@/components/HiladsIcon';
import { AppHeader } from '@/features/shell/AppHeader';
import { MarqueeText } from '@/components/MarqueeText';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Colors, FontSizes, Spacing, Radius, buildCityUrl } from '@/constants';
import { isSameDay, formatDateLabel, toMs } from '@/lib/messageTime';
import { shareLink } from '@/lib/shareLink';
import { hasSeenOnboarding } from '@/lib/onboarding';
import { ChallengeIntroCarousel } from '@/features/onboarding/ChallengeIntroCarousel';
import { localizeWeather } from '@/lib/weather';
import { fetchLeaderboard } from '@/api/leaderboard';
import type { Message, ReplyRef, MentionRef } from '@/types';

// ── EventBannerStrip - ephemeral overlay above the input ─────────────────────
// Appears when a new event is broadcast via WS. Auto-dismissed after 10 s.
// Throttled: max once every 2 minutes per session.

interface BannerProps {
  title:     string;
  eventId:   string;
  onDismiss: () => void;
}

function EventBannerStrip({ title, eventId, onDismiss }: BannerProps) {
  const router  = useRouter();
  const { t }   = useTranslation('chat');
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
        {t('bannerNewEvent', { title })}
      </Text>
      <TouchableOpacity style={styles.bannerBtn} onPress={handleJoin} activeOpacity={0.8}>
        <Text style={styles.bannerBtnText}>{t('join')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.bannerDismiss} onPress={onDismiss} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.bannerDismissText}>✕</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Flag emoji - mirrors web cityFlag() ──────────────────────────────────────

function cityFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '';
  return [...countryCode.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

// ── Chip live dot - red pulsing dot for the "hanging out" chip ───────────────
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

// ── Screen ────────────────────────────────────────────────────────────────────

// ── Screen ────────────────────────────────────────────────────────────────────
// Tab bar is in-flow (flex-column sibling), so the screen content area ends
// exactly at the tab bar top. No paddingBottom needed on the SafeAreaView.
// ChatInput uses elevation: 30 to render above the tab bar's upward shadow.

export default function ChatTab() {
  const router = useRouter();
  const { t, i18n } = useTranslation('chat');
  const {
    city, identity, sessionId, account,
    unreadDMs, setUnreadDMs,
    unreadNotifications,
    clearEventChatCounts,
    bootstrapData,
    joined, setShowOnboarding,
  } = useApp();
  const nickname = account?.display_name ?? identity?.nickname ?? '';

  // First-time onboarding carousel - guests only, once, after the city channel
  // is ready (joined). Runs after paint so it overlays a loaded screen instead
  // of blocking/flashing first render. Registered users never trigger it; the
  // AsyncStorage flag keeps it from re-appearing. The carousel is mounted in
  // (tabs)/_layout.tsx and reads `showOnboarding` from AppContext.
  const onboardingCheckedRef = useRef(false);
  useEffect(() => {
    if (onboardingCheckedRef.current) return;
    if (!joined || account) return;
    onboardingCheckedRef.current = true;
    let cancelled = false;
    (async () => {
      if (await hasSeenOnboarding()) return;
      if (!cancelled) setTimeout(() => setShowOnboarding(true), 400);
    })();
    return () => { cancelled = true; };
  }, [joined, account, setShowOnboarding]);

  // Online count - fallback "live now" until presence data arrives.
  //   presenceSnapshot   → sent only to US when we (re)join the room (initial value)
  //   onlineCountUpdated → sent to EXISTING members when someone else joins/leaves
  // We must listen to BOTH: snapshot alone never updates once we're in the room,
  // so the count would freeze at our join value until an app restart.
  const [onlineCount, setOnlineCount] = useState<number | null>(null);

  useEffect(() => {
    const cid = city?.channelId;
    if (!cid) return;
    // Server echoes cityId as an integer (e.g. 1); native channelId is a string
    // ("1"). Coerce + match so we ignore events for other cities the socket may
    // still be in before server-side cleanup.
    const matches = (d: Record<string, unknown>) =>
      String(d.cityId) === cid || String(d.channelId) === cid;

    const offSnap = socket.on('presenceSnapshot', (data: Record<string, unknown>) => {
      if (!matches(data)) return;
      const next = typeof data.count === 'number' ? data.count
                 : Array.isArray(data.users) ? data.users.length
                 : null;
      if (next !== null) setOnlineCount(next);
    });
    const offCount = socket.on('onlineCountUpdated', (data: Record<string, unknown>) => {
      if (!matches(data)) return;
      if (typeof data.count === 'number') setOnlineCount(data.count);
    });
    return () => { offSnap(); offCount(); };
  }, [city?.channelId]);

  const channelId = city?.channelId ?? '';

  // ── Leaderboard chip - caller's monthly city rank ─────────────────────────
  // One bounded fetch per city change. limit=1 to skip the list payload;
  // we only need me.rank/me.points. Silent failure → neutral chip copy.
  // Re-fires on city switch so the chip reflects the new city's standings.
  const [myCityRank,   setMyCityRank]   = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!account?.id || !channelId) { setMyCityRank(null); return; }
    (async () => {
      const res = await fetchLeaderboard({
        scope: 'city', period: 'month', limit: 1, offset: 0,
        cityId: `city_${channelId}`,
      });
      if (cancelled) return;
      setMyCityRank(res?.me?.rank ?? null);
    })();
    return () => { cancelled = true; };
  }, [account?.id, channelId]);

  // ── Typing indicators ─────────────────────────────────────────────────────
  // Server broadcasts typingUsers to the city room whenever typingStart/Stop fires.
  // We filter out our own session so we never show "you are typing".

  type TypingUser = { sessionId: string; nickname: string };
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);

  useEffect(() => {
    const off = socket.on('typingUsers', (data: Record<string, unknown>) => {
      // Server echoes cityId as integer (e.g. 1); native channelId is a string ("1").
      // Without this guard, typing in any city the socket is still in (e.g. via a
      // stale membership before server-side cleanup) would leak into the active
      // chat - that was the data-leak between HCMC and Berlin reported in #ws-leak.
      if (String(data.cityId) !== channelId) return;
      const users = (data.users as TypingUser[] | undefined) ?? [];
      setTypingUsers(users);
    });
    // Clear on channel switch so stale indicators don't bleed across cities
    return () => { off(); setTypingUsers([]); };
  }, [channelId]);

  const typingLabel = useMemo<string | null>(() => {
    const others = typingUsers.filter(u => u.sessionId !== sessionId);
    if (others.length === 0) return null;
    if (others.length === 1) return t('typingOne', { name: others[0].nickname });
    if (others.length === 2) return t('typingTwo', { a: others[0].nickname, b: others[1].nickname });
    return t('typingMany', { name: others[0].nickname, count: others.length - 1 });
  }, [typingUsers, sessionId, t]);

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
  // No global throttle - every new event in this channel gets a banner.

  // ── Event feed synthesis state - declared before WS effect that uses it ─────
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

  // ── Events: initial synthesis + a SINGLE new_event subscription ─────────────
  // Was two separate effects both subscribed to 'new_event' (one for banners,
  // one for feed pills) - every event ran both handlers. They're merged here so
  // there's one subscription that does banner + feed-pill + auto-expire, plus
  // the one-time fetchCityEvents synthesis of already-live events. Feed +
  // banners reset on channel change (they're per-city).
  useEffect(() => {
    if (!channelId) return;
    seenEventIds.current.clear();
    setEventFeedItems([]);
    setEventBanners([]);

    // One-time: synthesize feed pills for events already live in this city.
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

    // Live: a new event in this city → banner + feed pill + 20s auto-expire.
    const off = socket.on('new_event', (data: { hiladsEvent?: HiladsEvent; channelId?: string | number }) => {
      // String coercion handles server sending channelId as number vs string.
      if (!data.hiladsEvent || String(data.channelId) !== String(channelId)) return;
      const { id, title } = data.hiladsEvent;

      setEventBanners(prev => {
        if (prev.some(b => b.id === id)) return prev;
        return [{ id, title }, ...prev].slice(0, 3); // cap at 3
      });

      if (!seenEventIds.current.has(id)) {
        seenEventIds.current.add(id);
        setEventFeedItems(prev => [{
          id:        `event-msg-${id}`,
          type:      'event',
          eventId:   id,
          content:   title,
          nickname:  '',
          createdAt: Date.now() / 1000,
        }, ...prev]);
      }

      // Per-banner 20s auto-expire timer.
      if (bannerTimers.current.has(id)) clearTimeout(bannerTimers.current.get(id)!);
      const t = setTimeout(() => {
        setEventBanners(prev => prev.filter(b => b.id !== id));
        bannerTimers.current.delete(id);
      }, 20_000);
      bannerTimers.current.set(id, t);
    });

    return () => {
      off();
      bannerTimers.current.forEach(t => clearTimeout(t));
      bannerTimers.current.clear();
    };
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

    // Fallback poll for topic expiry cleanup - runs only when WS is disconnected.
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

    // WS: new topic created - append pill immediately.
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

  // ── Challenge feed item synthesis ────────────────────────────────────────
  // Active challenges appear as orange pills in the city chat ("X défie les
  // locaux : <title>"). Same pattern as events: fetch on channel load to
  // synthesize current items, WS new_challenge appends fresh ones.

  const seenChallengeIds = useRef(new Set<string>());
  const [challengeFeedItems, setChallengeFeedItems] = useState<Message[]>([]);

  useEffect(() => {
    if (!channelId) return;
    seenChallengeIds.current.clear();
    setChallengeFeedItems([]);

    fetchCityChallenges(channelId).then(chs => {
      // Cap the chat-feed prompts at the 5 newest. Older challenges still
      // surface in the NOW feed (paginated) and the Challenges filter; the
      // chat surface is meant to feel "live" - too many prompts at once
      // pushes real conversation off the screen.
      const newest = chs.slice(0, 5);
      const now = Date.now() / 1000;
      const fresh: Message[] = [];
      for (const c of newest) {
        if (!seenChallengeIds.current.has(c.id)) {
          seenChallengeIds.current.add(c.id);
          // participants_preview[0] is the creator (auto-joined at create
          // time); fall back to a generic placeholder if for some reason
          // the preview is empty.
          const creatorName = c.participants_preview?.[0]?.displayName ?? '';
          fresh.push({
            id:          `challenge-msg-${c.id}`,
            type:        'challenge',
            challengeId: c.id,
            content:     c.title,
            nickname:    creatorName,
            audience:    c.audience,
            challengeMode: c.mode ?? 'local',
            challengeStatus: c.status,
            // International rows render with origin → target flags instead
            // of the "{{name}} sent a cross-city challenge" wording; pass
            // both codes through so ChatMessage can build the label.
            challengeCountry:       c.country ?? null,
            challengeTargetCountry: c.target_country ?? null,
            createdAt:   now,
          });
        }
      }
      if (fresh.length > 0) setChallengeFeedItems(prev => [...prev, ...fresh]);
    }).catch(() => {});

    // WS: new challenge created - append pill immediately (no poll).
    const offChallenge = socket.on('new_challenge', (data: Record<string, unknown>) => {
      if (String(data.channelId) !== String(channelId)) return;
      const ch = data.challenge as Record<string, unknown> | undefined;
      const id = (ch?.id ?? '') as string;
      if (!id || seenChallengeIds.current.has(id)) return;
      seenChallengeIds.current.add(id);
      setChallengeFeedItems(prev => [...prev, {
        id:          `challenge-msg-${id}`,
        type:        'challenge' as const,
        challengeId: id,
        content:     (ch?.title as string) ?? '',
        nickname:    (ch?.nickname as string) ?? '',
        audience:    (ch?.audience as 'locals' | 'explorers') ?? 'locals',
        challengeMode: ((ch?.mode as 'local' | 'international') ?? 'local'),
        challengeStatus: (ch?.status as 'open' | 'validated') ?? 'open',
        // PR19 - origin + target flags for the international banner (see
        // chat-list synthesis above).
        challengeCountry:       (ch?.country        as string | null) ?? null,
        challengeTargetCountry: (ch?.target_country as string | null) ?? null,
        createdAt:   Date.now() / 1000,
      }]);
    });

    // WS: challenge validated - celebration pill, separate from the creation
    // pill so both events stay in the timeline. Dedup id is per-challenge
    // (not per-validation) since validate is idempotent.
    const seenValidatedKey = (id: string) => `challenge-validated-${id}`;
    const offValidated = socket.on('challenge_validated', (data: Record<string, unknown>) => {
      if (String(data.channelId) !== String(channelId)) return;
      const ch = data.challenge as Record<string, unknown> | undefined;
      const id = (ch?.id ?? '') as string;
      if (!id) return;
      const itemId = seenValidatedKey(id);
      setChallengeFeedItems(prev => {
        if (prev.some(p => p.id === itemId)) return prev;
        return [...prev, {
          id:          itemId,
          type:        'challenge_validated' as const,
          challengeId: id,
          content:     (ch?.title as string) ?? '',
          nickname:    (ch?.nickname as string) ?? '',
          createdAt:   Date.now() / 1000,
        }];
      });
    });

    return () => { offChallenge(); offValidated(); };
  }, [channelId]);

  const loadFn = useCallback(
    (opts?: { beforeId?: string }) => fetchMessages(channelId, opts),
    [channelId],
  );

  const postTextFn = useCallback(
    (content: string, replyToId?: string | null, mentions?: MentionRef[]): Promise<Message> => {
      if (!identity || !sessionId) return Promise.reject(new Error('Not ready'));
      return sendMessage(channelId, sessionId, identity.guestId, nickname, content, replyToId, mentions);
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

  const { messages, loading, loadingOlder, hasMore, sending, error, clearError, sendText, sendImage, loadOlder, setMessageReactions, editMessage, deleteMessage } = useMessages({
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
  // "How challenges work" carousel - opened from the challenge-intro prompt.
  const [showChallengeIntro, setShowChallengeIntro] = useState(false);
  const promptsShownRef  = useRef(new Set<string>());
  const isActiveRef      = useRef(false);
  const messagesRef      = useRef(messages);
  messagesRef.current    = messages;          // updated every render - safe to read in timers
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptTimersRef  = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pickImageRef     = useRef<(() => void) | null>(null);
  const flatListRef      = useRef<FlatList<Message>>(null);
  const [replyingTo,       setReplyingTo]       = useState<ReplyRef | null>(null);
  const replyingToRef    = useRef<ReplyRef | null>(null);
  replyingToRef.current  = replyingTo;
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [actionSheetMsg,   setActionSheetMsg]   = useState<Message | null>(null);
  // Edit mode - null when not editing. ChatInput consumes this via `editing`.
  const [editingMsg,       setEditingMsg]       = useState<{ id: string; content: string } | null>(null);
  // Guest self-mention: when an online guest is @mentioned by someone else, give
  // a real-time in-app signal (highlight + discreet signup nudge). No push.
  const [mentionNudge,     setMentionNudge]     = useState(false);
  const seenMsgIdsRef      = useRef<Set<string>>(new Set());
  const mentionInitedRef   = useRef(false);

  // Reset the self-mention tracking when switching cities.
  useEffect(() => { mentionInitedRef.current = false; seenMsgIdsRef.current = new Set(); }, [channelId]);

  // Watch for a fresh incoming message that @mentions me (a live guest). On the
  // first pass we just seed the seen-set so message history doesn't nudge. Guests
  // only - members are handled by the existing push path.
  useEffect(() => {
    if (!mentionInitedRef.current) {
      for (const m of messages) if (m.id) seenMsgIdsRef.current.add(m.id);
      mentionInitedRef.current = true;
      return;
    }
    if (account) return;
    const myGuestId = identity?.guestId;
    if (!myGuestId) return;
    for (const m of messages) {
      if (!m.id || seenMsgIdsRef.current.has(m.id)) continue;
      seenMsgIdsRef.current.add(m.id);
      const mine = m.guestId === myGuestId;
      if (!mine && Array.isArray(m.mentions) && m.mentions.some(x => x.guestId === myGuestId)) {
        setHighlightedMsgId(m.id);
        setTimeout(() => setHighlightedMsgId(null), 2500);
        setMentionNudge(true);
        setTimeout(() => setMentionNudge(false), 7000);
      }
    }
  }, [messages, account, identity]);

  function realMessageCount() {
    return messagesRef.current.filter(m => m.type === 'text' || m.type === 'image').length;
  }

  function scheduleActivity(isFirst = false) {
    if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
    const delay = isFirst ? 30_000 : 60_000 + Math.random() * 60_000;
    activityTimerRef.current = setTimeout(() => {
      if (!isActiveRef.current) return;
      if (realMessageCount() < 3) {
        const ambient = i18n.t('ambient', { ns: 'chat', returnObjects: true }) as string[];
        const text = ambient[Math.floor(Math.random() * ambient.length)];
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
        subtype: 'explore', content: i18n.t('promptExplore', { ns: 'chat' }), cta: i18n.t('promptExploreCta', { ns: 'chat' }),
        nickname: '', createdAt: Date.now() / 1000,
      }]);
    }, 15_000);

    const t2 = setTimeout(() => {
      if (!isActiveRef.current || promptsShownRef.current.has('photo')) return;
      if (realMessageCount() >= 3) return;
      promptsShownRef.current.add('photo');
      setPromptItems(prev => [...prev, {
        id: `prompt-photo-${Date.now()}`, type: 'prompt' as const,
        subtype: 'photo', content: i18n.t('promptPhoto', { ns: 'chat' }), cta: i18n.t('promptPhotoCta', { ns: 'chat' }),
        nickname: '', createdAt: Date.now() / 1000,
      }]);
    }, 30_000);

    const t3 = setTimeout(() => {
      if (!isActiveRef.current || promptsShownRef.current.has('create-event')) return;
      if (realMessageCount() >= 3) return;
      promptsShownRef.current.add('create-event');
      setPromptItems(prev => [...prev, {
        id: `prompt-create-${Date.now()}`, type: 'prompt' as const,
        subtype: 'create-event', content: i18n.t('promptCreate', { ns: 'chat' }), cta: i18n.t('promptCreateCta', { ns: 'chat' }),
        nickname: '', createdAt: Date.now() / 1000,
      }]);
    }, 60_000);

    // challenge-intro: 8s, drops a "Learn how challenges work" pill once per
    // channel session. Independent of message count - the goal is to surface
    // the explainer for newcomers, even in a chatty city. Tapping it opens
    // the ChallengeIntroCarousel.
    const t4 = setTimeout(() => {
      if (!isActiveRef.current || promptsShownRef.current.has('challenge-intro')) return;
      promptsShownRef.current.add('challenge-intro');
      setPromptItems(prev => [...prev, {
        id: `prompt-challenge-intro-${Date.now()}`, type: 'prompt' as const,
        subtype: 'challenge-intro',
        content: i18n.t('promptChallengeIntro', { ns: 'chat' }),
        cta:     i18n.t('promptChallengeIntroCta', { ns: 'chat' }),
        nickname: '', createdAt: Date.now() / 1000,
      }]);
    }, 8_000);

    promptTimersRef.current.push(t1, t2, t3, t4);
  }

  // A reminder card finished fading (mount-guarded on the card) → drop it from
  // the feed and pulse the NOW tab once. Removal alone reflows the list - no
  // LayoutAnimation (unreliable on an inverted, virtualized list) and no animated
  // height collapse (it crashed when the cell was removed mid-animation); a tiny
  // non-animated reflow is the safe trade. The id lives in exactly one of the
  // three arrays; filtering all three is harmless + simple.
  function handleAutoDismiss(id: string) {
    // Only the chat prompts (e.g. "Learn how challenges work") still
    // ride the in-feed auto-dismiss path. The event / hangout /
    // challenge pills are no longer rendered inline - they're folded
    // into the single persistent activity counter above the FlatList -
    // so dismissal there is moot. pulseNow() was the NOW tab's bump
    // animation; both the pulse and its driver are gone.
    setPromptItems(prev => prev.some(p => p.id === id) ? prev.filter(p => p.id !== id) : prev);
  }

  async function handlePromptCta(subtype: string) {
    setPromptItems(prev => prev.filter(p => p.subtype !== subtype));
    if (subtype === 'photo') {
      pickImageRef.current?.();
    } else if (subtype === 'create-event') {
      // Preflight the 1-event-per-day rule; fall through to the form on
      // transient failure (server still enforces on POST).
      try {
        if (city) {
          const r = await fetchCanCreateEvent(city.channelId, identity?.guestId);
          if (!r.canCreate) { router.push('/event/limit-reached' as never); return; }
        }
      } catch { /* fall through */ }
      router.push('/event/create');
    } else if (subtype === 'explore') {
      router.push('/(tabs)/events');
    } else if (subtype === 'challenge-intro') {
      setShowChallengeIntro(true);
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

  // Weather - extracted from messages for header display, not rendered in the feed.
  const weatherLabel = useMemo<string | null>(() => {
    const w = messages.find(m => m.type === 'system' && m.event === 'weather');
    return localizeWeather(w?.content, city?.name);
  }, [messages, city?.name, i18n.language]);

  // Weather pill marquee gating: scroll only while this tab is focused AND the
  // app is foregrounded (battery), and never under OS reduce-motion.
  const isFocused    = useIsFocused();
  const reduceMotion = useReducedMotion();
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  const weatherActive = isFocused && appActive;

  // Arrivals - extracted from the same `messages` stream and shown in the
  // dedicated ArrivalsBar / ArrivalsSheet, NOT in the main feed. Newest-first
  // to match the sheet's display order.
  const arrivals = useMemo<Message[]>(
    () => messages.filter(m => m.type === 'system' && m.event === 'join'),
    [messages],
  );
  const [arrivalsSheetOpen, setArrivalsSheetOpen] = useState(false);

  // Unified feed - weather, joins, AND city-activity pills excluded.
  // Weather renders in the header; joins render in the ArrivalsBar; the
  // events / hangouts / challenges that used to appear-and-disappear as
  // inline cards are now folded into a single persistent count pill
  // above the feed (see CityActivityCountPill below). Tapping that pill
  // navigates to /(tabs)/now where the full lists live.
  //
  // Sorted newest-first for the inverted FlatList:
  //   index 0 = bottom of screen (newest message, near input)
  //   high index = top of screen (oldest, user scrolls up)
  const allMessages = useMemo<Message[]>(() => {
    const chat = messages.filter(m =>
      !(m.type === 'system' && (m.event === 'weather' || m.event === 'join'))
    );
    return [...chat, ...promptItems]
      .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
  }, [messages, promptItems]);

  // Counts that feed the persistent activity pills. Pulled from the
  // same state arrays we used to inject pills into the feed - we keep
  // the fetches + WS handlers untouched so the counters tick up in
  // real time when a new event / challenge lands. Hangouts (topics)
  // continue to be tracked for the NOW screen but no longer have a
  // dedicated city-chat pill (per spec - only events + challenges
  // got the split treatment).

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
    // (undefined at runtime). We only block local/optimistic placeholders -
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

  // Owner check mirrors backend MessageRepository::findOwned: a registered
  // user owns by userId, a guest owns by guestId.
  const isOwnMessage = useCallback((msg: Message): boolean => {
    if (account?.id && msg.userId === account.id) return true;
    if (identity?.guestId && msg.guestId === identity.guestId) return true;
    return false;
  }, [account, identity]);

  const handleEdit = useCallback((msg: Message) => {
    if (!msg.id || !msg.content) return;
    setReplyingTo(null);  // edit and reply are mutually exclusive
    setEditingMsg({ id: msg.id, content: msg.content });
  }, []);

  const submitEdit = useCallback(async (text: string) => {
    if (!editingMsg) return;
    const id = editingMsg.id;
    setEditingMsg(null);  // close banner immediately - optimistic patch already in flight
    try {
      await editMessage(id, text);
    } catch (e) {
      console.warn('[chat] edit failed:', e);
      Alert.alert(t('editFailed'));
    }
  }, [editingMsg, editMessage, t]);

  const handleDelete = useCallback((msg: Message) => {
    if (!msg.id) return;
    Alert.alert(
      t('deleteConfirmTitle'),
      t('deleteConfirmBody'),
      [
        { text: t('deleteConfirmCancel'), style: 'cancel' },
        {
          text:    t('deleteConfirmCta'),
          style:   'destructive',
          onPress: async () => {
            try { await deleteMessage(msg.id!); }
            catch (e) { console.warn('[chat] delete failed:', e); Alert.alert(t('deleteFailed')); }
          },
        },
      ],
    );
  }, [deleteMessage, t]);

  // Wraps useMessages sendText to inject the current replyingTo before clearing it.
  const handleSendText = useCallback((text: string, mentions?: MentionRef[]) => {
    const reply = replyingToRef.current;
    setReplyingTo(null);
    sendText(text, reply, mentions);
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

  // No city yet - prompt to pick one
  if (!city) {
    return (
      <SafeAreaView style={[styles.container, { paddingBottom: 0 }]}>
        <View style={styles.noCityWrap}>
          <Text style={styles.noCityTitle}>{t('noCityTitle')}</Text>
          <Text style={styles.noCitySubtitle}>{t('noCitySub')}</Text>
          <TouchableOpacity
            style={styles.citiesBtn}
            onPress={() => router.push('/switch-city' as never)}
            activeOpacity={0.8}
          >
            <Text style={styles.citiesBtnText}>{t('browseCities')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const flag = cityFlag(city.country);

  return (
    <SafeAreaView style={[styles.container, { paddingBottom: 0 }]} edges={['top']}>

      {/* ── Header - 3-section redesign ── */}
      <View style={styles.header}>

        {/* ── Section 1: App header - persistent across all 4 tabs ── */}
        {/* Share lives here (MY-CITY-only) as a tab-specific extra. */}
        <AppHeader
          rightExtra={city && (
            <TouchableOpacity
              style={styles.iconBtn}
              activeOpacity={0.65}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              onPress={async () => {
                // Locale-prefixed URL (Option A) so the link preview (OG tags -
                // all Android shares show) renders in the sharer's language.
                const url     = buildCityUrl(city.slug);
                const title   = t('shareTitle', { city: localizeCityName(city.name) });
                const message = t('shareMessage', { city: localizeCityName(city.name) });
                await shareLink({ title, message, url });
              }}
              accessibilityLabel={t('shareCity')}
            >
              <Feather name="share" size={20} color={Colors.text} />
            </TouchableOpacity>
          )}
        />

        {/* ── Section 2: City hero name - tappable → switch city ── */}
        <TouchableOpacity
          style={styles.cityHeroRow}
          onPress={() => router.push('/switch-city' as never)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('changeCity')}
        >
          {/* Left spacer balances the right chevron so the name stays centered. */}
          <View style={styles.cityHeroSpacer} />
          <Text style={styles.cityHeroName} numberOfLines={2}>
            {flag ? `${flag} ` : ''}{localizeCityName(city.name)}
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
              // Under reduce-motion the text is static + truncated, so make the
              // pill reveal the full message on tap. (No marquee in that mode.)
              onPress={() => { if (reduceMotion) Alert.alert(t('weatherAlert'), weatherLabel); }}
              accessibilityLabel={t('currentWeather', { label: weatherLabel })}
              accessibilityRole="button"
            >
              <Ionicons name="cloud-outline" size={13} color="rgba(255,255,255,0.45)" />
              <MarqueeText
                text={weatherLabel}
                textStyle={styles.chipWeatherText}
                style={styles.chipWeatherMarquee}
                fadeColor="#1a1a1a"
                active={weatherActive}
                reduceMotion={reduceMotion}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.chip, styles.chipOnline]}
            activeOpacity={0.75}
            onPress={() => router.push('/(tabs)/here' as never)}
            accessibilityLabel={t('onlineAria', { count: onlineCount ?? 0 })}
            accessibilityRole="button"
          >
            <ChipLiveDot />
            <Text style={styles.chipOnlineText}>
              {onlineCount != null ? t('online', { count: onlineCount }) : t('liveNow')}
            </Text>
          </TouchableOpacity>

          {account && (
          <TouchableOpacity
            style={[styles.chip, styles.chipLeaderboard]}
            activeOpacity={0.75}
            onPress={() => router.push('/leaderboard' as never)}
            accessibilityRole="button"
            accessibilityLabel={
              myCityRank
                ? t('leaderboard.chip.ranked', { rank: myCityRank, ns: 'challenge' })
                : t('leaderboard.chip.neutral', { ns: 'challenge' })
            }
          >
            <Text style={styles.chipLeaderboardText}>
              {myCityRank === null
                ? t('leaderboard.chip.neutral', { ns: 'challenge' })
                : myCityRank > 99
                  ? t('leaderboard.chip.rankedOver', { ns: 'challenge' })
                  : t('leaderboard.chip.ranked', { rank: myCityRank, ns: 'challenge' })}
            </Text>
          </TouchableOpacity>
          )}
        </View>

      </View>

      {/* Arrivals strip - extracted from the main feed so real messages
          aren't drowned out by ambient "X just landed" rows. Default shows a
          neutral label; on a new arrival it morphs in-place for 3s. */}
      {/* Recent arrivals, with a "Hi now" pill (active hangouts) to its right
          when there's at least one. No hangouts → arrivals bar fills the line. */}
      <View style={styles.arrivalsRow}>
        <ArrivalsBar arrivals={arrivals} onOpenSheet={() => setArrivalsSheetOpen(true)} style={styles.arrivalsBarInline} />
        {topicFeedItems.length > 0 && (
          <TouchableOpacity
            style={styles.hiNowPill}
            onPress={() => router.push('/(tabs)/events' as never)}
            activeOpacity={0.75}
            accessibilityRole="button"
          >
            <Text style={styles.hiNowPillText} numberOfLines={1}>🗣️ {topicFeedItems.length} Hi now</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Single persistent activity pill - replaces the ephemeral event /
          hangout / challenge cards that used to flicker through the feed.
          Stays visible at the top of the chat for the lifetime of this
          city; taps land the user on /(tabs)/now where the full lists
          live. Hidden when there's literally nothing happening so it
          doesn't read as "0 / 0 / 0" to a quiet-city visitor. */}
      {/* Activity pills - one per content type. Tapping each routes to
          /(tabs)/now with a ?filter= param so the NOW screen opens
          pre-filtered to that type. Hidden when zero of that type so
          each row only appears when there's something to show. */}
      {(challengeFeedItems.length + eventFeedItems.length) > 0 && (
        <View style={styles.activityPillRow}>
          {challengeFeedItems.length > 0 && (
            <TouchableOpacity
              style={[styles.activityPill, styles.activityPillHalf]}
              onPress={() => router.push('/(tabs)/challenges' as never)}
              activeOpacity={0.75}
              accessibilityRole="button"
            >
              <Text style={styles.activityPillText} numberOfLines={1}>
                {i18n.t('cityActivity.challenges', {
                  ns: 'chat', count: challengeFeedItems.length,
                  defaultValue_one: '🔥 {{count}} challenge',
                  defaultValue: '🔥 {{count}} challenges',
                })}
              </Text>
              <Text style={styles.activityPillCta} numberOfLines={1}>→</Text>
            </TouchableOpacity>
          )}
          {eventFeedItems.length > 0 && (
            <TouchableOpacity
              style={[styles.activityPill, styles.activityPillHalf]}
              onPress={() => router.push('/(tabs)/events' as never)}
              activeOpacity={0.75}
              accessibilityRole="button"
            >
              <Text style={styles.activityPillText} numberOfLines={1}>
                🎉 {eventFeedItems.length} {eventFeedItems.length === 1 ? 'Hi local' : 'Hi locals'}
              </Text>
              <Text style={styles.activityPillCta} numberOfLines={1}>→</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Error banner */}
      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8}>
          <Text style={styles.errorBannerText}>{t('dismissHint', { error })}</Text>
        </TouchableOpacity>
      )}

      {/* ── Messages - web: .messages ── */}
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
            keyExtractor={(m, idx) => m.id ?? m.localId ?? (m.guestId || m.createdAt ? `${m.guestId ?? ''}:${m.createdAt ?? ''}` : String(idx))}
            // Reply-quote taps call scrollToIndex on the parent message; on iOS
            // that throws (crashing JS) if the target is currently virtualized
            // off-screen. Silent no-op matches the other surfaces (city-chat,
            // dm, event): no crash, no jump if the message isn't laid out.
            onScrollToIndexFailed={() => {}}
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
              // showTime: last (newest) message in a sender run - newerMsg differs or absent
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
                  autoDismiss={
                    item.type === 'event'
                    || item.type === 'topic'
                    || item.type === 'challenge'
                    || item.type === 'challenge_validated'
                    || item.type === 'prompt'
                    || item.type === 'activity'
                  }
                  onAutoDismiss={handleAutoDismiss}
                  reduceMotion={reduceMotion}
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
              ) : (!hasMore && !loading && messages.length > 0) ? (
                <View style={styles.loadingOlderWrap}>
                  <Text style={styles.beginningText}>{t('beginning')}</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyIcon}>🔥</Text>
                <Text style={styles.emptyTitle}>{t('emptyTitle')}</Text>
                <Text style={styles.emptySub}>{t('emptySub')}</Text>
              </View>
            }
          />
        )}

        {/* ── Ephemeral event banners - slide in above input, auto-dismissed ── */}
        {eventBanners.map(banner => (
          <EventBannerStrip
            key={banner.id}
            title={banner.title}
            eventId={banner.id}
            onDismiss={() => dismissBanner(banner.id)}
          />
        ))}

        {/* ── Guest @mention nudge - discreet, non-blocking signup prompt ── */}
        {mentionNudge && !account && (
          <View style={styles.mentionNudge}>
            <Text style={styles.mentionNudgeText} numberOfLines={2}>
              👀 You're getting mentioned! Create an account so you never miss it.
            </Text>
            <TouchableOpacity
              style={styles.mentionNudgeBtn}
              onPress={() => { setMentionNudge(false); router.push('/auth-gate'); }}
              activeOpacity={0.85}
            >
              <Text style={styles.mentionNudgeBtnText}>Sign up</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMentionNudge(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.mentionNudgeDismiss}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Typing indicator bar ── */}
        {typingLabel && (
          <View style={styles.typingBar}>
            <Text style={styles.typingText}>{typingLabel}</Text>
          </View>
        )}

        {/* ── Input - web: .input-bar ── */}
        <ChatInput
          sending={sending}
          mentionContext="city"
          mentionChannelId={channelId}
          onSendText={handleSendText}
          onSendImage={sendImage}
          placeholder={i18n.t('composer.placeholderCity', { ns: 'common' })}
          pickImageRef={pickImageRef}
          onTypingStart={handleTypingStart}
          onTypingStop={handleTypingStop}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          editing={editingMsg}
          onSubmitEdit={submitEdit}
          onCancelEdit={() => setEditingMsg(null)}
        />
      </KeyboardAvoidingView>

      <MessageActionSheet
        visible={actionSheetMsg !== null}
        reactions={actionSheetMsg?.reactions ?? []}
        onReact={emoji => { if (actionSheetMsg) handleReact(actionSheetMsg, emoji); }}
        onReply={actionSheetMsg ? () => handleReply(actionSheetMsg) : undefined}
        onCopy={actionSheetMsg?.content ? () => { Clipboard.setStringAsync(actionSheetMsg.content!).catch(() => {}); } : undefined}
        // Edit is text-only (no image/location edits); Delete works for any owned bubble.
        onEdit={actionSheetMsg && isOwnMessage(actionSheetMsg) && actionSheetMsg.type === 'text' && !actionSheetMsg.deletedAt && actionSheetMsg.content && !actionSheetMsg.content.startsWith('📍')
          ? () => handleEdit(actionSheetMsg) : undefined}
        onDelete={actionSheetMsg && isOwnMessage(actionSheetMsg) && !actionSheetMsg.deletedAt
          ? () => handleDelete(actionSheetMsg) : undefined}
        onClose={() => setActionSheetMsg(null)}
      />

      {/* "How challenges work" carousel - opened from the challenge-intro
          feed prompt. Stand-alone modal; doesn't interact with onboarding.
          Last-slide CTA closes the carousel and routes to /challenge/create
          so a user who just learned the rules can launch their first
          challenge without backtracking through the city chat. */}
      <ChallengeIntroCarousel
        visible={showChallengeIntro}
        onClose={() => setShowChallengeIntro(false)}
        onCreateChallenge={() => {
          setShowChallengeIntro(false);
          router.push('/challenge/create' as never);
        }}
      />

      <ArrivalsSheet
        visible={arrivalsSheetOpen}
        arrivals={arrivals}
        onClose={() => setArrivalsSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex:      { flex: 1 },

  // ── Header container ───────────────────────────────────────────────────────
  // The orange halo around the logo used to live here; it now lives inside
  // AppHeader's own glowWrap so every tab consuming AppHeader gets it
  // consistently (no more drift between MY CITY and NOW/HERE/ME).
  header: {
    flexDirection:     'column',
    gap:               14,
    paddingTop:        14,
    paddingBottom:     16,
    paddingHorizontal: 16,
    backgroundColor:   Colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
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

  // Icon buttons - must match AppHeader's iconBtn: flat, 40×40, radius 12.
  // Only used here for the Share button passed in via AppHeader's rightExtra
  // slot. No background / border so Share is visually consistent with the
  // flat bell + DM icons rendered by AppHeader itself.
  iconBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
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
    // Narrow enough to force "Become local. Anywhere." onto separate lines
    maxWidth:      72,
  },

  // ── Logo glow - web: .chat-header .logo svg { drop-shadow orange } ─────────
  iconGlow: {
    shadowColor:   '#C24A38',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius:  14,
    elevation:     10,
  },

  // ── Section 2: City hero name ─────────────────────────────────────────────
  cityHeroRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 12,
  },
  // The name takes a DEFINITE width (flex:1) rather than letting RN infer it
  // from the text's intrinsic size inside a centered row. That inference was
  // unreliable per-platform - a too-narrow width forced the name to wrap and
  // the clipped 2nd line read as a dropped last word ("New York"→"New",
  // "Ho Chi Minh City"→"Ho Chi Minh", "Bangkok"→empty). With flex:1 the Text
  // gets the real available width on both iOS and Android, so it renders on one
  // line. The left spacer (cityHeroSpacer) mirrors the chevron's width so the
  // centered text stays visually centered in the header.
  cityHeroName: {
    flex:          1,
    fontSize:      24,
    fontWeight:    '500',
    color:         Colors.text,
    lineHeight:    29,
    letterSpacing: -0.3,
    textAlign:     'center',
  },
  cityHeroSpacer: {
    width: 24,   // = chevron (18) + its marginLeft (6); keeps the name centered
  },
  cityHeroChevron: {
    marginTop:  2,   // visually align with the text x-height, not its box
    marginLeft: 6,
  },

  // ── Section 3: Context chips ───────────────────────────────────────────────
  // Single-row layout. Weather chip shrinks + truncates when copy is long
  // ("Light drizzle · 36°C, grab a jacket"); activity chip stays fixed-size.
  chipsRow: {
    flexDirection:  'row',
    gap:            8,
    justifyContent: 'center',
    alignItems:     'center',
    minWidth:       0,
  },
  chip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    paddingVertical:   7,
    paddingHorizontal: 13,
    borderRadius:      999,
    borderWidth:       1,
    minWidth:          0,
  },
  chipWeather: {
    backgroundColor: '#1a1a1a',
    borderColor:     'rgba(255,255,255,0.08)',
    flexShrink:      1,    // weather copy can be long; let it truncate
  },
  chipWeatherText: {
    // Was 12pt at rgba(255,255,255,0.45) (~4.0:1) - failed WCAG AA at body
    // size. Bumped to xs (13pt) and routed through the theme token.
    fontSize:   FontSizes.xs,
    fontWeight: '500',
    color:      Colors.muted,
    flexShrink: 1,
  },
  // Marquee clip window - shrinks to share the row, clips/scrolls long copy.
  chipWeatherMarquee: {
    flexShrink: 1,
  },
  chipOnline: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor:     'rgba(239,68,68,0.28)',
    flexShrink:      0,    // activity chip never shrinks
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
  // Leaderboard chip - amber/orange tint, distinct from online (red) and
  // weather (grey) so it reads at a glance as the "scoring/rank" affordance.
  chipLeaderboard: {
    backgroundColor: 'rgba(255,201,60,0.12)',
    borderColor:     'rgba(255,201,60,0.32)',
    flexShrink:      0,
  },
  chipLeaderboardText: {
    fontSize:   12,
    fontWeight: '700',
    color:      '#FFC93C',
  },

  // ── Error banner ─────────────────────────────────────────────────────────
  errorBanner:     { backgroundColor: Colors.red, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  errorBannerText: { color: Colors.white, fontSize: FontSizes.xs, textAlign: 'center' },

  // Persistent city-activity counters - one row, up to two pills (one
  // per content type). Each is tappable and routes to NOW with a
  // pre-applied filter. Visual echoes the "Learn how challenges work"
  // banner inside the challenge channel so the two surfaces feel like
  // siblings (warm dark fill, faint orange ring, orange CTA on the right).
  // Recent arrivals + optional "Hi now" pill share one line.
  arrivalsRow:       { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginHorizontal: Spacing.md },
  arrivalsBarInline: { marginHorizontal: 0, flex: 1 },
  hiNowPill: {
    justifyContent:    'center',
    paddingHorizontal: 12,
    borderRadius:      10,
    backgroundColor:   'rgba(255,122,60,0.10)',
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.30)',
  },
  hiNowPillText: { color: Colors.accent, fontWeight: '700', fontSize: 13 },

  activityPillRow: {
    flexDirection:    'row',
    gap:              8,
    marginHorizontal: Spacing.md,
    marginTop:        Spacing.xs,
    marginBottom:     Spacing.xs,
  },
  activityPillHalf: {
    flex: 1,
    marginHorizontal: 0,
    marginTop:        0,
    marginBottom:     0,
  },
  activityPill: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    gap:               8,
    paddingVertical:   8,
    paddingHorizontal: 12,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.md,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.30)',
  },
  activityPillText: {
    flex:       1,
    color:      Colors.text,
    fontSize:   FontSizes.sm,
    fontWeight: '600',
  },
  activityPillCta: {
    color:      Colors.accent,
    fontSize:   FontSizes.sm,
    fontWeight: '700',
  },

  // ── Typing indicator bar ──────────────────────────────────────────────────
  // Sits between messages and input. Subtle - just a dim text label.
  typingBar: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   6,
  },
  typingText: {
    fontSize:   FontSizes.xs,
    color:      Colors.muted,
    fontStyle:  'italic',
  },
  mentionNudge: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    marginHorizontal:  Spacing.md,
    marginBottom:      6,
    paddingHorizontal: 12,
    paddingVertical:   10,
    borderRadius:      14,
    backgroundColor:   'rgba(139,92,246,0.14)',
    borderWidth:       1,
    borderColor:       'rgba(139,92,246,0.45)',
  },
  mentionNudgeText:    { flex: 1, fontSize: FontSizes.sm, color: Colors.text, lineHeight: 18 },
  mentionNudgeBtn:     { backgroundColor: '#8B5CF6', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  mentionNudgeBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSizes.sm },
  mentionNudgeDismiss: { color: Colors.muted, fontSize: 14, paddingHorizontal: 2 },

  // ── Messages ─────────────────────────────────────────────────────────────
  // web: .messages { padding: 22px 18px 14px; gap: 8px }
  listContent: {
    paddingTop:    28,
    paddingBottom: 18,
  },

  // ── Empty state - web: .empty ─────────────────────────────────────────────
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
  beginningText: { fontSize: FontSizes.xs, color: Colors.muted2 },

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
