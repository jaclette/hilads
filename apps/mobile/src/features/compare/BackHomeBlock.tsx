import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { shortCityName } from '@/i18n/cityName';
import { CityFlag } from '@/ui';
import type { DailyProof } from '@/types';
import { AnswerChip } from './AnswerChip';
import { useMoney } from './money';

/**
 * Back home's split block (SPEC 10.4), on the photo viewer's dark ground:
 * "Here in Saigon" / "Back home in Paris", each with its flag, answer and
 * converted price; the author's line goes under the Back home side.
 */
export function BackHomeBlock({ proof }: { proof: DailyProof }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const money = useMoney();
  const home = proof.backHome;
  if (!home) return null;
  const side = (label: string, country: string | null | undefined, answer: DailyProof['answer'], price: DailyProof['price'], line?: string | null) => {
    const p = price ? money.price(price) : null;
    return (
      <View style={styles.side}>
        <View style={styles.head}>
          <CityFlag country={country} size={16} />
          <Text style={styles.label} numberOfLines={2}>{label}</Text>
        </View>
        {answer ? <AnswerChip answer={answer} onDark /> : <Text style={styles.none}>-</Text>}
        {p && <Text style={styles.price}>{p.main}{p.original ? <Text style={styles.original}>{`  ${p.original}`}</Text> : null}</Text>}
        {!!line && <Text style={styles.line}>{line}</Text>}
      </View>
    );
  };
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {side(t('backHome.hereIn', { city: shortCityName(proof.city?.name ?? '') }), proof.city?.country, proof.answer ?? null, proof.price)}
        <View style={styles.divider} />
        {side(t('backHome.homeIn', { city: shortCityName(home.city.name) }), home.city.country, home.answer, home.price, home.line)}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:     { gap: 8, padding: 12, borderRadius: Radius.card, backgroundColor: c.onPhotoFill },
  row:      { flexDirection: 'row', gap: 12 },
  side:     { flex: 1, gap: 6 },
  divider:  { width: 1, backgroundColor: c.onPhotoLine },
  head:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label:    { flexShrink: 1, fontSize: FontSizes.xs, fontWeight: '700', color: c.white },
  none:     { fontSize: FontSizes.xs, color: c.onCaramelMuted },
  price:    { fontSize: FontSizes.xs, fontWeight: '700', color: c.white },
  original: { fontSize: 11, fontWeight: '500', color: c.onCaramelMuted },
  line:     { fontSize: FontSizes.xs, fontStyle: 'italic', color: c.onCaramelMuted },
});
