import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { themeName } from '@/features/daily/themes';
import { compactPrice, distance } from '@/features/today/format';
import { ThemeIcon } from '@/ui/ThemeIcon';
import type { Spot } from '@/api/spots';
import { Button, IconButton } from '@/ui';
import { PhotoCredit } from './PhotoCredit';

/**
 * The selected spot's card at the bottom of the map (map.html): photo, name,
 * theme, distance, price paid, "Validated by a local", proofs and votes, the
 * cover caption, then Open spot, Directions and Share (SPEC 9.14).
 */
export function SpotSheet({ spot, distanceM, onOpen, onDirections, onShare, onClose }: {
  spot: Spot; distanceM: number | null; onOpen: () => void; onDirections: () => void; onShare: () => void; onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const theme = spot.themes[0] ?? null;
  const price = spot.priceRange
    ? (spot.priceRange.min === spot.priceRange.max
        ? compactPrice(spot.priceRange.min, spot.priceRange.currency, i18n.language)
        : `${compactPrice(spot.priceRange.min, spot.priceRange.currency, i18n.language)}–${compactPrice(spot.priceRange.max, spot.priceRange.currency, i18n.language)}`)
    : null;

  return (
    <View style={styles.sheet} accessibilityLabel={t('map.selected', { name: spot.name })}>
      <TouchableOpacity style={styles.grabZone} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('map.closeSpot')}>
        <View style={styles.grabber} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.top} onPress={onOpen} activeOpacity={0.85} accessibilityRole="button">
        {spot.cover.thumbUrl || spot.cover.photoUrl
          ? <Image source={{ uri: spot.cover.photoUrl ?? spot.cover.thumbUrl ?? undefined }} style={styles.photo} contentFit="cover" />
          : <View style={styles.photo} />}
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={2}>{spot.name}</Text>
          <View style={styles.line}>
            {theme && (
              <View style={styles.inline}>
                <ThemeIcon theme={theme} size={14} color={colors.muted} />
                <Text style={styles.meta}>{themeName(theme)}</Text>
              </View>
            )}
            {distanceM !== null && <Text style={styles.meta}>{distance(distanceM, i18n.language)}</Text>}
          </View>
          {price && <Text style={styles.meta}>{t('map.pricePaid', { price })}</Text>}
          {spot.validatedByLocal && (
            <View style={styles.badge}>
              <Ionicons name="checkmark-circle-outline" size={14} color={colors.localText} />
              <Text style={styles.badgeText}>{t('map.validated')}</Text>
            </View>
          )}
          <Text style={styles.meta}>{t('map.proofs', { count: spot.proofCount })} · {t('today.votes', { count: spot.votes })}</Text>
        </View>
      </TouchableOpacity>
      {!!spot.cover.caption && <Text style={styles.caption} numberOfLines={2}>“{spot.cover.caption}”</Text>}
      <PhotoCredit by={spot.cover.by} style={styles.credit} />
      <View style={styles.actions}>
        <Button label={t('map.openSpot')} onPress={onOpen} style={styles.btn} />
        <Button variant="secondary" icon="navigate-outline" label={t('map.directions')} onPress={onDirections} style={styles.btn} />
        <IconButton icon="share-social-outline" label={t('share.title')} onPress={onShare} style={styles.share} />
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheet:        { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line, borderRadius: 24, paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  grabZone:     { alignItems: 'center', paddingTop: 10, paddingBottom: 2 },
  grabber:      { width: 36, height: 4, borderRadius: Radius.full, backgroundColor: c.line },
  top:          { flexDirection: 'row', gap: 12 },
  photo:        { width: 92, height: 92, borderRadius: 14, backgroundColor: c.primaryTint },
  info:         { flex: 1, gap: 4 },
  name:         { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  line:         { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 10 },
  inline:       { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta:         { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  badge:        { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full, backgroundColor: c.localBg },
  badgeText:    { fontSize: 12, fontWeight: '700', color: c.localText },
  caption:      { fontSize: FontSizes.sm, fontStyle: 'italic', color: c.text },
  credit:       { marginTop: -4 },
  actions:      { flexDirection: 'row', gap: 10 },
  btn:          { flex: 1 },
  share:        { alignSelf: 'center' },
});
