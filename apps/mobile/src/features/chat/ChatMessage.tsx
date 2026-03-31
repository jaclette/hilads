/**
 * ChatMessage — faithful port of the web message rendering.
 *
 * Web source: App.jsx feed.map() + index.css (.message, .msg-*, .feed-join)
 *
 * API wire format uses camelCase (guestId, imageUrl, createdAt).
 * System messages have no content — text is generated from event+nickname.
 *
 * Types:
 *   system → centered join pill ("nickname joined") — web: .feed-join
 *   image  → photo with web-matching border-radius
 *   text   → bubble with avatar + author (grouped = avatar hidden)
 */

import { useRef, useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, FontSizes } from '@/constants';
import { formatTime } from '@/lib/messageTime';
import type { Message, Badge } from '@/types';

// ── Avatar palette — mirrors web AVATAR_PALETTES ──────────────────────────────

const AVATAR_PALETTES: [string, string][] = [
  ['#7c6aff', '#c084fc'],
  ['#ff6a9f', '#fb7185'],
  ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'],
  ['#fb923c', '#fbbf24'],
  ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'],
  ['#2dd4bf', '#a3e635'],
];

function avatarColors(name: string): [string, string] {
  const hash = (name ?? '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
}

// ── System message text — mirrors web JOIN_TEMPLATES exactly ─────────────────
// Web source: App.jsx JOIN_TEMPLATES — random pick per event.
// Native: hash(nickname + createdAt) for stable display across re-renders.

const JOIN_TEMPLATES: ((n: string) => string)[] = [
  (n) => `👋 ${n} just landed`,
  (n) => `🔥 ${n} joined the vibe`,
  (n) => `🍻 ${n} is here`,
  (n) => `👀 ${n} just showed up`,
  (n) => `✨ ${n} arrived`,
];

function systemText(message: Message): string {
  const nick = message.nickname ?? 'Someone';
  if (message.event === 'join') {
    const seed = `${nick}${message.createdAt ?? ''}`
      .split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return JOIN_TEMPLATES[seed % JOIN_TEMPLATES.length](nick);
  }
  if (message.event === 'leave') return `${nick} left`;
  return message.content ?? `${nick} (${message.event ?? 'activity'})`;
}

// ── Entry animation hook — called unconditionally at top of ChatMessage ───────
// opacity 0→1, translateY 8→0, ease-out, 200ms
// Must be called before any conditional returns to obey React hook rules.

function useEntryAnimation(duration = 200) {
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration, useNativeDriver: true }),
    ]).start();
  }, []);

  return { opacity, translateY };
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  message:   Message;
  myGuestId: string | undefined;
  isGrouped?: boolean;
  index?:     number;     // used for stagger delay on event items
  showTime?:  boolean;    // show timestamp below bubble (last in sender group)
  dateLabel?: string;     // if set, render a date separator above this item
}

// ── Animated event pill — fade + slide-up on mount, staggered by index ───────

function AnimatedEventPill({ message, index }: { message: Message; index: number }) {
  const router  = useRouter();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue:         1,
        duration:        260,
        delay:           index * 50,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue:         0,
        duration:        260,
        delay:           index * 50,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.eventRow, { opacity, transform: [{ translateY }] }]}>
      <View style={styles.eventPill}>
        <Text style={styles.eventText}>
          🔥 New event: {message.content}
        </Text>
        <TouchableOpacity
          style={styles.eventJoinBtn}
          activeOpacity={0.8}
          onPress={() => message.eventId && router.push(`/event/${message.eventId}`)}
        >
          <Text style={styles.eventJoinText}>Join</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

// ── Date separator — centered pill between days ───────────────────────────────

function DateSeparator({ label }: { label: string }) {
  return (
    <View style={styles.dateSepRow}>
      <View style={styles.dateSepLine} />
      <Text style={styles.dateSepText}>{label}</Text>
      <View style={styles.dateSepLine} />
    </View>
  );
}

// ── Sender identity — avatar + name, always tappable ─────────────────────────
// Always renders as TouchableOpacity so the tap area exists regardless of
// whether the backend has resolved userId yet.
//
// Navigation ID priority: userId (registered account ID) → guestId (fallback).
// The backend profile endpoint accepts both — it tries findById first, then
// findByGuestId — so both forms resolve to the correct profile page.
// Guests with no account get a "User not found" screen, which is the correct
// graceful outcome. This matches DM behaviour where sender_id is always present.

