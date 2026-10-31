import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { fetchCompared } from '@/api/daily';
import { track } from '@/services/analytics';
import { shortCityName } from '@/i18n/cityName';
import { Button, CityFlag, EmptyState, Screen, ScreenHeader, SectionTitle, Sheet, SheetScrollView, TextField } from '@/ui';
import { ShareSheet } from '@/features/share/ShareSheet';
import type { ShareContent } from '@/features/share/content';
import { ComparisonCard, comparisonShare, comparisonTitle, useComparisonValue } from '@/features/index/ComparisonCard';
import type { DailyCityRef, DailyComparison } from '@/types';
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';

type Section = 'price' | 'time' | 'word';
const SECTIONS: Section[] = ['price', 'time', 'word'];
const sectionOf = (c: DailyComparison): Section => (c.kind === 'price' ? 'price' : c.kind === 'time' ? 'time' : 'word');
const cardId = (c: DailyComparison) => `${c.kind}:${c.key}`;

/**
 * The Hilads Index (SPEC 10.9): everything the world compared on Hilads, all
 * time (cities with 3 answers or more), in Prices, Times and Words (numbers go
 * with the words), with a search over the questions, cities and answers.
 * ?focus=<kind:key> scrolls to that comparison (a carousel card). "Two cities"
 * shows every comparison where both cities have data, side by side ("Saigon
 * and Lisbon", never "vs"). Readable without an account.
 */
