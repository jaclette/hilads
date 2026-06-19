/**
 * ChallengeMembersPeek - a lightweight "who joined" list, opened by tapping the
 * participant avatar stack on a challenge card. Read-only (no kick/management -
 * that lives in the detail's ChallengeChannelMembersSheet). Tapping a row opens
 * that user's profile.
 */

import { useEffect, useState } from 'react';
import {
  Modal, View, Text, Pressable, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { fetchChallengeParticipants } from '@/api/challenges';
import { avatarColor } from '@/lib/avatarColors';
import type { Challenge } from '@/types';
import { Colors, FontSizes, Spacing } from '@/constants';

// The card preview is camelCase ({displayName, thumbAvatarUrl}); the
// /participants endpoint is snake_case ({display_name, profile_photo_url}).
// Normalise both so names + avatars always render.
type Member = { id: string; name: string; photo: string | null };
function toMember(u: Record<string, unknown>): Member {
  return {
    id:    String(u.id ?? ''),
    name:  String(u.displayName ?? u.display_name ?? '?'),
    photo: (u.thumbAvatarUrl ?? u.avatarUrl ?? u.profile_thumb_photo_url ?? u.profile_photo_url ?? null) as string | null,
  };
}

export function ChallengeMembersPeek({
  challenge, onClose, onSelect,
}: {
  challenge: Challenge | null;
  onClose:   () => void;
  onSelect:  (userId: string) => void;
}) {
  const { t } = useTranslation('challenge');
  const [users,   setUsers]   = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!challenge) return;
    let alive = true;
    setLoading(true);
    // Seed from the card's preview so something shows instantly, then refresh.
    setUsers((challenge.participants_preview ?? []).map((u) => toMember(u as unknown as Record<string, unknown>)));
    fetchChallengeParticipants(challenge.id)
      .then((r) => { if (alive) setUsers((r.participants ?? []).map((u) => toMember(u as unknown as Record<string, unknown>))); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [challenge]);

  return (
    <Modal visible={!!challenge} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>
          👥 {t('card.whoJoined', { count: challenge?.participant_count ?? users.length, defaultValue: 'Who joined ({{count}})' })}
        </Text>

        {loading && users.length === 0 ? (
          <View style={styles.center}><ActivityIndicator color={Colors.muted} /></View>
        ) : users.length === 0 ? (
          <Text style={styles.empty}>{t('group.noParticipants', { defaultValue: 'Nobody has joined yet.' })}</Text>
        ) : (
          <FlatList
            data={users}
            keyExtractor={(u) => u.id}
            style={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => onSelect(item.id)}>
                <View style={[styles.avatar, { backgroundColor: avatarColor(item.id) }]}>
                  {item.photo
                    ? <Image source={{ uri: item.photo }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                    : <Text style={styles.avatarLetter}>{(item.name[0] ?? '?').toUpperCase()}</Text>}
                </View>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: Spacing.lg, paddingTop: 10, paddingBottom: 34, maxHeight: '70%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, marginBottom: 12 },
  title:  { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  center: { paddingVertical: 24, alignItems: 'center' },
  empty:  { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', paddingVertical: 24 },
  list:   { maxHeight: 380 },
  row:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarLetter: { color: '#fff', fontWeight: '700', fontSize: 15 },
  name:   { flex: 1, fontSize: FontSizes.md, fontWeight: '600', color: Colors.text },
});
