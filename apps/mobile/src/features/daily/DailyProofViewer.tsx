import { Modal, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { CityName } from '@/ui';
import { formatAmount } from './currency';
import { DailyVoteButton } from './DailyVoteButton';
import { LocalPassBadge } from './LocalPassBadge';
import { EarlyBadge } from './EarlyBadge';
import { RankMedal } from './RankMedal';
import { Chip, IconButton, ModeLabel } from '@/ui';
import type { DailyProof } from '@/types';

/** Full-screen photo of one proof with its author, caption, price, place, local badge and vote. */
export function DailyProofViewer({ proof, onClose }: { proof: DailyProof | null; onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  if (!proof) return null;
  const name = proof.user.displayName || proof.user.username || '';
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={styles.wrap}>
        <IconButton icon="close" tone="onPhoto" onPress={onClose} label={t('back')} style={styles.close} />
        <Image source={{ uri: proof.photoUrl }} style={styles.photo} contentFit="contain" />
        <View style={styles.meta}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{name}</Text>
            <ModeLabel mode={proof.isLocal ? 'local' : 'traveler'} label={proof.isLocal ? t('local') : t('traveler')} />
            {proof.user.localPass && <LocalPassBadge label onDark />}
            {proof.isEarly && <EarlyBadge onDark />}
          </View>
          {proof.city && <CityName name={proof.city.name} country={proof.city.country} style={styles.extra} />}
          {(proof.validatedByLocal || (proof.worldRank !== null && proof.worldRank <= 3)) && (
            <View style={styles.nameRow}>
              {proof.worldRank !== null && proof.worldRank <= 3 && (
                <View style={styles.rankRow}>
                  <RankMedal rank={proof.worldRank} size={22} />
                  <Text style={styles.rankText}>{t('results.worldRank', { rank: proof.worldRank })}</Text>
                </View>
              )}
              {proof.validatedByLocal && <Chip tone="local" icon="checkmark" label={t('validatedByLocal')} />}
            </View>
          )}
          {!!proof.caption && <Text style={styles.caption}>{proof.caption}</Text>}
          {(proof.price || proof.place) && (
            <View style={styles.nameRow}>
              {proof.price && (
                <View style={styles.extraRow}>
                  <Ionicons name="cash-outline" size={15} color={colors.onCaramelMuted} />
                  <Text style={styles.extra}>{formatAmount(proof.price.amount, i18n.language)} {proof.price.currency}</Text>
                </View>
              )}
              {proof.place && (
                <View style={styles.extraRow}>
                  <Ionicons name="location-outline" size={15} color={colors.onCaramelMuted} />
                  <Text style={styles.extra}>{proof.place.name || t('unnamedPlace')}</Text>
                </View>
              )}
            </View>
          )}
          {proof.status === 'approved' && (
            <DailyVoteButton proofId={proof.id} date={proof.date} cityName={proof.city?.name ?? null} variant="viewer" />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// A photo viewer is dark in both themes, like every photo lightbox (fixed photo tokens).
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:     { flex: 1, backgroundColor: c.photoScrim },
  close:    { position: 'absolute', top: 54, right: 16, zIndex: 2 },
  photo:    { flex: 1 },
  meta:     { padding: 16, gap: 8 },
  nameRow:  { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  name:     { color: c.white, fontSize: FontSizes.md, fontWeight: '800' },
  rankRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rankText: { color: c.white, fontSize: FontSizes.xs, fontWeight: '700' },
  caption:  { color: c.white, fontSize: FontSizes.sm, fontWeight: '400' },
  extraRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  extra:    { color: c.onCaramelMuted, fontSize: FontSizes.xs, fontWeight: '500' },
});