export default function ComparedScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const { focus } = useLocalSearchParams<{ focus?: string; source?: string }>();
  const value = useComparisonValue();
  const [cards, setCards] = useState<DailyComparison[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [share, setShare] = useState<ShareContent | null>(null);
  const [pair, setPair] = useState<[DailyCityRef | null, DailyCityRef | null] | null>(null);
  const [picking, setPicking] = useState<0 | 1 | null>(null);
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const searched = useRef(false);
  const focused = useRef(false);
  const sectionY = useRef<Partial<Record<Section, number>>>({});

  useEffect(() => {
    fetchCompared('all').then(d => setCards(d.cards)).catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (!searched.current && query.trim().length >= 2) {
      searched.current = true;
      track('index_search_used', { length: query.trim().length });
    }
  }, [query]);

  // Every city of the Index, for "Two cities".
  const cities = useMemo(() => {
    const byId = new Map<number, DailyCityRef>();
    (cards ?? []).forEach(c => c.rows.forEach(r => byId.set(r.city.id, r.city)));
    return [...byId.values()].sort((a, b) => shortCityName(a.name).localeCompare(shortCityName(b.name)));
  }, [cards]);

  const q = query.trim().toLowerCase();
  const matches = (c: DailyComparison) => !q
    || comparisonTitle(c, t).toLowerCase().includes(q)
    || c.rows.some(r => shortCityName(r.city.name).toLowerCase().includes(q) || (r.city.name ?? '').toLowerCase().includes(q)
                        || String(value(c, r.value)).toLowerCase().includes(q));
  const shown = (cards ?? []).filter(matches);

  const [a, b] = pair ?? [null, null];
  const both = a && b ? (cards ?? []).filter(c => c.rows.some(r => r.city.id === a.id) && c.rows.some(r => r.city.id === b.id)) : [];
  useEffect(() => {
    if (a && b) track('two_cities_compared', { a: a.name, b: b.name, comparisons: both.length });
  }, [a?.id, b?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickCity = (city: DailyCityRef) => {
    const next: [DailyCityRef | null, DailyCityRef | null] = [...(pair ?? [null, null])] as [DailyCityRef | null, DailyCityRef | null];
    next[picking ?? 0] = city;
    setPair(next);
    setPicking(next[0] && !next[1] ? 1 : null);
  };

  const shareCard = (c: DailyComparison) => {
    track('index_shared', { card: c.key, source: 'index_screen' });
    setShare(comparisonShare(c, t, value));
  };

  return (
    <Screen>
      <ScreenHeader title={t('index.screenTitle')} />
      {!cards ? (
        failed ? <EmptyState icon="cloud-offline-outline" body={t('loadFailed')} /> : <ActivityIndicator color={colors.primary} style={styles.loading} />
      ) : (
        // The keyboard rule: the search field and its results stay above the keyboard.
        <KeyboardAwareScrollView ref={scrollRef} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bottomOffset={160}>
          <Text style={styles.sub}>{t('index.screenSub')}</Text>

          {/* Two cities: pick two, see every comparison where both have data. */}
          {pair === null ? (
            <Button variant="secondary" icon="git-compare-outline" label={t('index.twoCities')}
                    onPress={() => { setPair([null, null]); setPicking(0); }} disabled={cities.length < 2} />
          ) : (
            <View style={styles.pairBox}>
              <View style={styles.pairHead}>
                <Text style={styles.pairTitle}>{t('index.twoCities')}</Text>
                <TouchableOpacity onPress={() => { setPair(null); setPicking(null); }} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('index.closeTwoCities')}>
                  <Ionicons name="close" size={22} color={colors.text} />
                </TouchableOpacity>
              </View>
              <View style={styles.pairPick}>
                {[a, b].map((c, i) => (
                  <TouchableOpacity key={i} style={styles.pickBtn} onPress={() => setPicking(i as 0 | 1)} accessibilityRole="button">
                    {c ? <CityFlag country={c.country} size={18} /> : <Ionicons name="add" size={18} color={colors.muted} />}
                    <Text style={[styles.pickText, !c && styles.pickEmpty]} numberOfLines={1}>{c ? shortCityName(c.name) : t('index.pickCity')}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {a && b && (
                <>
                  <Text style={styles.pairCities}>{t('index.and', { a: shortCityName(a.name), b: shortCityName(b.name) })}</Text>
                  {both.length === 0 ? <Text style={styles.muted}>{t('index.twoCitiesEmpty')}</Text> : both.map(c => {
                    const ra = c.rows.find(r => r.city.id === a.id)!;
                    const rb = c.rows.find(r => r.city.id === b.id)!;
                    return (
                      <View key={cardId(c)} style={styles.pairCard}>
                        <Text style={styles.pairQ}>{comparisonTitle(c, t)}</Text>
                        <View style={styles.pairCols}>
                          {[ra, rb].map(r => (
                            <View key={r.city.id} style={styles.pairCol}>
                              <View style={styles.pairCity}><CityFlag country={r.city.country} size={16} /><Text style={styles.pairCityName} numberOfLines={1}>{shortCityName(r.city.name)}</Text></View>
                              <Text style={styles.pairValue} numberOfLines={2}>{value(c, r.value)}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    );
                  })}
                </>
              )}
            </View>
          )}

          {pair === null && (
            <>
              <TextField variant="search" value={query} onChangeText={setQuery} placeholder={t('index.search')} returnKeyType="search"
                         accessibilityLabel={t('index.search')} onClear={() => setQuery('')} clearLabel={t('index.clearSearch')} />
              {cards.length === 0 ? <EmptyState icon="earth-outline" body={t('index.empty')} />
                : shown.length === 0 ? <Text style={styles.muted}>{t('index.noResults')}</Text>
                : SECTIONS.map(s => {
                  const list = shown.filter(c => sectionOf(c) === s);
                  if (list.length === 0) return null;
                  return (
                    <View key={s} style={styles.section} onLayout={e => { sectionY.current[s] = e.nativeEvent.layout.y; }}>
                      <SectionTitle title={t(`index.sections.${s}`)} />
                      {list.map(c => (
                        <View key={cardId(c)} onLayout={e => {
                          // Focused from a carousel card: scroll to it once laid out (its y is within the section).
                          const y = e.nativeEvent.layout.y;
                          if (focus === cardId(c) && !focused.current) {
                            focused.current = true;
                            setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, (sectionY.current[s] ?? 0) + y - 12), animated: true }), 80);
                          }
                        }}>
                          <ComparisonCard card={c} onShare={() => shareCard(c)} style={focus === cardId(c) ? styles.focused : undefined} />
                        </View>
                      ))}
                    </View>
                  );
                })}
            </>
          )}
        </KeyboardAwareScrollView>
      )}

      <Sheet visible={picking !== null} onClose={() => setPicking(null)} closeLabel={t('close', { ns: 'common' })} style={styles.sheet}>
        <Text style={styles.sheetTitle}>{t('index.pickCity')}</Text>
        <SheetScrollView style={styles.sheetList}>
          {cities.filter(c => c.id !== (picking === 0 ? b?.id : a?.id)).map(c => (
            <TouchableOpacity key={c.id} style={styles.cityRow} onPress={() => pickCity(c)} accessibilityRole="button">
              <CityFlag country={c.country} size={20} />
              <Text style={styles.cityRowText}>{shortCityName(c.name)}</Text>
            </TouchableOpacity>
          ))}
        </SheetScrollView>
      </Sheet>
      <ShareSheet content={share} source="index_screen" onClose={() => setShare(null)} />
    </Screen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  loading:      { marginTop: 40 },
  body:         { paddingHorizontal: Spacing.md, paddingBottom: 40, gap: 12 },
  sub:          { fontSize: 15, lineHeight: 20, fontWeight: '500', color: c.muted },
  muted:        { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center', paddingVertical: 16 },
  section:      { gap: 10, marginTop: 4 },
  focused:      { borderColor: c.primary },
  pairBox:      { gap: 10, padding: 14, borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  pairHead:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pairTitle:    { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  pairPick:     { flexDirection: 'row', gap: 8 },
  pickBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 14, backgroundColor: c.stepBg },
  pickText:     { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  pickEmpty:    { color: c.muted },
  pairCities:   { fontSize: FontSizes.md, fontWeight: '800', color: c.text, marginTop: 4 },
  pairCard:     { gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.line },
  pairQ:        { fontSize: FontSizes.sm, fontWeight: '700', color: c.muted },
  pairCols:     { flexDirection: 'row', gap: 10 },
  pairCol:      { flex: 1, gap: 2 },
  pairCity:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pairCityName: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: c.muted },
  pairValue:    { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  sheet:        { gap: 6, maxHeight: '80%' },
  sheetTitle:   { fontSize: FontSizes.md, fontWeight: '800', color: c.text, marginBottom: 4 },
  sheetList:    { flexGrow: 0 },
  cityRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 4 },
  cityRowText:  { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
});
