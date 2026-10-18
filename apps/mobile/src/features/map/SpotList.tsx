import { FlatList, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { themeName } from '@/features/daily/themes';
import { compactPrice, distance, meters } from '@/features/today/format';
import { ThemeIcon } from '@/ui/ThemeIcon';
import type { Spot } from '@/api/spots';
import { Chip } from '@/ui';

export type SpotSort = 'near' | 'week';

/** Spots sorted by distance from `origin` (me, else the area's centre) or by this week's votes. Pure. */
export function sortSpots(spots: Spot[], sort: SpotSort, origin: [number, number] | null): Spot[] {
  const out = [...spots];
  if (sort === 'week') {
    out.sort((a, b) => b.votesWeek - a.votesWeek || b.votes - a.votes || b.proofCount - a.proofCount);
  } else if (origin) {
    out.sort((a, b) => meters(origin, [a.lng, a.lat]) - meters(origin, [b.lng, b.lat]));
  }
  return out;
}

/**
 * The map's list view (SPEC 9.5): the spots of the area shown, with the
 * map's search and theme filter, sorted by distance or by this week's votes.
 * A row: proof photo, name, theme, distance (when my position is known),
 * median price paid, votes, "validated by a local". Tapping opens the sheet.
 */
export function SpotList({ spots, sort, onSort, me, origin, onPick, topInset, bottomInset, empty }: {
  spots: Spot[];
  sort: SpotSort;
  onSort: (s: SpotSort) => void;
  me: [number, number] | null;
  origin: [number, number] | null;
  onPick: (s: Spot) => void;
  topInset: number;
  bottomInset: number;
  empty: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const data = sortSpots(spots, sort, me ?? origin);

  return (
    <FlatList
      style={styles.list}
      data={data}
      keyExtractor={s => s.id}
      contentContainerStyle={{ paddingTop: topInset, paddingBottom: bottomInset }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={styles.sorts}>
          <Chip variant="filter" label={t('map.sortNearest')} selected={sort === 'near'} onPress={() => onSort('near')} />
          <Chip variant="filter" label={t('map.sortWeek')} selected={sort === 'week'} onPress={() => onSort('week')} />
        </View>
      }
      ListEmptyComponent={<>{empty}</>}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      renderItem={({ item: s }) => {
        const theme = s.themes[0] ?? null;
        const median = s.priceRange ? (s.priceRange.median ?? (s.priceRange.min === s.priceRange.max ? s.priceRange.min : null)) : null;
        const meta = [
          me ? distance(meters(me, [s.lng, s.lat]), i18n.language) : null,
          median !== null && s.priceRange ? compactPrice(median, s.priceRange.currency, i18n.language) : null,
        ].filter(Boolean).join(' · ');
        const votes = sort === 'week' ? s.votesWeek : s.votes;
        return (
          <TouchableOpacity style={styles.row} onPress={() => onPick(s)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={s.name}>
            {s.cover.thumbUrl || s.cover.photoUrl
              ? <Image source={{ uri: s.cover.thumbUrl ?? s.cover.photoUrl ?? undefined }} style={styles.photo} contentFit="cover" />
              : <View style={[styles.photo, styles.photoEmpty]}><ThemeIcon theme={theme ?? 'only_here'} size={22} color={colors.primaryText} /></View>}
            <View style={styles.body}>
              <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
              <View style={styles.chips}>
                {theme && (
                  <View style={styles.theme}>
                    <ThemeIcon theme={theme} size={12} color={colors.primaryOnTint} />
                    <Text style={styles.themeText} numberOfLines={1}>{themeName(theme)}</Text>
                  </View>
                )}
                {s.validatedByLocal && (
                  <View style={styles.local}>
                    <Ionicons name="checkmark" size={12} color={colors.localText} />
                    <Text style={styles.localText} numberOfLines={1}>{t('map.validated')}</Text>
                  </View>
                )}
              </View>
              <View style={styles.metaRow}>
                {!!meta && <Text style={styles.meta} numberOfLines={1}>{meta}</Text>}
                <View style={styles.votes}>
                  <Ionicons name="heart" size={12} color={colors.muted} />
                  <Text style={styles.meta}>{votes}</Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  list:       { ...StyleSheet.absoluteFillObject, backgroundColor: c.bg },
  sorts:      { flexDirection: 'row', gap: 8, paddingHorizontal: Spacing.md, paddingBottom: 10 },
  sep:        { height: 1, backgroundColor: c.line, marginLeft: Spacing.md + 64 + 12 },
  row:        { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 76, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  photo:      { width: 64, height: 64, borderRadius: Radius.md, backgroundColor: c.bg3 },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  body:       { flex: 1, minWidth: 0, gap: 4 },
  name:       { fontSize: FontSizes.sm, fontWeight: '800', color: c.text },
  chips:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  theme:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full, backgroundColor: c.primaryTint },
  themeText:  { fontSize: 12, fontWeight: '700', color: c.primaryOnTint },
  local:      { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full, backgroundColor: c.localBg },
  localText:  { fontSize: 12, fontWeight: '700', color: c.localText },
  metaRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meta:       { fontSize: 12, fontWeight: '600', color: c.muted },
  votes:      { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
