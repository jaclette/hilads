import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { track } from '@/services/analytics';
import { requestFeatureLocation } from '@/lib/geoFeature';
import { fetchNearbyPlaces } from '@/api/daily';
import { distance } from '@/features/today/format';
import type { DailyThemeKey, NearbyPlace } from '@/types';
import { KeyboardForm } from '@/ui/keyboard';

/** Above this, the position is flagged as approximate (the check allows 150 m). */
const APPROX_M = 100;
const NAME_MAX = 80;

export type PlaceChoice =
  | { kind: 'spot'; spot: NearbyPlace }
  | { kind: 'new'; name: string };

export interface Position { lat: number; lng: number; accuracy: number | null; at: number }

type Phase = 'intro' | 'locating' | 'denied' | 'failed' | 'list' | 'new';

/**
 * The proof's place step (SPEC 9.4): one line on why the position is needed,
 * then the Hilads spots within 100 m (search, distance, proof count) and "New
 * place" (a name; the device position becomes its position). Handles a refused
 * permission, location services off and an approximate fix.
 */
export function PlaceStep({ theme, onPicked }: {
  theme: DailyThemeKey | null;
  onPicked: (choice: PlaceChoice, position: Position) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const [phase, setPhase]       = useState<Phase>('intro');
  const [settings, setSettings] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [places, setPlaces]     = useState<NearbyPlace[]>([]);
  const [query, setQuery]       = useState('');
  const [name, setName]         = useState('');

  useEffect(() => { track('place_picker_opened', { theme }); }, [theme]);

  const locate = useCallback(async () => {
    setPhase('locating');
    const geo = await requestFeatureLocation('challenge_proof', { precise: true });
    if (!geo.ok || !geo.coords) {
      setSettings(!!geo.permanentlyDenied || geo.reason === 'denied');
      setPhase(geo.reason === 'denied' ? 'denied' : 'failed');
      return;
    }
    const pos = { ...geo.coords, accuracy: geo.accuracy ?? null, at: Date.now() };
    setPosition(pos);
    try {
      const items = await fetchNearbyPlaces(pos.lat, pos.lng);
      setPlaces(items);
      setPhase(items.length === 0 ? 'new' : 'list');
    } catch {
      setPlaces([]);
      setPhase('new');
    }
  }, []);

  // Already allowed: no need to explain first, go straight to the list.
  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(p => { if (p.granted) locate(); }).catch(() => {});
  }, [locate]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? places.filter(p => p.name.toLowerCase().includes(q)) : places;
  }, [places, query]);

  const pickSpot = (spot: NearbyPlace) => {
    if (!position) return;
    track('place_picked', { kind: 'spot', distance_m: spot.distanceM, in_review: spot.inReview, theme });
    onPicked({ kind: 'spot', spot }, position);
  };
  const pickNew = () => {
    const n = name.trim().replace(/\s+/g, ' ');
    if (!position || n === '') return;
    track('place_picked', { kind: 'new', distance_m: 0, in_review: true, theme });
    onPicked({ kind: 'new', name: n }, position);
  };

  if (phase === 'intro') {
    return (
      <View style={styles.center}>
        <View style={styles.icon}><Ionicons name="location-outline" size={30} color={colors.primaryOnTint} /></View>
        <Text style={styles.title}>{t('place.title')}</Text>
        <Text style={styles.body}>{t('place.why')}</Text>
        <TouchableOpacity style={styles.cta} onPress={locate} accessibilityRole="button">
          <Text style={styles.ctaText}>{t('place.find')}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (phase === 'locating') {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.body}>{t('place.locating')}</Text></View>;
  }
  if (phase === 'denied' || phase === 'failed') {
    return (
      <View style={styles.center}>
        <View style={styles.icon}><Ionicons name="location-outline" size={30} color={colors.primaryOnTint} /></View>
        <Text style={styles.title}>{phase === 'denied' ? t('place.deniedTitle') : t('place.failedTitle')}</Text>
        <Text style={styles.body}>{phase === 'denied' ? t('place.deniedBody') : t('place.failedBody')}</Text>
        {settings && (
          <TouchableOpacity style={styles.cta} onPress={() => Linking.openSettings().catch(() => {})} accessibilityRole="button">
            <Text style={styles.ctaText}>{t('place.openSettings')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.cta, settings && styles.secondary]} onPress={locate} accessibilityRole="button">
          <Text style={[styles.ctaText, settings && styles.secondaryText]}>{t('place.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const approximate = position?.accuracy !== null && position?.accuracy !== undefined && position.accuracy > APPROX_M;

  return (
    // The new place's name stays in sight above the keyboard, its button rides on top of it.
    <KeyboardForm contentContainerStyle={styles.list} footerStyle={styles.footer} footer={phase === 'new' ? (
      <TouchableOpacity style={[styles.cta, name.trim() === '' && styles.off]} onPress={pickNew} disabled={name.trim() === ''}
                        accessibilityRole="button" testID="place-use-new">
        <Text style={styles.ctaText}>{t('place.useNew')}</Text>
      </TouchableOpacity>
    ) : undefined}>
      <Text style={styles.title}>{t('place.title')}</Text>
      {approximate && (
        <View style={styles.warn}>
          <Ionicons name="warning-outline" size={18} color={colors.warning} />
          <Text style={styles.warnText}>{t('place.approximate', { m: Math.round(position!.accuracy!) })}</Text>
        </View>
      )}
      <TouchableOpacity style={styles.refresh} onPress={locate} accessibilityRole="button" hitSlop={6}>
        <Ionicons name="refresh-outline" size={16} color={colors.primaryText} />
        <Text style={styles.link}>{t('place.refresh')}</Text>
      </TouchableOpacity>

      {phase === 'list' && (
        <>
          {places.length > 4 && (
            <View style={styles.search}>
              <Ionicons name="search-outline" size={18} color={colors.muted} />
              <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder={t('place.search')} returnKeyType="search"
                         placeholderTextColor={colors.muted} accessibilityLabel={t('place.search')} />
            </View>
          )}
          {shown.map(p => (
            <TouchableOpacity key={p.id} style={styles.row} onPress={() => pickSpot(p)} accessibilityRole="button"
                              accessibilityLabel={`${p.name}, ${distance(p.distanceM, i18n.language)}`}>
              <Ionicons name="location" size={20} color={colors.primary} />
              <View style={styles.rowBody}>
                <Text style={styles.rowName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.rowMeta}>
                  {distance(p.distanceM, i18n.language)}
                  {p.proofCount > 0 ? ` · ${t('map.proofs', { count: p.proofCount })}` : ''}
                  {p.inReview ? ` · ${t('place.inReview')}` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.row, styles.newRow]} onPress={() => setPhase('new')} accessibilityRole="button" testID="place-new">
            <Ionicons name="add-circle-outline" size={20} color={colors.primaryText} />
            <View style={styles.rowBody}>
              <Text style={styles.rowName}>{t('place.newTitle')}</Text>
              <Text style={styles.rowMeta}>{t('place.notListed')}</Text>
            </View>
          </TouchableOpacity>
        </>
      )}

      {phase === 'new' && (
        <View style={styles.newBox}>
          {places.length === 0 && <Text style={styles.body}>{t('place.noneNearby')}</Text>}
          <Text style={styles.label}>{t('place.nameLabel')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={v => setName(v.slice(0, NAME_MAX))}
            placeholder={t('place.namePlaceholder')}
            placeholderTextColor={colors.muted}
            maxLength={NAME_MAX}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={pickNew}
            testID="place-name"
          />
          <Text style={styles.hint}>{t('place.newHint')}</Text>
          {places.length > 0 && (
            <TouchableOpacity onPress={() => setPhase('list')} accessibilityRole="button" style={styles.backToList}>
              <Text style={styles.link}>{t('place.backToList')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </KeyboardForm>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: 12 },
  icon:          { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  title:         { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, textAlign: 'center' },
  body:          { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center' },
  cta:           { alignSelf: 'stretch', minHeight: 48, borderRadius: 16, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  ctaText:       { color: c.white, fontSize: FontSizes.md, fontWeight: '700' },
  secondary:     { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  secondaryText: { color: c.text },
  off:           { opacity: 0.45 },
  list:          { padding: Spacing.md, gap: 10, paddingBottom: Spacing.xl },
  footer:        { padding: Spacing.md, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.bg },
  warn:          { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 14, backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  warnText:      { flex: 1, fontSize: FontSizes.xs, color: c.text },
  refresh:       { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  link:          { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
  search:        { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderRadius: Radius.full, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2 },
  searchInput:   { flex: 1, fontSize: FontSizes.sm, color: c.text, paddingVertical: 0 },
  row:           { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  newRow:        { borderStyle: 'dashed' },
  rowBody:       { flex: 1 },
  rowName:       { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  rowMeta:       { fontSize: FontSizes.xs, color: c.muted, marginTop: 2 },
  newBox:        { gap: 8 },
  label:         { fontSize: FontSizes.sm, fontWeight: '700', color: c.text, marginTop: 6 },
  input:         { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: FontSizes.md, color: c.text },
  hint:          { fontSize: FontSizes.xs, color: c.muted },
  backToList:    { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
});