// ── Badge pill ────────────────────────────────────────────────────────────────

const BADGE_CONFIG: Record<string, { bg: string; color: string }> = {
  ghost: { bg: 'rgba(255,255,255,0.06)', color: '#666' },
  fresh: { bg: 'rgba(74,222,128,0.12)',  color: '#4ade80' },
  crew:  { bg: 'rgba(96,165,250,0.12)',  color: '#60a5fa' },
  local: { bg: 'rgba(52,211,153,0.12)',  color: '#34d399' },
  host:  { bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24' },
};

function BadgePill({ badge }: { badge: { key: string; label: string } }) {
  const cfg = BADGE_CONFIG[badge.key] ?? BADGE_CONFIG.crew;
  return (
    <View style={[badgeStyles.pill, { backgroundColor: cfg.bg }]}>
      <Text style={[badgeStyles.text, { color: cfg.color }]}>{badge.label}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  pill: {
    borderRadius:      20,
    paddingHorizontal: 6,
    paddingVertical:   2,
  },
  text: {
    fontSize:   11,
    fontWeight: '600',
  },
});

// ── Vibe emoji lookup ─────────────────────────────────────────────────────────

const VIBE_EMOJI: Record<string, string> = {
  party: '🔥', board_games: '🎲', coffee: '☕', music: '🎧', food: '🍜', chill: '🧘',
};

// ── SenderMeta ────────────────────────────────────────────────────────────────

function SenderMeta({ nickname, color, initial, userId, guestId, primaryBadge, contextBadge, vibe }: {
  nickname:     string;
  color:        string;
  initial:      string;
  userId?:      string;
  guestId?:     string;
  primaryBadge?: Badge;
  contextBadge?: Badge | null;
  vibe?:         string;
}) {
  const router = useRouter();
  const navId  = userId ?? guestId;   // prefer resolved userId, fall back to guestId

  const inner = (
    <>
      <View style={[styles.avatar, { backgroundColor: color }]}>
        <Text style={styles.avatarLetter}>{initial}</Text>
      </View>
      <Text style={[styles.author, { color }]}>{nickname}</Text>
      {primaryBadge && <BadgePill badge={primaryBadge} />}
      {contextBadge && <BadgePill badge={contextBadge} />}
      {vibe && VIBE_EMOJI[vibe] && (
        <Text style={styles.vibeLabel}>{VIBE_EMOJI[vibe]}</Text>
      )}
    </>
  );

  if (navId) {
    return (
      <TouchableOpacity
        style={styles.meta}
        onPress={() => router.push({ pathname: '/user/[id]', params: { id: navId } })}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        {inner}
      </TouchableOpacity>
    );
  }
  return <View style={styles.meta}>{inner}</View>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatMessage({ message, myGuestId, isGrouped = false, index = 0, showTime = false, dateLabel }: Props) {
  const router = useRouter();

  // Hook called unconditionally — React rules require this before any early return
  const { opacity, translateY } = useEntryAnimation(200);
  const animStyle = { opacity, transform: [{ translateY }] } as const;

  // ── Event feed item — web: .feed-prompt (orange pill + Join CTA) ─────────
  if (message.type === 'event') {
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        <AnimatedEventPill message={message} index={index} />
      </>
    );
  }

  // ── System / join message — web: .feed-join (centered pill) ──────────────
  if (message.type === 'system') {
    const text = systemText(message);
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        <Animated.View style={[styles.systemRow, animStyle]}>
          <Text style={styles.systemText}>{text}</Text>
        </Animated.View>
      </>
    );
  }

  const isMine  = Boolean(myGuestId && message.guestId === myGuestId);
  const [c1]    = avatarColors(message.nickname ?? '?');
  const initial = (message.nickname?.[0] ?? '?').toUpperCase();
  const isSending = message.status === 'sending';
  const isFailed  = message.status === 'failed';

  // ── Image message ─────────────────────────────────────────────────────────
  if (message.type === 'image') {
    if (!message.imageUrl) {
      console.warn('[msg] image message missing imageUrl:', JSON.stringify(message));
      return null;
    }
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        <Animated.View style={[
          styles.row,
          isMine    ? styles.rowMine    : styles.rowOther,
          isGrouped ? styles.rowGrouped : styles.rowFirst,
          animStyle,
          isSending && styles.rowSending,
        ]}>
          {!isMine && !isGrouped && (
            <SenderMeta
              nickname={message.nickname ?? '?'}
              color={c1}
              initial={initial}
              userId={message.userId}
              guestId={message.guestId}
              primaryBadge={message.primaryBadge}
              contextBadge={message.contextBadge}
              vibe={message.vibe}
            />
          )}
          <View>
            <Image
              source={{ uri: message.imageUrl }}
              style={[styles.image, isMine ? styles.imageMine : styles.imageOther]}
              resizeMode="cover"
              onError={() => console.warn('[msg] image load error:', message.imageUrl)}
            />
            {isSending && (
              <View style={styles.imageOverlay}>
                <ActivityIndicator size="small" color="rgba(255,255,255,0.8)" />
              </View>
            )}
            {isFailed && (
              <View style={styles.imageOverlay}>
                <Text style={styles.imageFailedIcon}>!</Text>
              </View>
            )}
          </View>
          {showTime && (
            <Text style={[styles.timestamp, isMine ? styles.timestampMine : styles.timestampOther]}>
              {formatTime(message.createdAt)}
            </Text>
          )}
        </Animated.View>
      </>
    );
  }

  // ── Text message ─────────────────────────────────────────────────────────
  if (!message.content) {
    console.warn('[msg] text message missing content:', JSON.stringify(message));
    return null;
  }

  return (
    <>
      {dateLabel && <DateSeparator label={dateLabel} />}
      <Animated.View style={[
        styles.row,
        isMine    ? styles.rowMine    : styles.rowOther,
        isGrouped ? styles.rowGrouped : styles.rowFirst,
        animStyle,
        isSending && styles.rowSending,
      ]}>

        {/* ── Avatar + author — web: .msg-meta ── */}
        {!isMine && !isGrouped && (
          <SenderMeta
            nickname={message.nickname ?? '?'}
            color={c1}
            initial={initial}
            userId={message.userId}
            guestId={message.guestId}
            primaryBadge={message.primaryBadge}
            contextBadge={message.contextBadge}
            vibe={message.vibe}
          />
        )}

        {/* ── Bubble — web: .msg-content ── */}
        <View>
          <View style={[
            styles.bubble,
            isMine ? styles.bubbleMine : styles.bubbleOther,
            isFailed && styles.bubbleFailed,
          ]}>
            <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
              {message.content}
            </Text>
          </View>
          {isFailed && (
            <Text style={styles.failedLabel}>Failed to send · tap to retry</Text>
          )}
          {showTime && (
            <Text style={[styles.timestamp, isMine ? styles.timestampMine : styles.timestampOther]}>
              {formatTime(message.createdAt)}
            </Text>
          )}
        </View>

      </Animated.View>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  // ── .feed-prompt — event orange pill ─────────────────────────────────────
  // Centered column: title on top, Join button below — handles any title length cleanly
  eventRow: {
    alignItems:        'center',
    marginVertical:    4,
    paddingHorizontal: 18,
  },
  eventPill: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    backgroundColor:   'rgba(255,122,60,0.08)',
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.18)',
    borderRadius:      22,
    paddingHorizontal: 16,
    paddingVertical:   12,
    maxWidth:          '82%',
  },
  eventText: {
    flexShrink:  1,
    fontSize:    16,
    fontWeight:  '600',
    color:       Colors.text,
    lineHeight:  22,
    marginRight: 10,
    textAlign:   'center',
  },
  eventJoinBtn: {
    backgroundColor:   'rgba(255,122,60,0.55)',
    borderRadius:      12,
    paddingHorizontal: 11,
    paddingVertical:   4,
    flexShrink:        0,
  },
  eventJoinText: {
    color:      '#fff',
    fontSize:   15,
    fontWeight: '700',
  },

  // ── .feed-join — centered pill ────────────────────────────────────────────
  // Web: font-size 0.85rem (~13.6px), font-weight 500, padding 6px 16px,
  //      margin 12px 0, border-radius 20px, bg rgba(255,255,255,0.04)
  systemRow: {
    alignItems:        'center',
    marginVertical:    16,
    paddingHorizontal: 16,
  },
  systemText: {
    fontSize:          15,
    fontWeight:        '500',
    color:             Colors.muted2,
    backgroundColor:   'rgba(255,255,255,0.04)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.07)',
    borderRadius:      20,
    paddingHorizontal: 20,
    paddingVertical:   9,
    overflow:          'hidden',
  },

  // ── .message ─────────────────────────────────────────────────────────────
  row: {
    flexDirection: 'column',
    maxWidth:      '72%',
  },
  // alignItems shrinks children to content width so short bubbles don't stretch
  rowOther:   { alignSelf: 'flex-start', alignItems: 'flex-start', paddingLeft: 14 },
  rowMine:    { alignSelf: 'flex-end',   alignItems: 'flex-end',   paddingRight: 14 },
  rowFirst:   { marginTop: 16 },
  rowGrouped: { marginTop: 8 },
  rowSending: { opacity: 0.65 },

  // ── .msg-meta ─────────────────────────────────────────────────────────────
  meta: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    paddingLeft:   2,
    marginBottom:  4,
  },

  // ── .msg-avatar ───────────────────────────────────────────────────────────
  avatar: {
    width:          34,
    height:         34,
    borderRadius:   17,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
    shadowColor:    '#000',
    shadowOffset:   { width: 0, height: 2 },
    shadowOpacity:  0.4,
    shadowRadius:   4,
    elevation:      4,
  },
  avatarLetter: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // ── .msg-author ───────────────────────────────────────────────────────────
  author:    { fontSize: 13, fontWeight: '700', opacity: 0.9 },
  vibeLabel: { fontSize: 13, opacity: 0.55 },

  // ── .msg-content ──────────────────────────────────────────────────────────
  bubble: {
    borderRadius:      16,
    paddingHorizontal: 12,
    paddingVertical:   8,
  },
  bubbleOther: {
    backgroundColor:     Colors.bg3,
    borderWidth:         1,
    borderColor:         'rgba(255,255,255,0.05)',
    borderTopLeftRadius: 4,
  },
  bubbleMine: {
    backgroundColor:      '#B87228',   // web gradient end — warm orange, not red
    borderTopRightRadius: 4,
    shadowColor:          '#8a5418',
    shadowOffset:         { width: 0, height: 2 },
    shadowOpacity:        0.35,
    shadowRadius:         6,
    elevation:            4,
  },
  bubbleText:     { fontSize: FontSizes.md, color: Colors.text,  lineHeight: 22 },
  bubbleTextMine: { color: '#fff' },

  // Failed state
  bubbleFailed: {
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.5)',
  },
  failedLabel: {
    fontSize:   11,
    color:      Colors.red,
    marginTop:  4,
    marginLeft: 4,
  },

  // ── Date separator ────────────────────────────────────────────────────────
  dateSepRow: {
    flexDirection:     'row',
    alignItems:        'center',
    marginVertical:    18,
    paddingHorizontal: 18,
    gap:               10,
  },
  dateSepLine: {
    flex:            1,
    height:          1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  dateSepText: {
    fontSize:          11,
    fontWeight:        '600',
    color:             Colors.muted2,
    letterSpacing:     0.5,
    textTransform:     'uppercase',
    backgroundColor:   Colors.bg2,
    paddingHorizontal: 10,
    paddingVertical:   3,
    borderRadius:      999,
    overflow:          'hidden',
  },

  // ── Per-bubble timestamp ──────────────────────────────────────────────────
  timestamp: {
    fontSize:   11,
    marginTop:  3,
    color:      Colors.muted2,
  },
  timestampMine:  { textAlign: 'right',  paddingRight: 2 },
  timestampOther: { textAlign: 'left',   paddingLeft: 2 },

  // ── .msg-image ────────────────────────────────────────────────────────────
  image: { width: 280, height: 240, marginTop: 2 },
  imageOverlay: {
    position:       'absolute',
    top:            0,
    left:           0,
    right:          0,
    bottom:         0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems:     'center',
    justifyContent: 'center',
    borderRadius:   16,
  },
  imageFailedIcon: {
    color:      '#fff',
    fontSize:   22,
    fontWeight: '800',
  },
  imageOther: {
    borderTopLeftRadius:     4,
    borderTopRightRadius:    16,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius:  16,
  },
  imageMine: {
    borderTopLeftRadius:     16,
    borderTopRightRadius:    4,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius:  16,
  },
});
