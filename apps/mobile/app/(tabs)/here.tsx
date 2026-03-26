import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import type { OnlineUser } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

function UserRow({ user }: { user: OnlineUser }) {
  const initials = user.nickname.slice(0, 2).toUpperCase();

  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.nickname}>{user.nickname}</Text>
        {user.isRegistered && (
          <View style={styles.regBadge}>
            <Text style={styles.regBadgeText}>Member</Text>
          </View>
        )}
      </View>
      <View style={styles.onlineDot} />
    </View>
  );
}

export default function HereScreen() {
  const { city, identity } = useApp();
  const [users,  setUsers]  = useState<OnlineUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen to presence updates from WebSocket
    const off = socket.on('presence', (data) => {
      if (data.channelId === city?.channelId && Array.isArray(data['users'])) {
        setUsers(data['users'] as OnlineUser[]);
        setLoading(false);
      }
    });

    // If already connected and in a city, request a fresh snapshot
    if (socket.isConnected && city && identity) {
      socket.send({ type: 'presence_request', channelId: city.channelId });
      setLoading(false);
    } else {
      // Will receive snapshot on join
      setLoading(false);
    }

    return off;
  }, [city?.channelId]);

  const displayUsers = identity
    ? users.filter(u => u.guestId !== identity.guestId)
    : users;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>👥 Here</Text>
        {city && (
          <Text style={styles.headerSub}>
            {displayUsers.length > 0
              ? `${displayUsers.length} online in ${city.name}`
              : `In ${city.name}`}
          </Text>
        )}
      </View>

      {!city ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No city selected</Text>
          <Text style={styles.emptySubtitle}>Go to Cities to pick one.</Text>
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={displayUsers}
          keyExtractor={(u) => u.sessionId}
          renderItem={({ item }) => <UserRow user={item} />}
          contentContainerStyle={displayUsers.length === 0 ? styles.flex1 : undefined}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>Nobody else here yet</Text>
              <Text style={styles.emptySubtitle}>You're one of the first. Say hi in chat.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex1:     { flex: 1 },
  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text },
  headerSub:   { fontSize: FontSizes.xs, color: Colors.muted, marginTop: 2 },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  emptyTitle:  { fontSize: FontSizes.md, fontWeight: '600', color: Colors.text, textAlign: 'center', marginBottom: Spacing.xs },
  emptySubtitle:{ fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center' },
  row: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical:  Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  avatar: {
    width:           40,
    height:          40,
    borderRadius:    Radius.full,
    backgroundColor: Colors.bg3,
    alignItems:      'center',
    justifyContent:  'center',
  },
  avatarText:   { color: Colors.accent, fontWeight: '700', fontSize: FontSizes.sm },
  rowInfo:      { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  nickname:     { fontSize: FontSizes.md, color: Colors.text, fontWeight: '500' },
  regBadge:     { backgroundColor: 'rgba(96,165,250,0.12)', borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  regBadgeText: { color: '#60a5fa', fontSize: FontSizes.xs, fontWeight: '600' },
  onlineDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.green },
});
