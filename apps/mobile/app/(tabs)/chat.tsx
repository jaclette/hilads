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
  StyleSheet, KeyboardAvoidingView, Keyboard, Platform,
  TouchableOpacity, Animated, Alert,
} from 'react-native';
import { thumbUrl } from '@/lib/imageThumb';
import { formatSmartTime } from '@/lib/messageTime';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { consumeCityFeedRefresh } from '@/lib/cityFeedRefresh';
import { consumeWorldScopeOpen } from '@/lib/worldScopeOpen';
import { useScope } from '@/context/ScopeContext';
import { PeopleRow } from '@/features/chat/PeopleRow';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { localizeCityName, shortCityName } from '@/i18n/cityName';
import { useMessages } from '@/hooks/useMessages';
import { fetchMessages, sendMessage, sendImageMessage, toggleChannelReaction } from '@/api/channels';
import { fetchWorldMessages, sendWorldMessage, toggleWorldReaction, fetchWorldArrivals, markChannelRead, fetchUnread, fetchQuietContext, type WorldArrival } from '@/api/world';
import { fetchCityEvents, fetchCanCreateEvent } from '@/api/events';
import type { HiladsEvent } from '@/types';
import { socket } from '@/lib/socket';
import { track } from '@/services/analytics';
import { reactionEmitter, EMOJI_TO_TYPE } from '@/lib/reactionEmitter';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput } from '@/features/chat/ChatInput';
import { MessageActionSheet } from '@/features/chat/MessageActionSheet';
import { ArrivalsSheet } from '@/features/chat/ArrivalsSheet';
import * as Clipboard from 'expo-clipboard';
import { DailyPinBar } from '@/features/daily/DailyPinBar';
import { useDailyToday } from '@/hooks/useDaily';
import { isDailyCard } from '@/lib/dailyEvents';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Border, FontSizes, Spacing, Radius, buildCityUrl, type ThemeColors } from '@/constants';
import { Avatar, Banner, Button, EmptyState, IconButton, ListRow, Screen, ScreenHeader, SectionTitle, Segmented, Sheet } from '@/ui';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { isSameDay, formatDateLabel, toMs } from '@/lib/messageTime';
import { shareLink } from '@/lib/shareLink';
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
  const styles  = useThemedStyles(makeStyles);
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
    <Animated.View style={[styles.notice, { opacity }]}>
      <Banner icon="calendar-outline" text={t('bannerNewEvent', { title })} action={{ label: t('join'), onPress: handleJoin }}
              onClose={onDismiss} closeLabel={t('close', { ns: 'common' })} />
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


// ── Screen ────────────────────────────────────────────────────────────────────
// Tab bar is in-flow (flex-column sibling), so the screen content area ends
// exactly at the tab bar top. No paddingBottom needed on the SafeAreaView.
// ChatInput uses elevation: 30 to render above the tab bar's upward shadow.

