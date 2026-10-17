import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, Text, TouchableOpacity, View, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { directionsUrl, openMapsUrl } from '@/lib/directions';
import { fetchSpot, type SpotDetail, type SpotPhoto } from '@/api/spots';
import { THEME_NAMES } from '@/features/daily/themes';
import { THEME_ICON, compactPrice } from '@/features/today/format';

/**
 * A spot (SPEC 9.5): its proofs' photos, themes, price range paid, proof
 * count, votes, "validated by a local", dish tags, its city ranking ("Top voted
 * this week in Saigon"), the latest captions, Directions and "See on the map".
 * Readable without an account. Photos carry a date, never a time of day.
 */
export default function SpotScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { account, identity } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const { width } = useWindowDimensions();
  const [data, setData]       = useState<SpotDetail | null>(null);
  const [photos, setPhotos]   = useState<SpotPhoto[]>([]);
  const [next, setNext]       = useState<number | null>(null);
  const [failed, setFailed]   = useState(false);
  const [viewing, setViewing] = useState<SpotPhoto | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSpot(String(id), 0, guestId)
      .then(d => { if (!alive) return; setData(d); setPhotos(d.photos.items); setNext(d.photos.nextOffset); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [id, guestId]);

  const more = useCallback(() => {
    if (next === null || !data) return;
    const offset = next;
    setNext(null);
    fetchSpot(data.spot.id, offset, guestId)
      .then(d => { setPhotos(p => [...p, ...d.photos.items]); setNext(d.photos.nextOffset); })
      .catch(() => setNext(offset));
  }, [next, data, guestId]);

  const nav = (
    <View style={styles.nav}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('back')}>
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </TouchableOpacity>
      <Text style={styles.navTitle} numberOfLines={1}>{data?.spot.name ?? ''}</Text>
    </View>
  );

  if (failed) {
    return <SafeAreaView style={styles.container} edges={['top']}>{nav}<View style={styles.center}><Text style={styles.muted}>{t('spot.notFound')}</Text></View></SafeAreaView>;
  }
  if (!data) {
    return <SafeAreaView style={styles.container} edges={['top']}>{nav}<View style={styles.center}><ActivityIndicator color={colors.primary} /></View></SafeAreaView>;
  }

  const { spot, ranking, captions } = data;
  const cityName = ranking?.cityName ? localizeCityName(ranking.cityName) : spot.city?.name ? localizeCityName(spot.city.name) : '';
  const rankLine = ranking?.week === 1 ? t('spot.rankWeekFirst', { city: cityName })
    : ranking?.week ? t('spot.rankWeek', { rank: ranking.week, city: cityName })
    : ranking?.alltime === 1 ? t('spot.rankAlltimeFirst', { city: cityName })
    : ranking?.alltime ? t('spot.rankAlltime', { rank: ranking.alltime, city: cityName })
    : null;
  const price = spot.priceRange
    ? [spot.priceRange.min, spot.priceRange.max].filter((v, i, a) => a.indexOf(v) === i)
        .map(v => compactPrice(v, spot.priceRange!.currency, i18n.language)).join('–')
    : null;
  const tile = (width - Spacing.md * 2 - 8 * 2) / 3;

  const header = (
    <View style={styles.header}>
      {!!spot.cover.photoUrl && <Image source={{ uri: spot.cover.photoUrl }} style={styles.cover} contentFit="cover" />}
      <Text style={styles.name}>{spot.name}</Text>
      {!!cityName && <Text style={styles.muted}>{cityName}</Text>}
      {rankLine && (
        <View style={styles.rank}>
          <Ionicons name="trophy-outline" size={16} color={colors.primaryOnTint} />
          <Text style={styles.rankText}>{rankLine}</Text>
        </View>
      )}
      <View style={styles.chips}>
        {spot.themes.map(k => (
          <View key={k} style={styles.chip}>
            <Ionicons name={THEME_ICON[k]} size={14} color={colors.primaryOnTint} />
            <Text style={styles.chipText}>{THEME_NAMES[k]}</Text>
          </View>
        ))}
        {spot.validatedByLocal && (
          <View style={[styles.chip, styles.localChip]}>
            <Ionicons name="checkmark-circle-outline" size={14} color={colors.localText} />
            <Text style={[styles.chipText, styles.localText]}>{t('map.validated')}</Text>
          </View>
        )}
      </View>
      <Text style={styles.stats}>
        {t('map.proofs', { count: spot.proofCount })} · {t('today.votes', { count: spot.votes })}{price ? ` · ${t('map.pricePaid', { price })}` : ''}
      </Text>
      {spot.tags.length > 0 && (
        <View style={styles.chips}>
          {spot.tags.map(tag => <Text key={tag} style={styles.tag}>{tag}</Text>)}
        </View>
      )}
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.btn, styles.primary]} onPress={() => openMapsUrl(directionsUrl(spot.lat, spot.lng, spot.name))} accessibilityRole="button">
          <Ionicons name="navigate-outline" size={18} color={colors.white} />
          <Text style={styles.primaryText}>{t('map.directions')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.secondary]} onPress={() => router.push(`/(tabs)/map?spot=${spot.id}&source=spot` as never)} accessibilityRole="button">
          <Ionicons name="map-outline" size={18} color={colors.text} />
          <Text style={styles.secondaryText}>{t('spot.seeOnMap')}</Text>
        </TouchableOpacity>
      </View>
      {captions.length > 0 && (
        <View style={styles.captions}>
          <Text style={styles.section}>{t('spot.captions')}</Text>
          {captions.map((c, i) => (
            <Text key={i} style={styles.caption}>“{c.text}”{c.username ? <Text style={styles.muted}>  @{c.username}</Text> : null}</Text>
          ))}
        </View>
      )}
      <Text style={styles.section}>{t('spot.photos')}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {nav}
      <FlatList
        data={photos}
        keyExtractor={p => p.id}
        numColumns={3}
        ListHeaderComponent={header}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        onEndReached={more}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => setViewing(item)} accessibilityRole="button" accessibilityLabel={item.caption ?? item.user.username ?? ''}>
            <Image source={{ uri: item.thumbUrl ?? item.photoUrl }} style={[styles.tile, { width: tile, height: tile }]} contentFit="cover" />
          </TouchableOpacity>
        )}
      />
      <PhotoViewer photo={viewing} onClose={() => setViewing(null)} />
    </SafeAreaView>
  );
}

