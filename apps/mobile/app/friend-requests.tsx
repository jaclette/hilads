/**
 * Friend Requests inbox — Incoming + Sent tabs.
 *
 * Wired to useFriendRequests, which loads both lists on mount and keeps them
 * in sync with the server via per-user WS events. Mutations are optimistic;
 * the hook rolls back + alerts on server error.
 */

import { useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, Image,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { useFriendRequests } from '@/hooks/useFriendRequests';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { FriendRequest } from '@/types';

type Tab = 'incoming' | 'sent';

const AVATAR_BG = ['#7c6aff', '#ff6a9f', '#22d3ee', '#4ade80', '#fb923c', '#f472b6', '#818cf8', '#2dd4bf'];
function avatarBg(name: string): string {
  const hash = (name ?? '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_BG[hash % AVATAR_BG.length];
}

export default function FriendRequestsScreen() {
  const router = useRouter();
  const { account } = useApp();
  const [tab, setTab] = useState<Tab>('incoming');
  const { incoming, outgoing, loading, accept, decline, cancel } = useFriendRequests();

  const data = useMemo(() => (tab === 'incoming' ? incoming : outgoing), [tab, incoming, outgoing]);

  function handleOpenProfile(req: FriendRequest) {
    if (!req.other_user_id || !canAccessProfile(account)) return;
    router.push(`/user/${req.other_user_id}` as never);
  }

  function renderRow({ item }: { item: FriendRequest }) {
    const name    = item.other_display_name ?? '?';
    const initial = name[0]?.toUpperCase() ?? '?';
    const photo   = item.other_photo_url ?? null;

    return (
      <TouchableOpacity style={styles.row} activeOpacity={0.85} onPress={() => handleOpenProfile(item)}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: avatarBg(name), alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
        )}

        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {tab === 'incoming' ? 'wants to be your friend' : 'request sent'}
          </Text>
        </View>

        {tab === 'incoming' ? (
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btnDecline} onPress={() => decline(item.id)} activeOpacity={0.8}>
              <Text style={styles.btnDeclineText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnAccept} onPress={() => accept(item.id)} activeOpacity={0.85}>
              <Text style={styles.btnAcceptText}>Accept</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.btnCancel} onPress={() => cancel(item.id)} activeOpacity={0.8}>
            <Text style={styles.btnCancelText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Friend requests</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'incoming' && styles.tabActive]}
          onPress={() => setTab('incoming')}
          activeOpacity={0.85}
        >
          <Text style={[styles.tabText, tab === 'incoming' && styles.tabTextActive]}>
            Incoming{incoming.length > 0 ? ` · ${incoming.length}` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'sent' && styles.tabActive]}
          onPress={() => setTab('sent')}
          activeOpacity={0.85}
        >
          <Text style={[styles.tabText, tab === 'sent' && styles.tabTextActive]}>
            Sent{outgoing.length > 0 ? ` · ${outgoing.length}` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : data.length === 0 ? (
        <View style={styles.center}>
          <Ionicons
            name={tab === 'incoming' ? 'person-add-outline' : 'paper-plane-outline'}
            size={36}
            color={Colors.muted2}
          />
          <Text style={styles.emptyTitle}>
            {tab === 'incoming' ? 'No friend requests yet' : "You haven't sent any"}
          </Text>
          <Text style={styles.emptySub}>
            {tab === 'incoming'
              ? "When someone asks to be your friend, you'll see it here."
              : 'Pending friend requests you sent will show up here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(r) => r.id}
          renderItem={renderRow}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text },

  tabs: { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, gap: 8 },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: Colors.bg2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  tabText: { color: Colors.muted, fontWeight: '600', fontSize: FontSizes.sm },
  tabTextActive: { color: Colors.white },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, gap: 6 },
  emptyTitle: { color: Colors.text, fontWeight: '700', fontSize: FontSizes.md, marginTop: 8 },
  emptySub: { color: Colors.muted, fontSize: FontSizes.sm, textAlign: 'center', maxWidth: 280 },

  listContent: { paddingVertical: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 12,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.bg3 },
  avatarInitial: { color: Colors.white, fontWeight: '700', fontSize: 18 },
  body: { flex: 1, minWidth: 0 },
  name: { color: Colors.text, fontWeight: '700', fontSize: FontSizes.md },
  sub:  { color: Colors.muted, fontSize: FontSizes.sm, marginTop: 1 },

  actions: { flexDirection: 'row', gap: 8 },
  btnDecline: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
  },
  btnDeclineText: { color: Colors.muted, fontWeight: '600', fontSize: FontSizes.sm },
  btnAccept: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: Radius.full,
    backgroundColor: Colors.accent,
  },
  btnAcceptText: { color: Colors.white, fontWeight: '700', fontSize: FontSizes.sm },
  btnCancel: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
  },
  btnCancelText: { color: Colors.muted, fontWeight: '600', fontSize: FontSizes.sm },

  separator: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border, marginLeft: Spacing.md + 44 + 12 },
});
