import { thumbUrl } from '@/lib/imageThumb';
import { useCallback, useEffect, useState } from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Image } from 'expo-image';
import { socket } from '@/lib/socket';
import { fetchChannelParticipants, type ChannelMember } from '@/api/challenges';
import { avatarColor } from '@/lib/avatarColors';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import type { Challenge, UserDTO } from '@/types';

/**
 * Inline "X in the channel" strip - mounted on the challenge detail page
 * directly under the pipeline/proof block. Tap opens the full members
 * sheet (the parent already mounts ChallengeChannelMembersSheet). The
 * strip itself just renders avatars + count + a See all chevron.
 *
 * Synthesizes Challenger + Taker rows from the challenge + acceptance
 * context so the avatar preview is role-aware - matches the modal's
 * head rows.
 */
export function ChallengeChannelMembersStrip({
  challenge,
  activeTaker,
  onOpen,
}: {
  challenge:   Challenge;
  activeTaker: UserDTO | null;
  onOpen:      () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('challenge');
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [count,   setCount]   = useState(0);

  const load = useCallback(async () => {
    if (!challenge?.id) return;
    const res = await fetchChannelParticipants(challenge.id);
    setMembers(res?.members ?? []);
    setCount(res?.count ?? 0);
  }, [challenge?.id]);

  useEffect(() => { load(); }, [load]);

  // Live: reload when someone joins / leaves this challenge so the "X in the
  // channel" strip grows without an app restart. The server pings the creator's
  // user-room with challenge_accepted on every group join.
  useEffect(() => {
    if (!challenge?.id) return;
    const onChange = (data: Record<string, unknown>) => {
      const payload = data.payload as { challenge?: { id?: string }; challengeId?: string } | undefined;
      const evtId = payload?.challenge?.id ?? payload?.challengeId;
      if (evtId === challenge.id) void load();
    };
    const offA = socket.on('challenge_accepted',             onChange);
    const offC = socket.on('challenge_acceptance_cancelled', onChange);
    const offL = socket.on('challenge_acceptor_left',        onChange);
    return () => { offA(); offC(); offL(); };
  }, [challenge?.id, load]);

  // Preview: Challenger first, Taker second, then joined participants.
  // 5-avatar preview to match the events / city-roster pattern.
  const creatorUserId = challenge?.created_by ?? null;
  const takerUserId   = activeTaker?.id ?? null;
  type PreviewRow = { id: string; displayName: string; thumbAvatarUrl: string | null };
  const preview: PreviewRow[] = [];
  if (creatorUserId) {
    const m = members.find(mm => mm.id === creatorUserId);
    preview.push({
      id:             creatorUserId,
      displayName:    m?.displayName ?? challenge?.creator_display_name ?? '-',
      thumbAvatarUrl: m?.thumbAvatarUrl ?? challenge?.creator_thumb_avatar_url ?? null,
    });
  }
  if (takerUserId && takerUserId !== creatorUserId) {
    const m = members.find(mm => mm.id === takerUserId);
    preview.push({
      id:             takerUserId,
      displayName:    m?.displayName ?? activeTaker?.displayName ?? '-',
      thumbAvatarUrl: m?.thumbAvatarUrl ?? activeTaker?.thumbAvatarUrl ?? activeTaker?.avatarUrl ?? null,
    });
  }
  for (const m of members) {
    if (m.id === creatorUserId || m.id === takerUserId) continue;
    preview.push({ id: m.id, displayName: m.displayName ?? '-', thumbAvatarUrl: m.thumbAvatarUrl });
    if (preview.length >= 5) break;
  }
  // Total = unique participants. The creator and the taker auto-join the
  // channel on create / accept, so they're typically IN the join table -
  // simply summing `count + synthesized` double-counts them. Match the web
  // modal's behaviour (ChallengeChannelMembers.jsx): only add a synthesized
  // row when that user_id is NOT already in the members list.
  // (`count` parity with the API is preserved for callers that ever need
  // the raw join-table count; we don't expose it here.)
  void count;
  const memberIds = new Set(members.map(m => m.id));
  let total = members.length;
  if (creatorUserId && !memberIds.has(creatorUserId)) total += 1;
  if (takerUserId && takerUserId !== creatorUserId && !memberIds.has(takerUserId)) total += 1;

  if (preview.length === 0) return null;

  return (
    <TouchableOpacity style={styles.strip} onPress={onOpen} activeOpacity={0.75}>
      <View style={styles.avatars}>
        {preview.slice(0, 5).map((p, i) => (
          <View
            key={p.id}
            style={[styles.avatar, { marginLeft: i === 0 ? 0 : -8, backgroundColor: avatarColor(p.id) }]}
          >
            {p.thumbAvatarUrl ? (
              <Image source={{ uri: thumbUrl(p.thumbAvatarUrl) }} style={StyleSheet.absoluteFill} cachePolicy="memory-disk" contentFit="cover" />
            ) : (
              <Text style={styles.avatarText}>{(p.displayName?.[0] ?? '?').toUpperCase()}</Text>
            )}
          </View>
        ))}
      </View>
      <Text style={styles.countLabel}>{t('members.countIn', { count: total })}</Text>
      <Text style={styles.seeAll}>{t('members.seeAll')}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  strip: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             10,
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.sm + 2,
    borderTopWidth:    StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor:       c.overlay,
  },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  avatar:  {
    width:           28, height: 28, borderRadius: 14,
    alignItems:      'center', justifyContent: 'center',
    overflow:        'hidden',
    borderWidth:     2, borderColor: c.bg,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  countLabel: { flex: 1, fontSize: FontSizes.sm, color: c.text, fontWeight: '600' },
  seeAll:     { fontSize: FontSizes.sm, color: '#FF7A3C', fontWeight: '700' },
});