/** Full-screen photo with its author, caption, price and date. */
function PhotoViewer({ photo, onClose }: { photo: SpotPhoto | null; onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('daily');
  const insets = useSafeAreaInsets();
  if (!photo) return null;
  const date = photo.date
    ? new Date(`${photo.date}T12:00:00Z`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.viewer} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('map.closeSpot')}>
        <Image source={{ uri: photo.photoUrl }} style={styles.viewerImage} contentFit="contain" />
        <View style={[styles.viewerInfo, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.viewerUser}>@{photo.user.username ?? photo.user.displayName ?? ''}{photo.isLocal ? ` · ${t('spot.local')}` : ''}</Text>
          {!!photo.caption && <Text style={styles.viewerCaption}>{photo.caption}</Text>}
          <Text style={styles.viewerMeta}>
            {[date, photo.price ? compactPrice(photo.price.amount, photo.price.currency, i18n.language) : null, t('today.votes', { count: photo.voteCount })].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:     { flex: 1, backgroundColor: c.bg },
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  nav:           { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  back:          { width: 44, height: 44, borderRadius: Radius.full, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' },
  navTitle:      { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  list:          { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xl },
  header:        { gap: 10, paddingBottom: 10 },
  cover:         { height: 200, borderRadius: 22, backgroundColor: c.primaryTint },
  name:          { fontSize: FontSizes.xl, fontWeight: '800', color: c.text },
  muted:         { fontSize: FontSizes.sm, color: c.muted },
  rank:          { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primaryTint, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  rankText:      { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryOnTint },
  chips:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:          { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 28, paddingHorizontal: 10, borderRadius: Radius.full, backgroundColor: c.primaryTint },
  chipText:      { fontSize: FontSizes.xs, fontWeight: '700', color: c.primaryOnTint },
  localChip:     { backgroundColor: c.localBg },
  localText:     { color: c.localText },
  stats:         { fontSize: FontSizes.sm, fontWeight: '600', color: c.muted },
  tag:           { fontSize: FontSizes.xs, fontWeight: '600', color: c.text, borderWidth: 1.5, borderColor: c.line, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
  actions:       { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn:           { flex: 1, minHeight: 48, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  primary:       { backgroundColor: c.primary },
  primaryText:   { color: c.white, fontSize: FontSizes.md, fontWeight: '700' },
  secondary:     { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  secondaryText: { color: c.text, fontSize: FontSizes.md, fontWeight: '700' },
  captions:      { gap: 6, marginTop: 4 },
  section:       { fontSize: FontSizes.md, fontWeight: '800', color: c.text, marginTop: 6 },
  caption:       { fontSize: FontSizes.sm, color: c.text },
  row:           { gap: 8, marginBottom: 8 },
  tile:          { borderRadius: 12, backgroundColor: c.bg3 },
  viewer:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' },
  viewerImage:   { flex: 1 },
  viewerInfo:    { paddingHorizontal: Spacing.md, paddingTop: 12, gap: 4 },
  viewerUser:    { fontSize: FontSizes.sm, fontWeight: '700', color: '#FFFFFF' },
  viewerCaption: { fontSize: FontSizes.md, color: '#FFFFFF' },
  viewerMeta:    { fontSize: FontSizes.xs, color: 'rgba(255,255,255,0.75)' },
});
