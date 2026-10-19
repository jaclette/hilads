import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { fetchDailyIndex } from '@/api/daily';
import { track } from '@/services/analytics';
import { shortCityName } from '@/i18n/cityName';
import { CityFlag, IconButton, SectionTitle } from '@/ui';
import { themeName } from '@/features/daily/themes';
import { formatTime } from '@/features/compare/format';
import { useMoney } from '@/features/compare/money';
import { ShareSheet } from '@/features/share/ShareSheet';
import type { ShareContent } from '@/features/share/content';
import type { DailyIndex } from '@/types';

/** Brand term: English in every locale. */
const HILADS_INDEX = 'Hilads Index';

/**
 * The Hilads Index (SPEC 10.9): last week's price and time cards, one per
 * comparable question ("Order a coffee the local way: Lisbon €1.20, Saigon
 * €1.21, Tokyo €2.71"), cities with 3 proofs or more, lowest first, prices in
 * my currency. Shown on Today on Mondays and in the archive; each card can be
 * shared. Readable without an account. Nothing when the week has no card.
 */
export function IndexCards({ source, refreshKey = 0 }: { source: 'today' | 'archive'; refreshKey?: number }) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('daily');
  const money = useMoney();
  const [index, setIndex] = useState<DailyIndex | null>(null);
  const [share, setShare] = useState<ShareContent | null>(null);
  const tracked = useRef<string | null>(null);

  const load = useCallback(() => {
    fetchDailyIndex().then(setIndex).catch(() => setIndex(null));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!index || index.cards.length === 0 || tracked.current === index.weekStart) return;
    tracked.current = index.weekStart;
    track('index_viewed', { source, week: index.weekStart, cards: index.cards.length });
  }, [index, source]);

  if (!index || index.cards.length === 0) return null;
  const value = (kind: 'price' | 'time', v: number) => (kind === 'time' ? formatTime(v, i18n.language) : money.fromEur(v) ?? `€${v.toFixed(2)}`);

  return (
    <View style={styles.wrap}>
      <SectionTitle small title={t('index.title')} />
      <Text style={styles.sub}>{t('index.sub')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {index.cards.map(card => {
          const theme = card.challenge.theme ? themeName(card.challenge.theme.key, { special: card.challenge.special }) : '';
          const label = card.kind === 'time' && card.challenge.compare ? card.challenge.compare.question : t('index.pricePaid');
          return (
            <View key={card.id} style={styles.card}>
              <View style={styles.head}>
                <Text style={styles.kicker} numberOfLines={1}>{`${HILADS_INDEX} · ${theme}`.toUpperCase()}</Text>
                <IconButton icon="share-social-outline" iconSize={18} label={t('index.share')} onPress={() => {
                  track('index_shared', { card: card.id, week: index.weekStart, source });
                  setShare({
                    type: 'index', date: card.date, text: card.challenge.text, theme: card.challenge.theme?.key ?? null,
                    themeLabel: theme, photoUrl: card.challenge.coverUrl ?? null, city: null,
                    lines: card.rows.map(r => ({ country: r.city.country, city: shortCityName(r.city.name), value: value(card.kind, r.value) })),
                  });
                }} />
              </View>
              <Text style={styles.title} numberOfLines={2}>{card.challenge.text}</Text>
              <Text style={styles.label} numberOfLines={2}>{label}</Text>
              {card.rows.map(r => (
                <View key={r.city.id} style={styles.line}>
                  <CityFlag country={r.city.country} size={18} />
                  <Text style={styles.city} numberOfLines={1}>{shortCityName(r.city.name)}</Text>
                  <Text style={styles.value}>{value(card.kind, r.value)}</Text>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>
      <ShareSheet content={share} source={`index_${source}`} onClose={() => setShare(null)} />
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:   { gap: 6 },
  sub:    { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted, marginTop: -4 },
  row:    { gap: 10, paddingTop: 4, paddingRight: 4 },
  card:   { width: 260, padding: 14, gap: 6, borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  head:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kicker: { flex: 1, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: c.primaryText },
  title:  { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  label:  { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted, marginBottom: 2 },
  line:   { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  city:   { flex: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  value:  { fontSize: FontSizes.sm, fontWeight: '800', color: c.text, fontVariant: ['tabular-nums'] },
});
