/**
 * Here screen — who's live in this city right now.
 *
 * Data: reads onlineUsers from AppContext (populated globally by usePresence hook).
 * Web parity: "People here · N" title, user cards with MEMBER/LIVE NOW badges, DM button.
 */

import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import type { OnlineUser } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

// ── Badge pill ────────────────────────────────────────────────────────────────

const BADGE_BG: Record<string, object> = {
  ghost: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.10)' },
  fresh: { backgroundColor: 'rgba(74,222,128,0.12)',  borderColor: 'rgba(74,222,128,0.22)'  },
  regular: { backgroundColor: 'rgba(96,165,250,0.12)',  borderColor: 'rgba(96,165,250,0.22)'  },
  local: { backgroundColor: 'rgba(52,211,153,0.12)',  borderColor: 'rgba(52,211,153,0.22)'  },
  host:  { backgroundColor: 'rgba(251,191,36,0.15)',  borderColor: 'rgba(251,191,36,0.28)'  },
};
const BADGE_COLOR: Record<string, string> = {
  ghost: '#666', fresh: '#4ade80', regular: '#60a5fa', local: '#34d399', host: '#fbbf24',
};

function BadgePill({ badge }: { badge: { key: string; label: string } }) {
  const bg    = BADGE_BG[badge.key]    ?? BADGE_BG.regular;
  const color = BADGE_COLOR[badge.key] ?? BADGE_COLOR.regular;
  return (
    <View style={[hereBadgeStyles.pill, bg]}>
      <Text style={[hereBadgeStyles.text, { color }]}>{badge.label}</Text>
    </View>
  );
}

const hereBadgeStyles = StyleSheet.create({
  pill: {
    alignSelf:         'flex-start',
    borderRadius:      999,
    paddingHorizontal: 7,
    paddingVertical:   3,
    borderWidth:       1,
  },
  text: { fontSize: 10, fontWeight: '700' },
});

// ── Vibe display ──────────────────────────────────────────────────────────────

const VIBE_META: Record<string, { emoji: string; label: string; color: string; bg: string; border: string }> = {
  party:       { emoji: '🔥', label: 'Party',       color: '#f97316', bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.25)'  },
  board_games: { emoji: '🎲', label: 'Board Games', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.25)' },
  coffee:      { emoji: '☕', label: 'Coffee',      color: '#c4a882', bg: 'rgba(196,168,130,0.12)', border: 'rgba(196,168,130,0.25)' },
  music:       { emoji: '🎧', label: 'Music',       color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.25)'  },
  food:        { emoji: '🍜', label: 'Food',        color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.25)'  },
  chill:       { emoji: '🧘', label: 'Chill',       color: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.25)'  },
};

function VibePill({ vibe }: { vibe?: string }) {
  if (!vibe) return null;
  const meta = VIBE_META[vibe];
  if (!meta) return null;
  return (
    <View style={[hereBadgeStyles.pill, { backgroundColor: meta.bg, borderColor: meta.border }]}>
      <Text style={[hereBadgeStyles.text, { color: meta.color, opacity: 0.85 }]}>{meta.emoji} {meta.label}</Text>
    </View>
  );
}

// ── Avatar color — hash-based palette matching web ────────────────────────────

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

// ── User row — matches web "People here" card ─────────────────────────────────
// Web: avatar circle + name + MEMBER badge (purple) or LIVE NOW (green) + DM btn
// Full card tap → opens public profile (registered non-self users only).
// DM button → opens DM thread directly (independent inner touchable).

