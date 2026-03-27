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
import { useApp } from '@/context/AppContext';
import type { OnlineUser } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

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

function UserRow({
  user,
  isMe,
  onDm,
}: {
  user: OnlineUser;
  isMe: boolean;
  onDm: () => void;
}) {
  const initials = (user.nickname ?? '?').slice(0, 2).toUpperCase();
  const color    = avatarColor(user.nickname ?? '');

  return (
    <View style={styles.row}>
      {/* Avatar */}
      <View style={[styles.avatar, { backgroundColor: color + '28', borderColor: color + '50' }]}>
        <Text style={[styles.avatarText, { color }]}>{initials}</Text>
        {/* Live dot — green dot at bottom-right of avatar */}
        <View style={styles.liveDot} />
      </View>

      {/* Name + badge */}
      <View style={styles.rowInfo}>
        <View style={styles.nameRow}>
          <Text style={styles.nickname}>
            {user.nickname}
            {isMe ? <Text style={styles.youLabel}> (you)</Text> : ''}
          </Text>
        </View>
        {isMe ? (
          <View style={styles.liveNowBadge}>
            <Text style={styles.liveNowText}>LIVE NOW</Text>
          </View>
        ) : user.isRegistered ? (
          <View style={styles.memberBadge}>
            <Text style={styles.memberBadgeText}>MEMBER</Text>
          </View>
        ) : null}
      </View>

      {/* DM button — only for registered non-self users */}
      {!isMe && user.userId && (
        <TouchableOpacity style={styles.dmBtn} onPress={onDm} activeOpacity={0.7}>
          <Feather name="message-square" size={18} color={Colors.muted2} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HereScreen() {
  const router = useRouter();
  const { city, sessionId, onlineUsers, wsConnected } = useApp();

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
          <Text style={styles.headerTitle}>Here</Text>
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

      {/* Header — web: "People here · N" */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          People here
          {total > 0 ? <Text style={styles.headerCount}> · {total}</Text> : ''}
        </Text>
        <Text style={styles.headerSub}>{city.name}</Text>
      </View>

      {/* ── DEBUG BLOCK (temporary) — remove once presence confirmed working ── */}
      {__DEV__ && (
        <View style={styles.debugBlock}>
          <Text style={styles.debugText}>cityId: {city.channelId} · ws: {wsConnected ? 'connected' : 'disconnected'}</Text>
          <Text style={styles.debugText}>session: {sessionId?.slice(0,8)} · raw: {onlineUsers.length} · shown: {displayList.length}</Text>
          <Text style={styles.debugText}>users: {onlineUsers.map(u => u.nickname).join(', ') || '(none yet)'}</Text>
        </View>
      )}

      <FlatList
        data={displayList}
        keyExtractor={(u) => u.sessionId}
        renderItem={({ item }) => (
          <UserRow
            user={item}
            isMe={item.sessionId === mySessionId}
            onDm={() => {
              if (item.userId) {
                router.push({
                  pathname: '/dm/[id]',
                  params: { id: item.userId, name: item.nickname },
                });
              }
            }}
          />
        )}
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

  // ── Header — web: page-header style ──────────────────────────────────────
  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize:      FontSizes.xl,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.5,
  },
  headerCount: {
    color:      Colors.muted,
    fontWeight: '600',
  },
  headerSub: { fontSize: FontSizes.sm, color: Colors.muted, marginTop: 2 },

  list: { padding: Spacing.md, gap: Spacing.sm },

  // ── Temporary debug block ─────────────────────────────────────────────────
  debugBlock: {
    backgroundColor:   'rgba(255,122,60,0.08)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,122,60,0.2)',
    paddingHorizontal: Spacing.md,
    paddingVertical:   8,
    gap:               2,
  },
  debugText: { fontSize: 11, color: Colors.accent, fontFamily: 'monospace' },

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
  nickname:  { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  youLabel:  { fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '400' },

  // MEMBER badge — purple, matches web
  memberBadge: {
    alignSelf:         'flex-start',
    backgroundColor:   'rgba(139,92,246,0.15)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderWidth:       1,
    borderColor:       'rgba(139,92,246,0.25)',
  },
  memberBadgeText: {
    color:         Colors.violet,
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    letterSpacing: 0.4,
  },

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
