import { Modal, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { localizeCityName } from '@/i18n/cityName';
import { formatAmount } from './currency';
import { DailyVoteButton } from './DailyVoteButton';
import { MEDALS } from './DailyProofTile';
import type { DailyProof } from '@/types';

/** Full-screen photo of one proof with its author, caption, price, place, local badge and vote. */
export function DailyProofViewer({ proof, onClose }: { proof: DailyProof | null; onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('daily');
  if (!proof) return null;
  const name = proof.user.displayName || proof.user.username || '';
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={styles.wrap}>
        <TouchableOpacity style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('back')}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
        <Image source={{ uri: proof.photoUrl }} style={styles.photo} contentFit="contain" />
        <View style={styles.meta}>
          <Text style={styles.name}>
            {name} · {proof.isLocal ? `🌍 ${t('local')}` : `🧭 ${t('traveler')}`}
            {proof.city ? ` · ${localizeCityName(proof.city.name)}` : ''}
          </Text>
          {(proof.validatedByLocal || (proof.worldRank !== null && proof.worldRank <= 3)) && (
            <Text style={styles.badge}>
              {proof.worldRank !== null && proof.worldRank <= 3 ? `${MEDALS[proof.worldRank - 1]} ${t('results.worldRank', { rank: proof.worldRank })}` : ''}
              {proof.worldRank !== null && proof.worldRank <= 3 && proof.validatedByLocal ? '  ·  ' : ''}
              {proof.validatedByLocal ? `✓ ${t('validatedByLocal')}` : ''}
            </Text>
          )}
          {!!proof.caption && <Text style={styles.caption}>{proof.caption}</Text>}
          {(proof.price || proof.place) && (
            <Text style={styles.extra}>
              {proof.price ? `💸 ${formatAmount(proof.price.amount, i18n.language)} ${proof.price.currency}` : ''}
              {proof.price && proof.place ? '   ' : ''}
              {proof.place ? `📍 ${proof.place.name || t('unnamedPlace')}` : ''}
            </Text>
          )}
          {proof.status === 'approved' && (
            <DailyVoteButton proofId={proof.id} date={proof.date} cityName={proof.city?.name ?? null} variant="viewer" />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// A photo viewer is dark in both themes, like every photo lightbox.
const makeStyles = (_c: ThemeColors) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: '#000' },
  close:   { position: 'absolute', top: 54, right: 16, zIndex: 2, padding: 8 },
  photo:   { flex: 1 },
  meta:    { padding: 16, gap: 6 },
  name:    { color: '#fff', fontSize: FontSizes.sm, fontWeight: '700' },
  caption: { color: '#fff', fontSize: FontSizes.sm },
  extra:   { color: '#ccc', fontSize: FontSizes.xs },
  badge:   { color: '#7ee2a8', fontSize: FontSizes.xs, fontWeight: '700' },
});