function UserRow({
  user,
  isMe,
  onPress,
  onDm,
}: {
  user: OnlineUser;
  isMe: boolean;
  onPress?: () => void;
  onDm: () => void;
}) {
  const initials = (user.nickname ?? '?').slice(0, 2).toUpperCase();
  const color    = avatarColor(user.nickname ?? '');

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      {/* Avatar */}
      <View style={[styles.avatar, { backgroundColor: color + '28', borderColor: color + '50' }]}>
        <Text style={[styles.avatarText, { color }]}>{initials}</Text>
        {/* Live dot — green dot at bottom-right of avatar */}
        <View style={styles.liveDot} />
      </View>

      {/* Name + badges */}
      <View style={styles.rowInfo}>
        <View style={styles.nameRow}>
          <Text style={styles.nickname}>
            {user.nickname}
            {isMe ? <Text style={styles.youLabel}> (you)</Text> : ''}
          </Text>
        </View>
        <View style={styles.badgeRow}>
          {isMe ? (
            <View style={styles.liveNowBadge}>
              <Text style={styles.liveNowText}>LIVE NOW</Text>
            </View>
          ) : user.primaryBadge ? (
            <BadgePill badge={user.primaryBadge} />
          ) : user.isRegistered ? (
            <BadgePill badge={{ key: 'regular', label: 'Regular' }} />
          ) : (
            <BadgePill badge={{ key: 'ghost', label: '👻 Ghost' }} />
          )}
          {!isMe && user.vibe && <VibePill vibe={user.vibe} />}
        </View>
      </View>

      {/* DM button — registered non-self users only */}
      {!isMe && user.userId && (
        <TouchableOpacity style={styles.dmBtn} onPress={onDm} activeOpacity={0.7}>
          <Feather name="message-square" size={22} color={Colors.text} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HereScreen() {
  const router = useRouter();
  const { city, sessionId, onlineUsers } = useApp();

  // Show self at bottom of the list, others first
  // Filter and sort: others first, then me
  const mySessionId = sessionId ?? '';
  const others = onlineUsers.filter(u => u.sessionId !== mySessionId);
  const me     = onlineUsers.find(u => u.sessionId === mySessionId);
  const displayList = me ? [...others, me] : others;

  const total = onlineUsers.length;

  // No city
  if (!city) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>People here</Text>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>📍</Text>
          <Text style={styles.emptyTitle}>No city selected</Text>
          <Text style={styles.emptySub}>Pick a city to see who's around.</Text>
          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={() => router.push('/(tabs)/cities')}
            activeOpacity={0.85}
          >
            <Text style={styles.emptyBtnText}>Browse cities</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>

      {/* Header — back button left, centered title + city sub */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.push('/(tabs)/chat')}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            People here{total > 0 ? <Text style={styles.headerCount}> · {total}</Text> : ''}
          </Text>
          <Text style={styles.headerSub}>{city.name}</Text>
        </View>
      </View>

      <FlatList
        data={displayList}
        keyExtractor={(u, i) => u.sessionId || `fallback_${i}`}
        renderItem={({ item }) => {
          const isMe = item.sessionId === mySessionId;
          return (
            <UserRow
              user={item}
              isMe={isMe}
              onPress={!isMe && item.userId ? () => {
                router.push({
                  pathname: '/user/[id]',
                  params: { id: item.userId! },
                });
              } : undefined}
              onDm={() => {
                if (item.userId) {
                  router.push({
                    pathname: '/dm/[id]',
                    params: { id: item.userId, name: item.nickname },
                  });
                }
              }}
            />
          );
        }}
        contentContainerStyle={displayList.length === 0 ? styles.flex1 : styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>👻</Text>
            <Text style={styles.emptyTitle}>Nobody else here yet</Text>
            <Text style={styles.emptySub}>
              You're one of the first.{'\n'}Say hi in the city chat.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex1:     { flex: 1 },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    minHeight:         56,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
    zIndex:          1,
  },
  headerCenter: {
    position:   'absolute',
    left:       0,
    right:      0,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize:      FontSizes.xl,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.5,
    textAlign:     'center',
  },
  headerCount: {
    fontSize:   FontSizes.lg,
    color:      Colors.muted,
    fontWeight: '600',
  },
  headerSub: {
    fontSize:   FontSizes.sm,
    color:      Colors.muted,
    marginTop:  2,
    textAlign:  'center',
  },

  list: { padding: Spacing.md, gap: Spacing.sm },

  // ── User row — web: .presence-user-card ───────────────────────────────────
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    gap:               Spacing.md,
  },

  // ── Avatar — colored circle with initials + green live dot ───────────────
  avatar: {
    width:          44,
    height:         44,
    borderRadius:   Radius.full,
    borderWidth:    1,
    alignItems:     'center',
    justifyContent: 'center',
    position:       'relative',
  },
  avatarText: { fontWeight: '700', fontSize: FontSizes.sm },
  liveDot: {
    position:        'absolute',
    bottom:          1,
    right:           1,
    width:           10,
    height:          10,
    borderRadius:    5,
    backgroundColor: Colors.green,
    borderWidth:     2,
    borderColor:     Colors.bg2,
  },

  // ── Name + badges ─────────────────────────────────────────────────────────
  rowInfo: {
    flex:      1,
    gap:       4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems:    'center',
    flexWrap:      'wrap',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems:    'center',
    flexWrap:      'wrap',
    gap:           4,
  },
  nickname:  { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  youLabel:  { fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '400' },

  // LIVE NOW badge — green, matches web
  liveNowBadge: {
    alignSelf:         'flex-start',
    backgroundColor:   'rgba(61,220,132,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderWidth:       1,
    borderColor:       'rgba(61,220,132,0.25)',
  },
  liveNowText: {
    color:         Colors.green,
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    letterSpacing: 0.4,
  },

  // ── DM button — web: message-square icon button ───────────────────────────
  dmBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: '#1A1A1A',
    borderWidth:     1,
    borderColor:     '#2A2A2A',
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },

  // ── Empty state ────────────────────────────────────────────────────────────
  empty: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    padding:        Spacing.xl,
    gap:            Spacing.sm,
  },
  emptyEmoji: { fontSize: 48, marginBottom: Spacing.sm },
  emptyTitle: { fontSize: FontSizes.xl, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptySub:   { fontSize: FontSizes.md, color: Colors.muted, textAlign: 'center', lineHeight: 22 },
  emptyBtn: {
    marginTop:         Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.sm + 2,
    backgroundColor:   Colors.accent,
    borderRadius:      Radius.full,
  },
  emptyBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSizes.sm },
});
