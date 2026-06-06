import { useCallback, useEffect, useState } from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Image } from 'expo-image';
import { fetchChannelParticipants, type ChannelMember } from '@/api/challenges';
import { avatarColor } from '@/lib/avatarColors';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { Challenge, UserDTO } from '@/types';

/**
 * Inline "X in the channel" strip — mounted on the challenge detail page
 * directly under the pipeline/proof block. Tap opens the full members
 * sheet (the parent already mounts ChallengeChannelMembersSheet). The
 * strip itself just renders avatars + count + a See all chevron.
 *
 * Synthesizes Challenger + Taker rows from the challenge + acceptance
 * context so the avatar preview is role-aware — matches the modal's
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
      displayName:    m?.displayName ?? challenge?.creator_display_name ?? '—',
      thumbAvatarUrl: m?.thumbAvatarUrl ?? challenge?.creator_thumb_avatar_url ?? null,
    });
  }
  if (takerUserId && takerUserId !== creatorUserId) {
    const m = members.find(mm => mm.id === takerUserId);
    preview.push({
      id:             takerUserId,
      displayName:    m?.displayName ?? activeTaker?.displayName ?? '—',
      thumbAvatarUrl: m?.thumbAvatarUrl ?? activeTaker?.thumbAvatarUrl ?? activeTaker?.avatarUrl ?? null,
    });
  }
  for (const m of members) {
    if (m.id === creatorUserId || m.id === takerUserId) continue;
    preview.push({ id: m.id, displayName: m.displayName ?? '—', thumbAvatarUrl: m.thumbAvatarUrl });
    if (preview.length >= 5) break;
  }
  // Total includes synthesized rows (challenger + taker) that aren't in
  // the join table — match the modal's count.
  const synthesized = (creatorUserId ? 1 : 0) + (takerUserId && takerUserId !== creatorUserId ? 1 : 0);
  const total = count + synthesized;

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
              <Image source={{ uri: p.thumbAvatarUrl }} style={StyleSheet.absoluteFill} cachePolicy="memory-disk" contentFit="cover" />
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

const styles = StyleSheet.create({
  strip: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             10,
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.sm + 2,
    borderTopWidth:    StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor:       'rgba(255,255,255,0.06)',
  },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  avatar:  {
    width:           28, height: 28, borderRadius: 14,
    alignItems:      'center', justifyContent: 'center',
    overflow:        'hidden',
    borderWidth:     2, borderColor: Colors.bg,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  countLabel: { flex: 1, fontSize: FontSizes.sm, color: Colors.text, fontWeight: '600' },
  seeAll:     { fontSize: FontSizes.sm, color: '#FF7A3C', fontWeight: '700' },
});