export default function ChatTab() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t, i18n } = useTranslation('chat');
  const {
    city, identity, sessionId, account,
    unreadDMs, setUnreadDMs,
    clearEventChatCounts,
    bootstrapData,
  } = useApp();
  const nickname = account?.display_name ?? identity?.nickname ?? '';

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

  // ── World channel (global companion channel) ──
  // channelScope toggles the FEED between the city and the global World channel.
  // City presence/typing stay on the city (channelId unchanged); World is an
  // overlay feed on activeChannelId. Unread badges are symmetric.
  // App-wide scope (header selector, SPEC 9.1): shared with Today and Map.
  const { scope: channelScope, setScope: setChannelScope } = useScope();
  const [worldUnread,  setWorldUnread]  = useState(0);
  const [cityUnread,   setCityUnread]   = useState(0);
  // Total city members - gates the header pill: with <2 nearby we show a
  // "N members" pill instead, and hide it entirely for empty cities (<2 members).
  const [worldArrivals, setWorldArrivals] = useState<WorldArrival[]>([]);
  const [showWorldArrivals, setShowWorldArrivals] = useState(false);
  const [quietCardOpen, setQuietCardOpen] = useState(false);
  const quietCardDismissed = useRef(false);
  const didAutoWorld = useRef(false);
  const activeChannelId = channelScope === 'world' ? 'world' : channelId;
  // Today's Daily Challenge: one fetch shared by the city hero card, the World
  // pin and the live-city flag (which channel opens first, twists on cards).
  const daily = useDailyToday(city?.channelId);
  const dailyLive = !!daily.data?.city?.isLive;

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

  // While the keyboard is up, collapse the top chrome (header + city row +
  // challenges hero + secondary pills) so the conversation gets full height -
  // only the feed and the composer remain. iOS gets the smoother will* events.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvt, () => setKeyboardUp(true));
    const onHide = Keyboard.addListener(hideEvt, () => setKeyboardUp(false));
    return () => { onShow.remove(); onHide.remove(); };
  }, []);

  const loadFn = useCallback(
    (opts?: { beforeId?: string }) =>
      channelScope === 'world' ? fetchWorldMessages(opts) : fetchMessages(channelId, opts),
    [channelId, channelScope],
  );

  const postTextFn = useCallback(
    (content: string, replyToId?: string | null, mentions?: MentionRef[]): Promise<Message> => {
      if (!identity || !sessionId) return Promise.reject(new Error('Not ready'));
      if (channelScope === 'world') return sendWorldMessage(identity.guestId, nickname, content, mentions, replyToId);
      return sendMessage(channelId, sessionId, identity.guestId, nickname, content, replyToId, mentions);
    },
    [channelId, channelScope, identity, sessionId, nickname],
  );

  const postImageFn = useCallback(
    (imageUrl: string): Promise<Message> => {
      if (!identity || !sessionId) return Promise.reject(new Error('Not ready'));
      return sendImageMessage(channelId, sessionId, identity.guestId, nickname, imageUrl);
    },
    [channelId, identity, sessionId, nickname],
  );

  // Use pre-loaded data from the bootstrap endpoint if available for the current channel.
  // Only for the city scope - World has no bootstrap payload.
  const chatBootstrap = channelScope === 'city' && bootstrapData?.channelId === channelId ? bootstrapData : undefined;

  const { messages, loading, loadingOlder, hasMore, sending, error, clearError, sendText, sendImage, loadOlder, setMessageReactions, editMessage, deleteMessage, reload } = useMessages({
    channelId: activeChannelId,
    loadFn,
    postTextFn,
    postImageFn,
    initialData: chatBootstrap ? { messages: chatBootstrap.messages, hasMore: chatBootstrap.hasMore } : undefined,
  });

  // Toggle the feed between the city and the global World channel. The scope is
  // app-wide (header selector too), so what entering a scope does runs in the
  // effect below, whoever switched it.
  const switchScope = useCallback((scope: 'city' | 'world') => {
    setChannelScope(scope);
  }, [setChannelScope]);
  const firstScope = useRef(true);
  useEffect(() => {
    if (firstScope.current) { firstScope.current = false; return; }
    const scope = channelScope;
    if (scope === 'world') {
      track('world_channel_viewed');
      setWorldUnread(0);
      fetchWorldArrivals().then(setWorldArrivals).catch(() => {});
      if (identity?.guestId) markChannelRead('world', identity.guestId);
    } else {
      setCityUnread(0);
      if (identity?.guestId && channelId) markChannelRead(channelId, identity.guestId);
    }
  }, [channelScope]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-enter the World channel on open for every city that is NOT live: a
  // live city (cities.force_live, from the Daily Challenge "today" call) has a
  // local layer worth landing in. Fires once per session, as soon as the
  // resolved city and its live flag are known (World if that call fails).
  useEffect(() => {
    if (didAutoWorld.current || !city?.name || !identity?.guestId) return;
    if (!daily.data && !daily.error) return; // wait for the live flag
    didAutoWorld.current = true;
    if (daily.data?.city?.isLive) return;
    switchScope('world');
  }, [city?.name, identity?.guestId, switchScope, daily.data, daily.error]);

  // Keep World pills (online / arrivals) fresh - the aggregate is server-cached,
  // so a single fetch on entry can be stale. Re-poll every 30s while viewing World.
  useEffect(() => {
    if (channelScope !== 'world') return;
    const id = setInterval(() => {
      fetchWorldArrivals().then(setWorldArrivals).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [channelScope]);

  // Join the World room on mount (additive - keeps the city room) + seed badges.
  useEffect(() => {
    if (!sessionId || !identity?.guestId || !channelId) return;
    socket.joinWorld(sessionId);
    fetchUnread([channelId, 'world'], identity.guestId).then(u => {
      setCityUnread(Math.min(u[String(channelId)] ?? 0, 999));
      setWorldUnread(Math.min(u.world ?? 0, 999));
    }).catch(() => {});
  }, [sessionId, identity?.guestId, channelId]);

  // Unread badge for the channel the user is NOT currently viewing (useMessages
  // handles the active one). Only while on the chat tab, which is where badges show.
  useEffect(() => {
    return socket.on('newMessage', (data: { channelId?: string | number; message?: Message }) => {
      const cid = String(data?.channelId ?? '');
      const m = data?.message;
      if (!m) return;
      const mine = (!!identity?.guestId && m.guestId === identity.guestId) || (!!account?.id && m.userId === account.id);
      // Broadcast DTOs omit `type` for plain text (set only for non-text); treat an
      // absent type as text or the World/City unread badges never bump for chat.
      const isChat = m.type == null || m.type === 'text' || m.type === 'image';
      if (!isChat || mine) return;
      if (cid === 'world' && channelScope !== 'world') setWorldUnread(u => Math.min(u + 1, 999));
      else if (channelScope === 'world' && (cid === String(channelId) || cid === `city_${channelId}`)) setCityUnread(u => Math.min(u + 1, 999));
    });
  }, [channelScope, channelId, identity?.guestId, account?.id]);

  // Quiet-city → World nudge (once per session): shown when this city is quiet
  // and World has unread activity and is itself lively (server-gated).
  useEffect(() => {
    if (channelScope !== 'city' || !channelId || quietCardDismissed.current || worldUnread <= 0) return;
    let cancelled = false;
    fetchQuietContext(channelId).then(ctx => {
      if (cancelled || quietCardDismissed.current) return;
      if (ctx.cityQuiet && ctx.worldActive) {
        setQuietCardOpen(true);
        track('quiet_city_card_shown', { city_id: channelId });
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [channelScope, channelId, worldUnread]);

  // After a "share to my city" from another screen, the message was posted
  // out-of-band so this already-mounted tab never saw it - reload on focus.
  useFocusEffect(
    useCallback(() => {
      if (consumeCityFeedRefresh()) {
        // A "share to my city" (from an event / challenge / topic) posted into the
        // CITY channel. The chat tab is persistent, so it may still be on World -
        // force CITY scope so the user lands on their own city, not World. Switching
        // scope reloads the city feed; if already on city, reload to show the new msg.
        if (channelScope !== 'city') switchScope('city');
        else reload();
      }
      // A World-channel mention push deep-links here - switch to World scope so
      // the user lands on the exact channel they were mentioned in.
      if (consumeWorldScopeOpen()) switchScope('world');
    }, [reload, switchScope, channelScope]),
  );

  // ── System feed prompts + ambient activity messages ────────────────────────
  // Mirrors web App.jsx schedulePrompts() + scheduleActivity().
  // Injected locally after join; never sent to the server.

  const [promptItems,    setPromptItems]    = useState<Message[]>([]);
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

    promptTimersRef.current.push(t1, t2, t3);
  }

  // A reminder card finished fading (mount-guarded on the card) → drop it from
  // the feed and pulse the NOW tab once. Removal alone reflows the list - no
  // LayoutAnimation (unreliable on an inverted, virtualized list) and no animated
  // height collapse (it crashed when the cell was removed mid-animation); a tiny
  // non-animated reflow is the safe trade. The id lives in exactly one of the
  // three arrays; filtering all three is harmless + simple.
  // useCallback so the memoized renderItem (and React.memo'd rows) stay stable
  // across the frequent presence/WS re-renders of this screen.
  const handleAutoDismiss = useCallback((id: string) => {
    // Only the chat prompts (e.g. "Learn how challenges work") still
    // ride the in-feed auto-dismiss path. The event / hangout /
    // challenge pills are no longer rendered inline - they're folded
    // into the single persistent activity counter above the FlatList -
    // so dismissal there is moot. pulseNow() was the NOW tab's bump
    // animation; both the pulse and its driver are gone.
    setPromptItems(prev => prev.some(p => p.id === id) ? prev.filter(p => p.id !== id) : prev);
  }, []);

  const handlePromptCta = useCallback(async (subtype: string) => {
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
    }
  }, [city, identity?.guestId, router]);

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

  const reduceMotion = useReducedMotion();

  // Arrivals - extracted from the same `messages` stream and shown in the
  // people row / ArrivalsSheet, NOT in the main feed. Newest-first
  // to match the sheet's display order.
  const arrivals = useMemo<Message[]>(
    () => messages.filter(m => m.type === 'system' && m.event === 'join'),
    [messages],
  );
  const [arrivalsSheetOpen, setArrivalsSheetOpen] = useState(false);

  // Unified feed - weather, joins, AND city-activity pills excluded.
  // Weather renders in the header; joins render in the people row; the
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
      // 'new_user' = World "X from City just joined" arrivals; the arrivals pill
      // already surfaces these, so keep them out of the conversation.
      !(m.type === 'system' && (m.event === 'weather' || m.event === 'join' || m.event === 'new_user'))
      // Deleted messages disappear from city and World (no "Message deleted"
      // placeholder; private conversations keep it).
      && !m.deletedAt
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
    if (idx < 0 || idx >= allMessages.length) return;
    // Highlight first so the parent flashes even if the scroll can't run.
    setHighlightedMsgId(id);
    setTimeout(() => setHighlightedMsgId(null), 1500);
    // scrollToIndex can THROW synchronously (the "scrollToIndex out of range"
    // invariant) - and that's NOT caught by onScrollToIndexFailed, so in a
    // release build it crashes the whole app. Wrap it. Off-screen-but-valid
    // targets still resolve via onScrollToIndexFailed (a no-op).
    try {
      flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
    } catch { /* not measured / transient out-of-range - highlight already applied */ }
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
    const isWorld = channelScope === 'world';
    if (type) {
      reactionEmitter.emit(msg.id, type);
      socket.sendReaction(type, msg.id, isWorld ? 'world' : String(channelId), account?.id ?? null);
    }
    try {
      const reactions = isWorld
        ? await toggleWorldReaction(msg.id, emoji, identity.guestId)
        : await toggleChannelReaction(String(channelId), msg.id, emoji, identity.guestId);
      setMessageReactions(msg.id, reactions);
    } catch (e) {
      console.warn('[chat] reaction failed:', e);
    }
  }, [channelId, channelScope, identity, account, setMessageReactions]);

  // Stable renderItem so a presence/WS re-render of this screen doesn't recreate
  // the row closure (which, with non-memoized rows, re-rendered the whole
  // visible list + re-ran linkify/mention regex per row). Deps exclude anything
  // that changes on a presence tick - only message-list / highlight / handler
  // changes recompute it.
  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
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
    const showTime =
      item.type !== 'system' && item.type !== 'event' && item.type !== 'topic' &&
      item.type !== 'activity' && item.type !== 'prompt' && (
        !newerMsg ||
        newerMsg.guestId !== item.guestId ||
        newerMsg.type === 'system'
      );
    // Anchor the date separator to the nearest OLDER item that actually has a
    // timestamp. Interleaved system/activity/prompt rows can lack one, and
    // isSameDay returns true when a side is absent - which suppressed the
    // separator and made a new-day message render under the PREVIOUS day's
    // header (e.g. a Jul 13 message shown under "Jul 9").
    let olderDated: Message | undefined;
    for (let j = index + 1; j < allMessages.length; j++) {
      if (toMs(allMessages[j].createdAt) > 0) { olderDated = allMessages[j]; break; }
    }
    const dateLabel =
      item.type !== 'event' && item.type !== 'topic' &&
      item.type !== 'activity' && item.type !== 'prompt' &&
      toMs(item.createdAt) > 0 &&
      (!olderDated || !isSameDay(item.createdAt, olderDated.createdAt))
        ? formatDateLabel(item.createdAt)
        : undefined;
    return (
      <ChatMessage
        message={item}
        myGuestId={identity?.guestId}
        worldScope={channelScope === 'world'}
        dailyLive={channelScope === 'city' && dailyLive}
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
  }, [allMessages, identity?.guestId, channelScope, dailyLive, highlightedMsgId, handlePromptCta,
      handleMessageLongPress, scrollToMessage, handleReact, handleAutoDismiss, reduceMotion]);

  // No city yet - prompt to pick one
  if (!city) {
    return (
      <Screen>
        <View style={styles.center}>
          <EmptyState icon="location-outline" title={t('noCityTitle')} body={t('noCitySub')}
                      action={<Button label={t('browseCities')} onPress={() => router.push('/switch-city' as never)} />} />
        </View>
      </Screen>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { paddingBottom: 0 }]} edges={['top']}>

      {/* ── Header - 3-section redesign. Hidden while typing so the
          conversation + composer get the full screen. ── */}
      {!keyboardUp && (
      <View style={styles.header}>

        {/* ── Header (chat.html): "Hi" and its subtitle, share the city, private messages. ── */}
        <ScreenHeader variant="tab" title={t('tabTitle')} subtitle={t('subtitles.hi', { ns: 'common' })} art="hi" right={
          <View style={styles.headerButtons}>
            <IconButton icon="share-outline" iconSize={20} label={t('shareCity')} onPress={async () => {
              // Locale-prefixed URL (Option A) so the link preview (OG tags -
              // all Android shares show) renders in the sharer's language.
              const url     = buildCityUrl(city.slug);
              const title   = t('shareTitle', { city: localizeCityName(city.name) });
              const message = t('shareMessage', { city: localizeCityName(city.name) });
              await shareLink({ title, message, url });
            }} />
            {account && (
              <IconButton icon="paper-plane-outline" iconSize={20} label={t('messages', { ns: 'common' })} badge={unreadDMs > 0}
                          onPress={() => { setUnreadDMs(0); clearEventChatCounts(); router.push('/messages'); }} />
            )}
          </View>
        } />

        {/* ── City / World switch (the app-wide scope). Tapping the active city
            changes city. Symmetric unread badges. ── */}
        <View style={styles.inset}>
          <Segmented
            options={[
              { key: 'city' as const, label: shortCityName(city.name), flag: city.country, badge: cityUnread },
              { key: 'world' as const, label: t('world.tab'), icon: 'globe-outline', badge: worldUnread },
            ]}
            value={channelScope === 'world' ? 'world' : 'city'}
            onChange={k => (k === 'world' ? switchScope('world') : channelScope === 'world' ? switchScope('city') : router.push('/switch-city' as never))}
          />
        </View>

        {/* ── People row (SPEC 9.6): only above the threshold. World shows its
            arrivals from 3 on. ── */}
        {channelScope === 'city' ? (
          channelId ? <View style={styles.inset}><PeopleRow cityId={String(channelId)} onArrivals={() => setArrivalsSheetOpen(true)} /></View> : null
        ) : worldArrivals.length >= 3 ? (
          <View style={styles.inset}>
            <TouchableOpacity style={styles.peopleChip} onPress={() => setShowWorldArrivals(true)} accessibilityRole="button">
              <Text style={styles.peopleChipText}>{t('world.arrivals', { count: worldArrivals.length })}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

      </View>
      )}

      {/* Error banner */}
      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8} accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={18} color={colors.red} />
          <Text style={styles.errorBannerText}>{t('dismissHint', { error })}</Text>
        </TouchableOpacity>
      )}

      {/* ── Messages - web: .messages ── */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
      >
        {/* Today's Daily Challenge pinned on top of World (in a city channel
            the Daily hero card above is the pin). */}
        {!keyboardUp && <DailyPinBar data={daily.data} source="chat_pin" />}
        {channelScope === 'city' && quietCardOpen && (
          <TouchableOpacity
            style={styles.quietCard}
            activeOpacity={0.85}
            accessibilityRole="button"
            onPress={() => {
              track('quiet_city_card_tapped', { city_id: channelId });
              quietCardDismissed.current = true;
              setQuietCardOpen(false);
              switchScope('world');
            }}
          >
            <Text style={styles.quietCardText} numberOfLines={2}>{t('world.quietCard', { count: worldUnread })}</Text>
          </TouchableOpacity>
        )}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <View style={styles.flex}>
          <FlatList
            ref={flatListRef}
            data={allMessages}
            keyExtractor={(m, idx) => m.id ?? m.localId ?? (m.guestId || m.createdAt ? `${m.guestId ?? ''}:${m.createdAt ?? ''}` : String(idx))}
            // Reply-quote taps call scrollToIndex on the parent message; on iOS
            // that throws (crashing JS) if the target is currently virtualized
            // off-screen. Silent no-op matches the other surfaces (city-chat,
            // dm, event): no crash, no jump if the message isn't laid out.
            onScrollToIndexFailed={() => {}}
            renderItem={renderMessage}
            inverted
            // Virtualization budget: render fewer rows per batch / keep a smaller
            // window mounted so a busy feed doesn't mount dozens of heavy bubbles.
            windowSize={9}
            maxToRenderPerBatch={8}
            initialNumToRender={12}
            removeClippedSubviews
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            onEndReached={hasMore ? loadOlder : undefined}
            onEndReachedThreshold={0.2}
            ListFooterComponent={
              loadingOlder ? (
                <View style={styles.loadingOlderWrap}>
                  <ActivityIndicator size="small" color={colors.muted} />
                </View>
              ) : (!hasMore && !loading && messages.length > 0) ? (
                <View style={styles.loadingOlderWrap}>
                  <Text style={styles.beginningText}>{t('beginning')}</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <EmptyState icon="chatbubbles-outline" title={t('emptyTitle')} body={t('emptySub')} />
              </View>
            }
          />
          {/* Soft fade at the list's top edge, so a bubble cut by the scroll
              (only its timestamp left) reads as "more above". */}
          <View pointerEvents="none" style={styles.topFade}>
            {TOP_FADE.map(o => <View key={o} style={[styles.topFadeStrip, { opacity: o }]} />)}
          </View>
          </View>
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
          <View style={styles.notice}>
            <Banner icon="at-outline" text={t('mentionNudge')}
                    action={{ label: t('signUp', { ns: 'common' }), onPress: () => { setMentionNudge(false); router.push('/auth-gate'); } }}
                    onClose={() => setMentionNudge(false)} closeLabel={t('close', { ns: 'common' })} />
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
          mentionContext={channelScope === 'world' ? 'world' : 'city'}
          mentionChannelId={channelScope === 'world' ? 'world' : channelId}
          // Drop the keyboard on send so the collapsed header + tab bar
          // re-appear (keyboardDidHide resets the focus-mode state).
          dismissOnSend
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
          // "+" menu (SPEC 9.6): creating a Hi plan / a Hi now lives here (city Chat).
          onCreatePlan={channelScope === 'city' ? () => router.push((account ? '/event/create' : '/auth-gate?reason=create_event&returnTo=%2Fevent%2Fcreate') as never) : undefined}
          onHiNow={channelScope === 'city' ? () => router.push((account ? '/topic/create' : '/auth-gate?reason=create_hangout&returnTo=%2Ftopic%2Fcreate') as never) : undefined}
        />
      </KeyboardAvoidingView>

      <MessageActionSheet
        visible={actionSheetMsg !== null}
        reactions={actionSheetMsg?.reactions ?? []}
        onReact={emoji => { if (actionSheetMsg) handleReact(actionSheetMsg, emoji); }}
        onReply={actionSheetMsg ? () => handleReply(actionSheetMsg) : undefined}
        onCopy={actionSheetMsg?.content ? () => { Clipboard.setStringAsync(actionSheetMsg.content!).catch(() => {}); } : undefined}
        translateText={actionSheetMsg?.content}
        // Edit is text-only (no image/location edits); Delete works for any owned bubble.
        onEdit={actionSheetMsg && isOwnMessage(actionSheetMsg) && actionSheetMsg.type === 'text' && !actionSheetMsg.deletedAt && actionSheetMsg.content && !actionSheetMsg.content.startsWith('📍')
          ? () => handleEdit(actionSheetMsg) : undefined}
        onDelete={actionSheetMsg && isOwnMessage(actionSheetMsg) && !actionSheetMsg.deletedAt && !isDailyCard(actionSheetMsg)
          ? () => handleDelete(actionSheetMsg) : undefined}
        onClose={() => setActionSheetMsg(null)}
      />

      <ArrivalsSheet
        visible={arrivalsSheetOpen}
        arrivals={arrivals}
        onClose={() => setArrivalsSheetOpen(false)}
      />

      {/* World arrivals sheet - global "who just landed", each with city + flag. */}
      <Sheet visible={showWorldArrivals} onClose={() => setShowWorldArrivals(false)} closeLabel={t('close', { ns: 'common' })} style={styles.waSheet}>
        <SectionTitle title={t('world.arrivalsTitle')} />
        {worldArrivals.length === 0 ? (
          <EmptyState body={t('world.arrivalsEmpty')} />
        ) : (
          <FlatList
            data={worldArrivals}
            keyExtractor={(a, i) => `${a.guestId ?? a.userId ?? a.nickname}-${a.createdAt}-${i}`}
            renderItem={({ item: a, index }) => (
              <ListRow
                divider={index > 0}
                style={styles.waRow}
                leading={<Avatar uri={a.thumbAvatarUrl ? thumbUrl(a.thumbAvatarUrl) : null} name={a.nickname ?? '?'} size={36} fallback="color" />}
                title={a.nickname ?? ''}
                value={`${cityFlag(a.country ?? undefined)} ${a.city ?? ''} · ${formatSmartTime(a.createdAt)}`}
                chevron={false}
                onPress={() => {
                  // Tap → open the arriver's profile (guard guests behind auth gate).
                  if (a.userId) {
                    if (!canAccessProfile(account)) { setShowWorldArrivals(false); router.push('/auth-gate'); return; }
                    setShowWorldArrivals(false);
                    router.push({ pathname: '/user/[id]', params: { id: a.userId } });
                  } else if (a.guestId) {
                    setShowWorldArrivals(false);
                    router.push({ pathname: '/user/guest', params: { guestId: a.guestId, nickname: a.nickname ?? '' } });
                  }
                }}
              />
            )}
          />
        )}
      </Sheet>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const TOP_FADE = [1, 0.8, 0.6, 0.4, 0.25, 0.1];

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:      { flex: 1, backgroundColor: c.bg },
  flex:           { flex: 1 },
  topFade:        { position: 'absolute', top: 0, left: 0, right: 0 },
  topFadeStrip:   { height: 3, backgroundColor: c.bg },
  header:         { gap: 10, paddingBottom: 8, backgroundColor: c.bg },
  headerButtons:  { flexDirection: 'row', gap: 8 },
  inset:          { paddingHorizontal: Spacing.md },
  peopleChip:     { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: Radius.full,
                    borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  peopleChipText: { fontSize: FontSizes.sm, fontWeight: '600', color: c.text },
  errorBanner:    { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginHorizontal: Spacing.md, marginBottom: 6,
                    paddingHorizontal: 12, borderRadius: Radius.button, borderWidth: Border, borderColor: c.red, backgroundColor: c.bg2 },
  errorBannerText:{ flex: 1, fontSize: FontSizes.xs, fontWeight: '600', color: c.red },
  quietCard:      { minHeight: 44, justifyContent: 'center', marginHorizontal: Spacing.md, marginTop: 8, paddingVertical: 11, paddingHorizontal: 14,
                    borderRadius: Radius.card, borderWidth: Border, borderColor: c.ticketLine, backgroundColor: c.bg2 },
  quietCardText:  { fontSize: FontSizes.sm, fontWeight: '700', color: c.text, textAlign: 'center' },
  center:         { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.lg },
  listContent:    { paddingTop: 28, paddingBottom: 18 },
  loadingOlderWrap: { paddingVertical: 14, alignItems: 'center' },
  beginningText:  { fontSize: 12, fontWeight: '600', color: c.muted },
  emptyWrap:      { flex: 1, justifyContent: 'center', padding: Spacing.lg },
  notice:         { paddingHorizontal: Spacing.md, paddingBottom: 6 },
  typingBar:      { paddingHorizontal: Spacing.md, paddingVertical: 6 },
  typingText:     { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted, fontStyle: 'italic' },
  waSheet:        { maxHeight: '75%' },
  waRow:          { paddingHorizontal: 0 },
});
