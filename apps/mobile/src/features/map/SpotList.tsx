import { Text, View, StyleSheet } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Space, Radius, Gutter, Type, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { themeName } from '@/features/daily/themes';
import { compactPrice, distance, meters } from '@/features/today/format';
import { ThemeIcon } from '@/ui/ThemeIcon';
import type { Spot } from '@/api/spots';
import { PickBadge } from './PickBadge';
import { Chip, Tappable } from '@/ui';
import { themeColor, tint } from '@/ui/joy';
import { thumbUrl } from '@/lib/imageThumb';

export type SpotSort = 'near' | 'liked' | 'new';

/** Spots sorted by distance from `origin` (me, else the area's centre), likes, or the latest photo. Pure. */
export function sortSpots(spots: Spot[], sort: SpotSort, origin: [number, number] | null): Spot[] {
  const out = [...spots];
  if (sort === 'liked') {
    out.sort((a, b) => b.votes - a.votes || b.votesWeek - a.votesWeek || b.proofCount - a.proofCount);
  } else if (sort === 'new') {
    out.sort((a, b) => (b.lastProofDate ?? '').localeCompare(a.lastProofDate ?? '') || b.votes - a.votes);
  } else if (origin) {
    out.sort((a, b) => meters(origin, [a.lng, a.lat]) - meters(origin, [b.lng, b.lat]));
  }
  return out;
}

/** The sort chips: Nearest · Most liked · Newest, one row that scrolls sideways (long labels never wrap or cut). */
export function SortChips({ sort, onSort }: { sort: SpotSort; onSort: (s: SpotSort) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sorts} testID="map-sort-chips">
      <Chip variant="filter" label={t('map.sortNearest')} selected={sort === 'near'} onPress={() => onSort('near')} />
      <Chip variant="filter" label={t('map.sheet.sortLiked')} selected={sort === 'liked'} onPress={() => onSort('liked')} />
      <Chip variant="filter" label={t('map.sheet.sortNew')} selected={sort === 'new'} onPress={() => onSort('new')} />
    </ScrollView>
  );
}

/**
 * A spot in the map's sheet list (SPEC 9.5, V6): its photo, name, theme,
 * "validated by a local", distance (when my position is known), median price,
 * likes and who took the cover photo. Tapping flies the map to its pin.
 */
export function SpotRow({ spot: s, me, onPick }: { spot: Spot; me: [number, number] | null; onPick: (s: Spot) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors, theme: mode } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const theme = s.themes[0] ?? null;
  // The theme's own pair (design pass): its text color on its soft tint, like the pins and filters.
  const tc = theme ? themeColor(theme) : null;
  const ink = tc ? (mode === 'dark' ? tc.textDark : tc.textLight) : colors.primaryOnTint;
  const median = s.priceRange ? (s.priceRange.median ?? (s.priceRange.min === s.priceRange.max ? s.priceRange.min : null)) : null;
  const meta = [
    me ? distance(meters(me, [s.lng, s.lat]), i18n.language) : null,
    median !== null && s.priceRange ? compactPrice(median, s.priceRange.currency, i18n.language) : null,
  ].filter(Boolean).join(' · ');
  return (
    <Tappable style={styles.row} onPress={() => onPick(s)} accessibilityRole="button" accessibilityLabel={s.name} testID="spot-row">
      {s.cover.thumbUrl || s.cover.photoUrl
        ? <Image source={{ uri: thumbUrl(s.cover.thumbUrl ?? s.cover.photoUrl) }} style={styles.photo} contentFit="cover" />
        : <View style={[styles.photo, styles.photoEmpty]}><ThemeIcon theme={theme ?? 'only_here'} size={22} color={colors.primaryText} /></View>}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
        <View style={styles.chips}>
          {!!s.pick && <PickBadge />}
          {theme && (
            <View style={[styles.theme, tc && { backgroundColor: tint(tc.fill, mode === 'dark' ? 0.2 : 0.22) }]}>
              <ThemeIcon theme={theme} size={14} color={ink} />
              <Text style={[styles.themeText, { color: ink }]} numberOfLines={1}>{themeName(theme)}</Text>
            </View>
          )}
          {s.validatedByLocal && (
            <View style={styles.local}>
              <Ionicons name="checkmark" size={14} color={colors.localText} />
              <Text style={styles.localText} numberOfLines={1}>{t('map.validated')}</Text>
            </View>
          )}
        </View>
        <View style={styles.metaRow}>
          {!!meta && <Text style={styles.meta} numberOfLines={1}>{meta}</Text>}
          <View style={styles.votes}>
            <Ionicons name="heart" size={14} color={colors.primary} />
            <Text style={styles.meta}>{s.votes}</Text>
          </View>
          {!!s.cover.by && <Text style={styles.meta} numberOfLines={1}>@{s.cover.by}</Text>}
        </View>
      </View>
    </Tappable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sorts:      { flexDirection: 'row', gap: Space.sm, paddingHorizontal: Gutter, paddingVertical: Space.sm },
  row:        { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 76, paddingHorizontal: Gutter, paddingVertical: Space.md },
  photo:      { width: 64, height: 64, borderRadius: Radius.inner, backgroundColor: c.bg3 },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  body:       { flex: 1, minWidth: 0, gap: Space.xs },
  name:       { ...Type.body, fontWeight: '800', color: c.text },
  chips:      { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  theme:      { flexDirection: 'row', alignItems: 'center', gap: Space.xs, paddingHorizontal: Space.sm, paddingVertical: Space.xxs, borderRadius: Radius.control, backgroundColor: c.primaryTint },
  themeText:  { ...Type.caption, fontWeight: '700' },
  local:      { flexDirection: 'row', alignItems: 'center', gap: Space.xs, paddingHorizontal: Space.sm, paddingVertical: Space.xxs, borderRadius: Radius.control, backgroundColor: c.localBg },
  localText:  { ...Type.caption, fontWeight: '700', color: c.localText },
  metaRow:    { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  meta:       { ...Type.caption, fontWeight: '500', color: c.muted },
  votes:      { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
});
