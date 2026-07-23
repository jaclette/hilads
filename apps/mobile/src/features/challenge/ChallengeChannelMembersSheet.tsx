import { thumbUrl } from '@/lib/imageThumb';
import { useCallback, useEffect, useState } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { fetchChannelParticipants, kickChallengeParticipant, type ChannelMember } from '@/api/challenges';
import { avatarColor } from '@/lib/avatarColors';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import type { Challenge, UserDTO } from '@/types';

/**
 * Members sheet for the challenge channel. Synthesizes Challenger + Taker
 * rows at the head from the challenge/acceptance context (they're not in
 * the channel-participants list - they're implicit), then lists joined
 * participants in join order. Kick button surfaces for creator + active
 * taker, never on the caller's own row, never on the creator.
 */
type Props = {
  visible:        boolean;
  challenge:      Challenge;
  activeTaker:    UserDTO | null;
  currentUserId:  string | null;
  isCreator:      boolean;
  isActiveTaker:  boolean;
  onClose:        () => void;
  onSelect:       (userId: string) => void;
  onMembersChanged?: () => void;
};

type Row = {
  id:             string;
  displayName:    string;
  thumbAvatarUrl: string | null;
  role:           'challenger' | 'taker' | 'participant';
};

export function ChallengeChannelMembersSheet({
  visible, challenge, activeTaker, currentUserId,
  isCreator, isActiveTaker, onClose, onSelect, onMembersChanged,
}: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('challenge');
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [count,   setCount]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [busyId,  setBusyId]  = useState<string | null>(null);

  const canKick = isCreator || isActiveTaker;
  const creatorUserId = challenge?.created_by ?? null;
  const takerUserId   = activeTaker?.id ?? null;
  // In a GROUP challenge everyone who joined is a taker (multiple coexist);
  // legacy 1-1 keeps a single active taker, the rest are spectators.
  const isGroup       = (challenge?.challenge_format ?? 'legacy') === 'group';

  const load = useCallback(async () => {
    if (!visible || !challenge?.id) return;
    setLoading(true);
    try {
      const res = await fetchChannelParticipants(challenge.id);
      setMembers(res?.members ?? []);
      setCount(res?.count ?? 0);
    } finally {
      setLoading(false);
    }
  }, [visible, challenge?.id]);

  useEffect(() => { load(); }, [load]);

  async function handleKick(memberId: string, displayName: string) {
    if (busyId) return;
    setBusyId(memberId);
    try {
      await kickChallengeParticipant(challenge.id, memberId);
      setMembers(prev => prev.filter(m => m.id !== memberId));
      setCount(c => Math.max(0, c - 1));
      onMembersChanged?.();
    } catch {
      Alert.alert(t('members.errKick'), '');
    } finally {
      setBusyId(null);
    }
    void displayName;
  }

  // Compose role-aware rows: Challenger first, Taker second, then joined
  // members in order (excluding any duplicates of those two roles).
  const rows: Row[] = [];
  if (creatorUserId) {
    const fromMembers = members.find(m => m.id === creatorUserId);
    rows.push({
      id:             creatorUserId,
      displayName:    fromMembers?.displayName ?? challenge?.creator_display_name ?? '-',
      thumbAvatarUrl: fromMembers?.thumbAvatarUrl ?? challenge?.creator_thumb_avatar_url ?? null,
      role:           'challenger',
    });
  }
  if (takerUserId && takerUserId !== creatorUserId) {
    const fromMembers = members.find(m => m.id === takerUserId);
    rows.push({
      id:             takerUserId,
      displayName:    fromMembers?.displayName ?? activeTaker?.displayName ?? '-',
      thumbAvatarUrl: fromMembers?.thumbAvatarUrl ?? activeTaker?.thumbAvatarUrl ?? activeTaker?.avatarUrl ?? null,
      role:           'taker',
    });
  }
  for (const m of members) {
    if (m.id === creatorUserId || m.id === takerUserId) continue;
    rows.push({
      id:             m.id,
      displayName:    m.displayName ?? '-',
      thumbAvatarUrl: m.thumbAvatarUrl,
      role:           isGroup ? 'taker' : 'participant',
    });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>👥 {t('members.countIn', { count: rows.length || count })}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {loading ? (
            <ActivityIndicator color={colors.muted} style={{ marginVertical: Spacing.lg }} />
          ) : rows.length === 0 ? (
            <Text style={styles.empty}>{t('members.empty')}</Text>
          ) : (
            rows.map(r => {
              const showKick = canKick && r.role !== 'challenger' && r.id !== currentUserId;
              return (
                <View key={r.id} style={styles.row}>
                  <TouchableOpacity
                    style={styles.rowMain}
                    activeOpacity={0.7}
                    onPress={() => onSelect(r.id)}
                  >
                    <View style={[styles.avatar, { backgroundColor: avatarColor(r.id) }]}>
                      {r.thumbAvatarUrl ? (
                        <Image
                          source={{ uri: thumbUrl(r.thumbAvatarUrl) }}
                          style={StyleSheet.absoluteFill}
                          cachePolicy="memory-disk"
                          contentFit="cover"
                        />
                      ) : (
                        <Text style={styles.avatarText}>
                          {(r.displayName?.[0] ?? '?').toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <View style={styles.rowInfo}>
                      <View style={styles.nameRow}>
                        <Text style={styles.name} numberOfLines={1}>{r.displayName}</Text>
                        {/* PR23 - every row carries a role chip:
                            Challenger / Taker stay as before, "participant"
                            (channel joiners with no acceptance) reads
                            Spectator. */}
                        <View style={[
                          styles.roleBadge,
                          r.role === 'challenger' ? styles.roleBadgeChallenger
                            : r.role === 'taker'  ? styles.roleBadgeTaker
                            : styles.roleBadgeSpectator,
                        ]}>
                          <Text style={[
                            styles.roleBadgeText,
                            r.role === 'challenger' ? styles.roleBadgeTextChallenger
                              : r.role === 'taker'  ? styles.roleBadgeTextTaker
                              : styles.roleBadgeTextSpectator,
                          ]}>
                            {t(`badge.${r.role === 'participant' ? 'spectator' : r.role}`)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                  {showKick && (
                    <TouchableOpacity
                      style={styles.kickBtn}
                      onPress={() => handleKick(r.id, r.displayName)}
                      disabled={busyId === r.id}
                      accessibilityLabel={t('members.kickAria', { name: r.displayName })}
                    >
                      {busyId === r.id
                        ? <ActivityIndicator size="small" color={colors.muted} />
                        : <Text style={styles.kickBtnText}>{t('members.kickCta')}</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: c.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '70%',
    backgroundColor: c.bg2,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    paddingBottom: Spacing.xl,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.overlayStrong, marginTop: 8, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  title:  { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  close:  { fontSize: 18, color: c.muted, fontWeight: '700' },
  list:   { paddingHorizontal: Spacing.md },
  listContent: { paddingBottom: Spacing.md },
  empty:  { color: c.muted, textAlign: 'center', marginVertical: Spacing.lg, fontStyle: 'italic' },

  row:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  rowMain:    { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  avatar:     { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: FontSizes.md },
  rowInfo:    { flex: 1, minWidth: 0 },
  nameRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name:       { fontSize: FontSizes.md, fontWeight: '600', color: c.text, flexShrink: 1 },

  roleBadge:  { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1 },
  roleBadgeChallenger: { backgroundColor: 'rgba(255,122,60,0.14)', borderColor: 'rgba(255,122,60,0.30)' },
  roleBadgeTaker:      { backgroundColor: 'rgba(74,222,128,0.12)',  borderColor: 'rgba(74,222,128,0.28)' },
  roleBadgeSpectator:  { backgroundColor: 'rgba(148,163,184,0.10)', borderColor: 'rgba(148,163,184,0.24)' },
  roleBadgeText:       { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  roleBadgeTextChallenger: { color: '#FFB37A' },
  roleBadgeTextTaker:      { color: '#4ADE80' },
  roleBadgeTextSpectator:  { color: '#94A3B8' },

  kickBtn:    { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: c.overlayStrong },
  kickBtnText:{ fontSize: 12, fontWeight: '700', color: c.muted },
});
