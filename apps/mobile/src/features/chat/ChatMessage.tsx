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

import { View, Text, Image, StyleSheet } from 'react-native';
import { Colors, FontSizes } from '@/constants';
import type { Message } from '@/types';

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

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  message:   Message;
  myGuestId: string | undefined;
  isGrouped?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatMessage({ message, myGuestId, isGrouped = false }: Props) {

  // ── System / join message — web: .feed-join (centered pill) ──────────────
  if (message.type === 'system') {
    const text = systemText(message);
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>{text}</Text>
      </View>
    );
  }

  // ── Image message ─────────────────────────────────────────────────────────
  // API field: imageUrl (camelCase)
  if (message.type === 'image') {
    if (!message.imageUrl) {
      console.warn('[msg] image message missing imageUrl:', JSON.stringify(message));
      return null;
    }
    const isMine = Boolean(myGuestId && message.guestId === myGuestId);
    const [c1]   = avatarColors(message.nickname ?? '?');
    const initial = (message.nickname?.[0] ?? '?').toUpperCase();
    return (
      <View style={[
        styles.row,
        isMine    ? styles.rowMine    : styles.rowOther,
        isGrouped ? styles.rowGrouped : styles.rowFirst,
      ]}>
        {!isMine && !isGrouped && (
          <View style={styles.meta}>
            <View style={[styles.avatar, { backgroundColor: c1 }]}>
              <Text style={styles.avatarLetter}>{initial}</Text>
            </View>
            <Text style={[styles.author, { color: c1 }]}>{message.nickname}</Text>
          </View>
        )}
        <View style={!isMine && isGrouped ? styles.groupedOffset : undefined}>
          <Image
            source={{ uri: message.imageUrl }}
            // web: .msg-image { max-width:260; max-height:300; border-radius varies }
            style={[styles.image, isMine ? styles.imageMine : styles.imageOther]}
            resizeMode="cover"
            onError={() => console.warn('[msg] image load error:', message.imageUrl)}
          />
        </View>
      </View>
    );
  }

  // ── Text message ─────────────────────────────────────────────────────────
  // API field: content
  if (!message.content) {
    console.warn('[msg] text message missing content:', JSON.stringify(message));
    return null;
  }

  const isMine  = Boolean(myGuestId && message.guestId === myGuestId);
  const [c1]    = avatarColors(message.nickname ?? '?');
  const initial = (message.nickname?.[0] ?? '?').toUpperCase();

  return (
    <View style={[
      styles.row,
      isMine    ? styles.rowMine    : styles.rowOther,
      isGrouped ? styles.rowGrouped : styles.rowFirst,
    ]}>

      {/* ── Avatar + author — web: .msg-meta ── */}
      {!isMine && !isGrouped && (
        <View style={styles.meta}>
          <View style={[styles.avatar, { backgroundColor: c1 }]}>
            <Text style={styles.avatarLetter}>{initial}</Text>
          </View>
          <Text style={[styles.author, { color: c1 }]}>{message.nickname}</Text>
        </View>
      )}

      {/* ── Bubble — web: .msg-content ── */}
      <View style={!isMine && isGrouped ? styles.groupedOffset : undefined}>
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
          <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
            {message.content}
          </Text>
        </View>
      </View>

    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  // ── .feed-join — centered pill ────────────────────────────────────────────
  // Web: font-size 0.85rem (~13.6px), font-weight 500, padding 6px 16px,
  //      margin 12px 0, border-radius 20px, bg rgba(255,255,255,0.04)
  systemRow: {
    alignItems:        'center',
    marginVertical:    12,
    paddingHorizontal: 16,
  },
  systemText: {
    fontSize:          14,
    fontWeight:        '500',
    color:             Colors.muted2,
    backgroundColor:   'rgba(255,255,255,0.04)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.07)',
    borderRadius:      20,
    paddingHorizontal: 18,
    paddingVertical:   8,
    overflow:          'hidden',
  },

  // ── .message ─────────────────────────────────────────────────────────────
  row: {
    paddingHorizontal: 18,
    flexDirection:     'column',
    maxWidth:          '80%',
  },
  rowOther:   { alignSelf: 'flex-start' },
  rowMine:    { alignSelf: 'flex-end' },
  rowFirst:   { marginTop: 22 },
  rowGrouped: { marginTop: 4 },

  // ── .msg-meta ─────────────────────────────────────────────────────────────
  meta: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
    paddingLeft:   2,
    marginBottom:  3,
  },

  // ── .msg-avatar ───────────────────────────────────────────────────────────
  avatar: {
    width:          28,
    height:         28,
    borderRadius:   14,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
    shadowColor:    '#000',
    shadowOffset:   { width: 0, height: 2 },
    shadowOpacity:  0.4,
    shadowRadius:   4,
    elevation:      4,
  },
  avatarLetter: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // ── .msg-author ───────────────────────────────────────────────────────────
  author: { fontSize: 13, fontWeight: '600', opacity: 0.9 },

  // Grouped indent: 28px avatar + 6px gap
  groupedOffset: { paddingLeft: 34 },

  // ── .msg-content ──────────────────────────────────────────────────────────
  bubble: {
    borderRadius:      18,
    paddingHorizontal: 15,
    paddingVertical:   12,
  },
  bubbleOther: {
    backgroundColor:     Colors.bg3,
    borderWidth:         1,
    borderColor:         'rgba(255,255,255,0.05)',
    borderTopLeftRadius: 4,
  },
  bubbleMine: {
    backgroundColor:      '#C24A38',
    borderTopRightRadius: 4,
    shadowColor:          '#9e3a2c',
    shadowOffset:         { width: 0, height: 2 },
    shadowOpacity:        0.35,
    shadowRadius:         6,
    elevation:            4,
  },
  bubbleText:     { fontSize: FontSizes.md, color: Colors.text,  lineHeight: 23 },
  bubbleTextMine: { color: '#fff' },

  // ── .msg-image ────────────────────────────────────────────────────────────
  // web: max-width 260px; max-height 300px; border-radius varies
  image: { width: 260, height: 220, marginTop: 2 },
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
