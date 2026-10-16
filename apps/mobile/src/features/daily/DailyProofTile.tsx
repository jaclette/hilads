import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { localizeCityName } from '@/i18n/cityName';
import { DailyVoteButton } from './DailyVoteButton';
import { LocalPassBadge } from './LocalPassBadge';
import type { DailyProof } from '@/types';

export const MEDALS = ['🥇', '🥈', '🥉'];

/** One proof in the sheet grid: photo (medal if World top 3), author with Local/Traveler, city, caption, vote. */
export function DailyProofTile({ proof, onPress }: { proof: DailyProof; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const name = proof.user.displayName || proof.user.username || '';
  return (
    <TouchableOpacity style={styles.tile} onPress={onPress} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`${name} ${proof.caption ?? ''}`}>
      <Image source={{ uri: proof.thumbUrl ?? proof.photoUrl }} style={styles.photo} contentFit="cover" transition={150} />
      {proof.worldRank !== null && proof.worldRank <= 3 && <Text style={styles.medal}>{MEDALS[proof.worldRank - 1]}</Text>}
      <View style={styles.meta}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {proof.user.localPass && <LocalPassBadge />}
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {proof.isLocal ? `🌍 ${t('local')}` : `🧭 ${t('traveler')}`}
          {proof.city ? ` · ${localizeCityName(proof.city.name)}` : ''}
        </Text>
        {proof.validatedByLocal && <Text style={styles.badge} numberOfLines={1}>✓ {t('validatedByLocal')}</Text>}
        {!!proof.caption && <Text style={styles.caption} numberOfLines={2}>{proof.caption}</Text>}
        <View style={styles.voteRow}>
          <DailyVoteButton proofId={proof.id} date={proof.date} cityName={proof.city?.name ?? null} variant="tile" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  tile:    { flex: 1, backgroundColor: c.bg2, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, overflow: 'hidden' },
  photo:   { width: '100%', aspectRatio: 1, backgroundColor: c.bg3 },
  meta:    { padding: 8, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name:    { flexShrink: 1, fontSize: FontSizes.xs, fontWeight: '700', color: c.text },
  sub:     { fontSize: 11, color: c.muted },
  badge:   { fontSize: 11, fontWeight: '700', color: c.green },
  caption: { fontSize: FontSizes.xs, color: c.text, marginTop: 2 },
  medal:   { position: 'absolute', top: 6, left: 6, fontSize: 22 },
  voteRow: { marginTop: 4 },
});
