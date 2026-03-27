import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
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

// ── User row ──────────────────────────────────────────────────────────────────

function UserRow({ user, onPress }: { user: OnlineUser; onPress: () => void }) {
  const initials = user.nickname.slice(0, 2).toUpperCase();
  const color    = avatarColor(user.nickname);

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {/* Avatar */}
      <View style={[styles.avatar, { backgroundColor: color + '28', borderColor: color + '50' }]}>
        <Text style={[styles.avatarText, { color }]}>{initials}</Text>
      </View>

      {/* Name + badge */}
      <View style={styles.rowInfo}>
        <Text style={styles.nickname}>{user.nickname}</Text>
        {user.isRegistered && (
          <View style={styles.memberBadge}>
            <Text style={styles.memberBadgeText}>Member</Text>
          </View>
        )}
      </View>

      {/* Live dot */}
      <View style={styles.liveDot} />
    </TouchableOpacity>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HereScreen() {
  const router   = useRouter();
  const { city, identity } = useApp();
  const [users,   setUsers]   = useState<OnlineUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const off = socket.on('presence', (data) => {
      if (data.channelId === city?.channelId && Array.isArray(data['users'])) {
        setUsers(data['users'] as OnlineUser[]);
        setLoading(false);
      }
    });

    if (socket.isConnected && city) {
      socket.send({ type: 'presence_request', channelId: city.channelId });
    }
    setLoading(false);

    return off;
  }, [city?.channelId]);

  const displayUsers = identity
    ? users.filter(u => u.guestId !== identity.guestId)
    : users;

  // No city
  if (!city) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>👥 Here</Text>
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
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>👥 Here</Text>
          <Text style={styles.headerSub}>
            {displayUsers.length > 0
              ? `${displayUsers.length} online in ${city.name}`
              : city.name}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={displayUsers}
          keyExtractor={(u) => u.sessionId}
          renderItem={({ item }) => (
            <UserRow
              user={item}
              onPress={() => {
                if (item.userId) {
                  router.push({ pathname: '/dm/[id]', params: { id: item.userId, name: item.nickname } });
                }
              }}
            />
          )}
          contentContainerStyle={displayUsers.length === 0 ? styles.flex1 : styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>👻</Text>
              <Text style={styles.emptyTitle}>Nobody else here yet</Text>
              <Text style={styles.emptySub}>You're one of the first.{'\n'}Say hi in the city chat.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex1:     { flex: 1 },

  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  headerSub:   { fontSize: FontSizes.sm, color: Colors.muted, marginTop: 2 },

  list: { padding: Spacing.md, gap: Spacing.sm },

  // ── User row ───────────────────────────────────────────────────────────────

  row: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    gap:               Spacing.md,
  },
  avatar: {
    width:        44,
    height:       44,
    borderRadius: Radius.full,
    borderWidth:  1,
    alignItems:   'center',
    justifyContent: 'center',
  },
  avatarText: { fontWeight: '700', fontSize: FontSizes.sm },

  rowInfo: {
    flex:           1,
    flexDirection:  'row',
    alignItems:     'center',
    gap:            Spacing.sm,
    flexWrap:       'wrap',
  },
  nickname: { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },

  memberBadge: {
    backgroundColor:  'rgba(139,92,246,0.15)',
    borderRadius:     Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   3,
  },
  memberBadgeText: { color: Colors.violet, fontSize: FontSizes.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },

  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.green },

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
