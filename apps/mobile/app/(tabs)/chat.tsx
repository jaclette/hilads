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
  TouchableOpacity, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useMessages } from '@/hooks/useMessages';
import { fetchMessages, sendMessage, sendImageMessage } from '@/api/channels';
import { fetchCityEvents } from '@/api/events';
import type { HiladsEvent } from '@/types';
import { socket } from '@/lib/socket';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput, getPlaceholder } from '@/features/chat/ChatInput';
import { HiladsIcon } from '@/components/HiladsIcon';
import { Colors, FontSizes, Spacing } from '@/constants';
import { isSameDay, formatDateLabel } from '@/lib/messageTime';
import type { Message } from '@/types';

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

// ── Animated pulse dot — mirrors web .online-pulse keyframe ──────────────────
// Web: background var(--accent) #C24A38, 7px circle, scale+opacity pulse 2.2s

function PulseDot() {
  const scale   = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale,   { toValue: 1.25, duration: 1100, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1,    duration: 1100, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale,   { toValue: 1,   duration: 1100, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.9, duration: 1100, useNativeDriver: true }),
        ]),
      ]),
    ).start();
  }, []);

  return (
    <Animated.View style={[styles.pulseDot, { transform: [{ scale }], opacity }]} />
  );
}

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
  } = useApp();
  const nickname = account?.display_name ?? identity?.nickname ?? '';

  // Online count — populated by WS presenceSnapshot, fallback "live now"
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const countScale = useRef(new Animated.Value(1)).current;

  const pulseCount = useCallback(() => {
    Animated.sequence([
      Animated.timing(countScale, { toValue: 1.18, duration: 120, useNativeDriver: true }),
      Animated.timing(countScale, { toValue: 1,    duration: 180, useNativeDriver: true }),
    ]).start();
  }, [countScale]);

  useEffect(() => {
    const off = socket.on('presenceSnapshot', (data: { count?: number; users?: unknown[] }) => {
      const next = data.count != null ? data.count
                 : Array.isArray(data.users) ? data.users.length
                 : null;
      if (next !== null) {
        setOnlineCount(prev => {
          if (prev !== null && prev !== next) pulseCount();
          return next;
        });
      }
    });
    return off;
  }, [pulseCount]);

  const channelId = city?.channelId ?? '';

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
  // into the feed. Native mirrors this: poll cityEvents, synthesize on first sight.

  // Fetch today's events + poll every 30s (same interval as web)
  useEffect(() => {
    if (!channelId) return;
    seenEventIds.current.clear();
    setEventFeedItems([]);

    async function loadEvents() {
      try {
        const evts = await fetchCityEvents(channelId);
        const now   = Date.now() / 1000;
        const fresh: Message[] = [];
        for (const e of evts) {
          if (!seenEventIds.current.has(e.id)) {
            seenEventIds.current.add(e.id);
            fresh.push({
              id:        `event-msg-${e.id}`,
              type:      'event',
              eventId:   e.id,
              content:   e.title,
              nickname:  '',
              createdAt: now,
            });
          }
        }
        if (fresh.length > 0) {
          setEventFeedItems(prev => [...prev, ...fresh]);
          console.log('[event-feed] synthesized', fresh.length, 'event feed item(s)');
        }
      } catch {}
    }

    loadEvents();
    const id = setInterval(loadEvents, 30_000);
    return () => clearInterval(id);
  }, [channelId]);

  const loadFn = useCallback(
    () => fetchMessages(channelId),
    [channelId],
  );

  const postTextFn = useCallback(
    (content: string): Promise<Message> => {
      if (!identity || !sessionId) return Promise.reject(new Error('Not ready'));
      return sendMessage(channelId, sessionId, identity.guestId, nickname, content);
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

  const { messages, loading, sending, error, clearError, sendText, sendImage } = useMessages({
    channelId,
    loadFn,
    postTextFn,
    postImageFn,
  });

  // Weather — extracted from messages for header display, not rendered in the feed.
  const weatherLabel = useMemo<string | null>(() => {
    const w = messages.find(m => m.type === 'system' && m.event === 'weather');
    return w?.content ?? null;
  }, [messages]);

  // Merge messages + synthesized event items; weather is excluded from the feed.
  //
  // Inverted FlatList: index 0 = BOTTOM of screen (near input, first thing visible).
  //                    high index = TOP of screen (user scrolls up to reach).
  //
  // Desired render order (bottom → top on screen):
  //   index 0,1,2…  events  → BOTTOM, near input, immediately visible on open
  //   index n+1…    other   → social/join messages scroll upward
  //
  // Array order: [...events, ...other]
  const allMessages = useMemo<Message[]>(() => {
    const combined = [...messages, ...eventFeedItems];
    const events  = combined.filter(m => m.type === 'event');
    const other   = combined.filter(m => m.type !== 'event' && !(m.type === 'system' && m.event === 'weather'));
    return [...events, ...other];
  }, [messages, eventFeedItems]);

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
            onPress={() => router.push('/(tabs)/cities')}
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

      {/* ── Header — web: .chat-header + renderCityHero() (mobile variant) ── */}
      {/*                                                                      */}
      {/* Web structure:                                                        */}
      {/*   .chat-header { radial-gradient bg, border-bottom }                 */}
      {/*   .header-hero { flex col, center, gap 18, min-height 148 }          */}
      {/*     Logo icon                                                         */}
      {/*     .header-hero-city                                                 */}
      {/*       .header-hero-name: flag + city name (clamp 2.15-2.65rem, 800)  */}
      {/*       .online-label: pulse dot + "N hanging out" / "live now"         */}

      <View style={styles.header}>

        {/* ── Side controls — web: .header-side-control (absolute positioned) ── */}
        {/* Only shown when account exists — mirrors web: {!activeEvent && account && ...} */}

        {/* Left: notification bell + badge count */}
        {account && (
          <TouchableOpacity
            style={[styles.headerIconBtn, unreadNotifications > 0 && styles.headerIconBtnUnread]}
            activeOpacity={0.65}
            onPress={() => router.push('/notifications' as never)}
          >
            <Ionicons name="notifications-outline" size={28} color={Colors.white} />
            {unreadNotifications > 0 && (
              <View style={styles.headerIconBadge}>
                <Text style={styles.headerIconBadgeText}>
                  {unreadNotifications > 9 ? '9+' : String(unreadNotifications)}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        {/* Right: DM icon + unread dot */}
        {account && (
          <TouchableOpacity
            style={[styles.headerIconBtnRight, unreadDMs > 0 && styles.headerIconBtnUnread]}
            activeOpacity={0.65}
            onPress={() => {
              setUnreadDMs(0);
              clearEventChatCounts();
              router.push('/(tabs)/messages');
            }}
          >
            <Feather name="message-square" size={28} color={Colors.white} />
            {unreadDMs > 0 && (
              <View style={styles.headerIconBadge}>
                <Text style={styles.headerIconBadgeText}>
                  {unreadDMs > 9 ? '9+' : String(unreadDMs)}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        {/* ── Hero: logo + city + online pill ── */}
        {/* web: .chat-header .logo svg { drop-shadow orange glow } */}
        <View style={styles.iconGlow}>
          <HiladsIcon size={46} />
        </View>
        <View style={styles.heroCity}>
          <Text style={styles.cityName} adjustsFontSizeToFit numberOfLines={1}>
            {flag ? `${flag} ` : ''}{city.name}
          </Text>
          <View style={styles.onlinePill}>
            <PulseDot />
            <Animated.Text style={[styles.onlineText, { transform: [{ scale: countScale }] }]}>
              {onlineCount != null ? `${onlineCount} hanging out` : 'live now'}
            </Animated.Text>
          </View>
          {weatherLabel && (
            <Text style={styles.weatherLabel}>{weatherLabel}</Text>
          )}
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : (
          <FlatList
            data={allMessages}
            keyExtractor={(m, idx) => (m.id ? m.id : String(idx))}
            renderItem={({ item, index }) => {
              const olderMsg = allMessages[index + 1]; // older (higher index in inverted list)
              const newerMsg = allMessages[index - 1]; // newer (lower index)
              const isGrouped =
                !!olderMsg &&
                olderMsg.guestId === item.guestId &&
                olderMsg.type !== 'system' &&
                item.type !== 'system';
              // showTime: last (newest) message in a sender run — newerMsg differs or absent
              const showTime =
                item.type !== 'system' && item.type !== 'event' && (
                  !newerMsg ||
                  newerMsg.guestId !== item.guestId ||
                  newerMsg.type === 'system'
                );
              // dateLabel: show when this item starts a new calendar day vs the older message
              const dateLabel =
                item.type !== 'event' && !isSameDay(item.createdAt, olderMsg?.createdAt)
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
                />
              );
            }}
            inverted
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
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

        {/* ── Input — web: .input-bar ── */}
        <ChatInput
          sending={sending}
          onSendText={sendText}
          onSendImage={sendImage}
          placeholder={getPlaceholder(channelId)}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex:      { flex: 1 },

  // ── .chat-header ─────────────────────────────────────────────────────────
  // Web: radial-gradient(ellipse 90% 55% at 50% -10%, rgba(194,74,56,0.10), transparent), var(--surface)
  // Web: .header-hero → flex col, center, gap 18, min-height 148px, position relative
  header: {
    flexDirection:     'column',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               20,
    minHeight:         168,
    paddingTop:        22,
    paddingBottom:     20,
    paddingHorizontal: Spacing.md,
    backgroundColor:   Colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    // Approximates web radial-gradient warm glow at top
    shadowColor:     '#C24A38',
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.08,
    shadowRadius:    20,
    elevation:       3,
  },

  // ── .header-side-control — absolute icon buttons ─────────────────────────
  // 48×48 touch area, white icon, visible border for definition on dark bg
  // Web: dark rounded square, subtle border for definition on dark header
  headerIconBtn: {
    position:        'absolute',
    left:            18,
    top:             16,
    width:           52,
    height:          52,
    borderRadius:    16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  headerIconBtnRight: {
    position:        'absolute',
    right:           18,
    top:             16,
    width:           52,
    height:          52,
    borderRadius:    16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  // Unread state: no extra border/glow — badge alone signals unread
  headerIconBtnUnread: {},
  // Badge — small circle, top-right, no glow, matches web dot style
  headerIconBadge: {
    position:          'absolute',
    top:               7,
    right:             7,
    minWidth:          17,
    height:            17,
    borderRadius:      9,
    backgroundColor:   '#C0392B',
    borderWidth:       1.5,
    borderColor:       Colors.bg2,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: 3,
  },
  headerIconBadgeText: {
    color:      Colors.white,
    fontSize:   10,
    fontWeight: '700',
    lineHeight: 12,
  },

  // ── Logo glow — web: .chat-header .logo svg { drop-shadow orange } ─────────
  // drop-shadow(0 0 14px rgba(194,74,56,0.55)) drop-shadow(0 0 4px rgba(194,74,56,0.35))
  iconGlow: {
    shadowColor:   '#C24A38',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius:  14,
    elevation:     10,
  },

  // .header-hero-city
  heroCity: {
    alignItems: 'center',
    gap:        8,
  },

  // .header-hero-name: clamp(2.15rem, 7.8vw, 2.65rem), weight 800, letter-spacing -0.04em
  cityName: {
    fontSize:      42,      // ≈ 2.65rem at 16px base — upper end of web clamp
    fontWeight:    '800',
    letterSpacing: -1.68,   // -0.04em × 42px
    color:         Colors.text,
    textAlign:     'center',
    lineHeight:    46,
  },

  // .online-label: pill, gap 8, padding 6 12, bg rgba(255,255,255,0.05), border rgba(255,255,255,0.07)
  onlinePill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    paddingHorizontal: 14,
    paddingVertical:   7,
    borderRadius:      999,
    backgroundColor:   'rgba(255,255,255,0.05)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.07)',
  },

  // .online-pulse: 7px, #C24A38
  pulseDot: {
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: '#C24A38',
    flexShrink:      0,
  },

  // online count text: 1rem = 16px
  onlineText: {
    fontSize: 16,
    color:    Colors.text,
  },

  // Weather context line — subtle, below presence pill
  weatherLabel: {
    fontSize:  FontSizes.xs,
    color:     Colors.muted,
    opacity:   0.75,
    marginTop: 2,
    textAlign: 'center',
  },

  // ── Error banner ─────────────────────────────────────────────────────────
  errorBanner:     { backgroundColor: Colors.red, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  errorBannerText: { color: Colors.white, fontSize: FontSizes.xs, textAlign: 'center' },

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
