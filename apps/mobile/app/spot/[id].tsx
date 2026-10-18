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
import { shortCityName } from '@/i18n/cityName';
import { directionsUrl, openMapsUrl } from '@/lib/directions';
import { fetchSpot, type SpotDetail, type SpotPhoto } from '@/api/spots';
import { themeName } from '@/features/daily/themes';
import { THEME_ICON, compactPrice } from '@/features/today/format';
import { Button, Chip, CityName, IconButton, ScreenHeader, SectionTitle } from '@/ui';
import { ShareSheet } from '@/features/share/ShareSheet';
import { spotShare, type ShareContent } from '@/features/share/content';
import { PhotoCredit } from '@/features/map/PhotoCredit';

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
  const [share, setShare]     = useState<ShareContent | null>(null);

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

  const nav = <ScreenHeader compact title={data?.spot.name ?? ''} />;

  if (failed) {
    return <SafeAreaView style={styles.container} edges={['top']}>{nav}<View style={styles.center}><Text style={styles.muted}>{t('spot.notFound')}</Text></View></SafeAreaView>;
  }
  if (!data) {
    return <SafeAreaView style={styles.container} edges={['top']}>{nav}<View style={styles.center}><ActivityIndicator color={colors.primary} /></View></SafeAreaView>;
  }

  const { spot, ranking, captions } = data;
  const cityName = ranking?.cityName ? shortCityName(ranking.cityName) : spot.city?.name ? shortCityName(spot.city.name) : '';
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
      {!!spot.cover.photoUrl && (
        <View>
          <Image source={{ uri: spot.cover.photoUrl }} style={styles.cover} contentFit="cover" />
          <PhotoCredit by={spot.cover.by} overlay style={styles.coverCredit} />
        </View>
      )}
      <Text style={styles.name}>{spot.name}</Text>
      {!!spot.city?.name && <CityName name={spot.city.name} country={spot.city.country} style={styles.muted} />}
      {rankLine && (
        <View style={styles.rank}>
          <Ionicons name="trophy-outline" size={16} color={colors.primaryOnTint} />
          <Text style={styles.rankText}>{rankLine}</Text>
        </View>
      )}
      <View style={styles.chips}>
        {spot.themes.map(k => <Chip key={k} icon={THEME_ICON[k]} label={themeName(k)} />)}
        {spot.validatedByLocal && <Chip tone="local" icon="checkmark-circle-outline" label={t('map.validated')} />}
      </View>
      <Text style={styles.stats}>
        {t('map.proofs', { count: spot.proofCount })} · {t('today.votes', { count: spot.votes })}{price ? ` · ${t('map.pricePaid', { price })}` : ''}
      </Text>
      {spot.tags.length > 0 && (
        <View style={styles.chips}>
          {spot.tags.map(tag => <Chip key={tag} variant="outline" label={tag} />)}
        </View>
      )}
      <View style={styles.actions}>
        <Button icon="navigate-outline" label={t('map.directions')} onPress={() => openMapsUrl(directionsUrl(spot.lat, spot.lng, spot.name))} style={styles.btn} />
        <Button variant="secondary" icon="map-outline" label={t('spot.seeOnMap')} onPress={() => router.push(`/(tabs)/map?spot=${spot.id}&source=spot` as never)} style={styles.btn} />
        <IconButton icon="share-social-outline" label={t('share.title')} onPress={() => setShare(spotShare(spot))} style={styles.share} />
      </View>
      {captions.length > 0 && (
        <View style={styles.captions}>
          <SectionTitle title={t('spot.captions')} style={styles.section} />
          {captions.map((c, i) => (
            <Text key={i} style={styles.caption}>“{c.text}”{c.username ? <Text style={styles.muted}>  @{c.username}</Text> : null}</Text>
          ))}
        </View>
      )}
      <SectionTitle title={t('spot.photos')} style={styles.section} />
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
      <ShareSheet content={share} source="spot_screen" onClose={() => setShare(null)} />
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
  list:          { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xl },
  header:        { gap: 10, paddingBottom: 10 },
  cover:         { height: 200, borderRadius: 22, backgroundColor: c.primaryTint },
  coverCredit:   { left: 10, bottom: 10 },
  name:          { fontSize: FontSizes.xl, fontWeight: '800', color: c.text },
  muted:         { fontSize: FontSizes.sm, color: c.muted },
  rank:          { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primaryTint, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  rankText:      { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryOnTint },
  chips:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stats:         { fontSize: FontSizes.sm, fontWeight: '600', color: c.muted },
  actions:       { flexDirection: 'row', gap: 10, marginTop: 4 },
  share:         { alignSelf: 'center' },
  btn:           { flex: 1 },
  captions:      { gap: 6, marginTop: 4 },
  section:       { marginTop: 6 },
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
