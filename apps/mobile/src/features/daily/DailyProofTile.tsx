import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { localizeCityName } from '@/i18n/cityName';
import { DailyVoteButton } from './DailyVoteButton';
import { LocalPassBadge } from './LocalPassBadge';
import { EarlyBadge } from './EarlyBadge';
import { RankMedal } from './RankMedal';
import { Chip, ModeLabel } from '@/ui';
import type { DailyProof } from '@/types';

/** One proof in the sheet grid: photo (rank seal if World top 3), author with Local/Traveler, city, caption, vote. */
export function DailyProofTile({ proof, onPress }: { proof: DailyProof; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const name = proof.user.displayName || proof.user.username || '';
  return (
    <TouchableOpacity style={styles.tile} onPress={onPress} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`${name} ${proof.caption ?? ''}`}>
      <Image source={{ uri: proof.thumbUrl ?? proof.photoUrl }} style={styles.photo} contentFit="cover" transition={150} />
      {proof.worldRank !== null && proof.worldRank <= 3 && <RankMedal rank={proof.worldRank} style={styles.medal} />}
      <View style={styles.meta}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {proof.user.localPass && <LocalPassBadge />}
        </View>
        <View style={styles.labels}>
          <ModeLabel mode={proof.isLocal ? 'local' : 'traveler'} label={proof.isLocal ? t('local') : t('traveler')} />
          {proof.isEarly && <EarlyBadge />}
        </View>
        {proof.city && <Text style={styles.sub} numberOfLines={1}>{localizeCityName(proof.city.name)}</Text>}
        {proof.validatedByLocal && <Chip tone="local" icon="checkmark" label={t('validatedByLocal')} style={styles.badge} />}
        {!!proof.caption && <Text style={styles.caption} numberOfLines={2}>{proof.caption}</Text>}
        <View style={styles.voteRow}>
          <DailyVoteButton proofId={proof.id} date={proof.date} cityName={proof.city?.name ?? null} variant="tile" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  tile:    { flex: 1, backgroundColor: c.bg2, borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, overflow: 'hidden' },
  photo:   { width: '100%', aspectRatio: 1, backgroundColor: c.bg3 },
  meta:    { padding: 10, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name:    { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '800', color: c.text },
  labels:  { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  sub:     { fontSize: 12, fontWeight: '500', color: c.muted },
  badge:   { alignSelf: 'flex-start' },
  caption: { fontSize: FontSizes.xs, fontWeight: '400', color: c.text, marginTop: 2 },
  medal:   { position: 'absolute', top: 8, left: 8 },
  voteRow: { marginTop: 4 },
});
