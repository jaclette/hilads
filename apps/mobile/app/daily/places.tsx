import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { track } from '@/services/analytics';
import { fetchDailyPlaces, fetchDailyProof, fetchDailySheet } from '@/api/daily';
import { DailyPlacesMap } from '@/features/daily/DailyPlacesMap';
import { DailyProofViewer } from '@/features/daily/DailyProofViewer';
import type { DailyPlacePin, DailyProof } from '@/types';

/**
 * Map of pinned places (only places users explicitly pinned on an approved
 * proof). Two modes:
 *   /daily/places?date=YYYY-MM-DD&scope=world|city - one challenge's pins (sheet)
 *   /daily/places?cityId=N&cityName=…              - "Already done": past challenges' pins of a city
 * Tap a pin → a card with the proof; tap the card → the proof viewer.
 */
export default function DailyPlacesScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; scope?: string; cityId?: string; cityName?: string; source?: string }>();
  const { city, account, identity } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const isArchive = !params.date;

  const [pins, setPins]         = useState<DailyPlacePin[] | null>(null);
  const [scope, setScope]       = useState<'world' | 'city'>('world');
  const [failed, setFailed]     = useState(false);
  const [selected, setSelected] = useState<DailyPlacePin | null>(null);
  const [viewing, setViewing]   = useState<DailyProof | null>(null);
  const pinsRef = useRef<DailyPlacePin[]>([]);

  const cityId = params.cityId ?? city?.channelId ?? null;
  useEffect(() => {
    let alive = true;
    track('daily_map_opened', { source: params.source ?? (isArchive ? 'archive' : 'sheet'), challenge_date: params.date ?? null, city: city?.name ?? null });
    (async () => {
      try {
        if (isArchive) {
          const r = await fetchDailyPlaces({ cityId, guestId });
          if (!alive) return;
          setScope(r.scope);
          setPins(r.items);
        } else {
          const s = await fetchDailySheet(params.date!, { scope: params.scope === 'city' ? 'city' : 'world', cityId, guestId, limit: 1 });
          if (!alive) return;
          setScope(s.scope);
          setPins(s.practical.places);
        }
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { pinsRef.current = pins ?? []; }, [pins]);

  // Stable: the map reads it once at mount.
  const onPinPress = useCallback((proofId: string) => {
    setSelected(pinsRef.current.find(p => p.proofId === proofId) ?? null);
  }, []);

  const openProof = (pin: DailyPlacePin) => {
    fetchDailyProof(pin.proofId).then(setViewing).catch(() => {});
  };

  const title = !isArchive ? t('map.titleChallenge')
    : scope === 'city' && params.cityName ? t('map.titleCity', { city: localizeCityName(params.cityName) })
    : t('map.titleWorld');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('back')}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>🗺️ {title}</Text>
        {pins && <Text style={styles.navCount}>{t('places', { count: pins.length })}</Text>}
      </View>

      {failed ? (
        <View style={styles.center}><Text style={styles.muted}>{t('loadFailed')}</Text></View>
      ) : !pins ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : pins.length === 0 ? (
        <View style={styles.center}><Text style={styles.muted}>{t('map.empty')}</Text></View>
      ) : (
        <View style={styles.flex}>
          <DailyPlacesMap key={pins.map(p => p.proofId).join(',')} pins={pins} interactive onPinPress={onPinPress} />
          {selected && (
            <View style={styles.cardWrap} pointerEvents="box-none">
              <TouchableOpacity style={styles.card} onPress={() => openProof(selected)} activeOpacity={0.9} accessibilityRole="button">
                {selected.thumbUrl
                  ? <Image source={{ uri: selected.thumbUrl }} style={styles.thumb} contentFit="cover" />
                  : <View style={[styles.thumb, styles.thumbEmpty]} />}
                <View style={styles.cardBody}>
                  <Text style={styles.place} numberOfLines={1}>📍 {selected.name || t('unnamedPlace')}</Text>
                  <Text style={styles.author} numberOfLines={1}>{selected.user.displayName || selected.user.username}</Text>
                  {!!selected.challengeText && (
                    <Text style={styles.challenge} numberOfLines={2}>{selected.date} · {selected.challengeText}</Text>
                  )}
                  <View style={styles.actions}>
                    <Text style={styles.link}>{t('map.seeProof')}</Text>
                    {isArchive && selected.date && (
                      <TouchableOpacity onPress={() => router.push(`/daily/${selected.date}?proof=${selected.proofId}` as never)} hitSlop={8} accessibilityRole="button">
                        <Text style={styles.link}>{t('map.openChallenge')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                <TouchableOpacity onPress={() => setSelected(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('cancel')}>
                  <Ionicons name="close" size={18} color={colors.muted} />
                </TouchableOpacity>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <DailyProofViewer proof={viewing} onClose={() => setViewing(null)} />
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:  { flex: 1, backgroundColor: c.bg },
  flex:       { flex: 1 },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.md },
  nav:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  back:       { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  navTitle:   { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  navCount:   { fontSize: FontSizes.xs, color: c.muted },
  muted:      { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center' },
  cardWrap:   { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.md, paddingBottom: 28 },
  card:       { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: c.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, padding: 12 },
  thumb:      { width: 72, height: 72, borderRadius: Radius.md, backgroundColor: c.bg3 },
  thumbEmpty: { borderWidth: 1, borderColor: c.border },
  cardBody:   { flex: 1, gap: 3 },
  place:      { fontSize: FontSizes.sm, fontWeight: '800', color: c.text },
  author:     { fontSize: FontSizes.xs, color: c.muted, fontWeight: '600' },
  challenge:  { fontSize: 12, color: c.muted },
  actions:    { flexDirection: 'row', gap: 16, marginTop: 4 },
  link:       { fontSize: FontSizes.xs, fontWeight: '700', color: c.accentText },
});
