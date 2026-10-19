import { Text, TouchableOpacity, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { shortCityName } from '@/i18n/cityName';
import { CityFlag, IconButton } from '@/ui';
import { formatTime } from '@/features/compare/format';
import { useMoney } from '@/features/compare/money';
import type { ShareContent } from '@/features/share/content';
import type { DailyComparison } from '@/types';

/** A comparison's question: its title, or "How much is a beer?" for a price. */
export function comparisonTitle(card: DailyComparison, t: TFunction): string {
  return card.kind === 'price' ? t('index.priceTitle', { ns: 'daily', label: card.priceLabel ?? '' }) : (card.title ?? '');
}

/** A city's usual value, as shown: a price in my currency, a time, a number with its unit, or the word. */
export function useComparisonValue() {
  const { i18n } = useTranslation();
  const money = useMoney();
  return (card: DailyComparison, value: number | string): string => {
    if (typeof value === 'string') return value;
    if (card.kind === 'price') return money.fromEur(value) ?? `€${value.toFixed(2)}`;
    if (card.kind === 'time') return formatTime(value, i18n.language);
    const n = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value);
    return card.unit ? `${n} ${card.unit}` : n;
  };
}

/** The share card of a comparison (the Index share: its question, then one line per city). */
export function comparisonShare(card: DailyComparison, t: TFunction, value: (c: DailyComparison, v: number | string) => string): ShareContent {
  return {
    type: 'index', date: card.date ?? '', text: comparisonTitle(card, t), theme: null, themeLabel: null, photoUrl: null, city: null,
    lines: card.rows.map(r => ({ country: r.city.country, city: shortCityName(r.city.name), value: value(card, r.value) })),
  };
}

/**
 * One comparison (SPEC 10.9): its question, each city's usual price, time or
 * answer with its flag, the price fun fact ("3× the price in Oslo than in
 * Saigon.") and a share button. Never the word "median". `rows` limits the
 * cities shown (the carousel); `onPress` opens the Index on it.
 */
export function ComparisonCard({ card, onPress, onShare, rows, style }: {
  card: DailyComparison;
  onPress?: () => void;
  onShare: () => void;
  rows?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('daily');
  const value = useComparisonValue();
  const shown = rows ? card.rows.slice(0, rows) : card.rows;
  const fun = card.funFact;
  const body = (
    <>
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={2}>{comparisonTitle(card, t)}</Text>
        <IconButton icon="share-social-outline" iconSize={18} label={t('index.share')} onPress={onShare} />
      </View>
      {shown.map(r => (
        <View key={r.city.id} style={styles.line}>
          <CityFlag country={r.city.country} size={18} />
          <Text style={styles.city} numberOfLines={1}>{shortCityName(r.city.name)}</Text>
          <Text style={[styles.value, card.kind === 'word' && styles.word]} numberOfLines={1}>{value(card, r.value)}</Text>
        </View>
      ))}
      {rows !== undefined && card.rows.length > rows && (
        <Text style={styles.more}>{t('index.moreCities', { count: card.rows.length - rows })}</Text>
      )}
      {fun && fun.ratio >= 2 && (
        <Text style={styles.fun}>
          {t('compare.funFact', {
            ratio: fun.ratio.toLocaleString(i18n.language, { maximumFractionDigits: fun.ratio >= 10 ? 0 : 1 }),
            city: shortCityName(fun.priciest.name), other: shortCityName(fun.cheapest.name),
          })}
        </Text>
      )}
    </>
  );
  return onPress ? (
    <TouchableOpacity style={[styles.card, style]} onPress={onPress} activeOpacity={0.85} accessibilityRole="button">{body}</TouchableOpacity>
  ) : <View style={[styles.card, style]}>{body}</View>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:  { padding: 14, gap: 6, borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  head:  { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  title: { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text, paddingTop: 8 },
  line:  { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  city:  { flex: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  value: { maxWidth: '55%', fontSize: FontSizes.sm, fontWeight: '800', color: c.text, fontVariant: ['tabular-nums'] },
  word:  { fontWeight: '700' },
  more:  { fontSize: 12, fontWeight: '600', color: c.muted },
  fun:   { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText, marginTop: 2 },
});
