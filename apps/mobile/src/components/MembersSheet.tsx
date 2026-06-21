import { thumbUrl } from '@/lib/imageThumb';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import type { UserDTO, BadgeKey } from '@/types';
import { BADGE_META } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { avatarColor } from '@/lib/avatarColors';

// Bottom-sheet list of members/attendees, opened by tapping the avatar row on a
// NOW card (hangout or event). Tapping a registered member opens their profile.

type Props = {
  visible:      boolean;
  loading:      boolean;
  participants: UserDTO[];
  count:        number;
  noun:         string;   // "going" (events) | "in this hangout" (hangouts)
  onClose:      () => void;
  onSelect:     (userId: string) => void;
};

export function MembersSheet({ visible, loading, participants, count, noun, onClose, onSelect }: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>{count} {noun}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {loading ? (
            <ActivityIndicator color={Colors.muted} style={{ marginVertical: Spacing.lg }} />
          ) : participants.length === 0 ? (
            <Text style={styles.empty}>No one yet 🙌</Text>
          ) : (
            participants.map(p => {
              const isRegistered = p.accountType === 'registered';
              const badgeKey: BadgeKey | undefined = p.badges?.[0];
              const badgeMeta = badgeKey ? BADGE_META[badgeKey] : null;
              const avatar = p.thumbAvatarUrl ?? p.avatarUrl ?? null;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={styles.row}
                  onPress={isRegistered ? () => onSelect(p.id) : undefined}
                  activeOpacity={isRegistered ? 0.7 : 1}
                  disabled={!isRegistered}
                >
                  <View style={[styles.avatar, { backgroundColor: avatarColor(p.id) }]}>
                    {avatar ? (
                      <Image source={{ uri: thumbUrl(avatar) }} style={StyleSheet.absoluteFill} cachePolicy="memory-disk" contentFit="cover" />
                    ) : (
                      <Text style={styles.avatarText}>{(p.displayName?.[0] ?? '?').toUpperCase()}</Text>
                    )}
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.name} numberOfLines={1}>{p.displayName}</Text>
                    {p.username ? <Text style={styles.handleText} numberOfLines={1}>@{p.username}</Text> : null}
                  </View>
                  {badgeMeta && (
                    <View style={[styles.badge, { backgroundColor: badgeMeta.bg, borderColor: badgeMeta.border }]}>
                      <Text style={[styles.badgeText, { color: badgeMeta.color }]}>{badgeMeta.label}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '70%',
    backgroundColor: Colors.bg2,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    paddingBottom: Spacing.xl,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 8, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  title: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text },
  close: { fontSize: 18, color: Colors.muted, fontWeight: '700' },
  list: { paddingHorizontal: Spacing.md },
  listContent: { paddingBottom: Spacing.md },
  empty: { color: Colors.muted, textAlign: 'center', marginVertical: Spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: FontSizes.md },
  rowInfo: { flex: 1 },
  name: { fontSize: FontSizes.md, fontWeight: '600', color: Colors.text },
  handleText: { fontSize: FontSizes.sm, color: Colors.muted },
  badge: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700' },
});
