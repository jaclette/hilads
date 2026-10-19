import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchDailyBoard, fetchDailySheet } from '@/api/daily';
import { track } from '@/services/analytics';
import { shortCityName } from '@/i18n/cityName';
import { Button, CityFlag, EmptyState } from '@/ui';
import { DailyProofTile } from '@/features/daily/DailyProofTile';
import type { DailyBoard, DailyCityRef, DailyProof } from '@/types';
import { answerText } from './format';
import { useRouter } from 'expo-router';
import { PickBadge } from '@/features/map/PickBadge';
import { PickVoteButton } from './PickVote';
import { Image } from 'expo-image';
import { useMoney } from './money';

/**
 * The Compare tab of the challenge sheet (SPEC 10.6): "How the world answered",
 * the question, the range for number and time questions, the cheapest and
 * priciest city with the price fun fact, and one row per city (flag, short name, the
 * answer of its best proof, median price in my currency, proof count).
 * Tapping a row shows that city's proofs. Readable without an account.
 */
export function CompareBoard({ date, source, onOpenProof, onAnswer }: {
  date: string;
  /** world_board_viewed source: tab, teaser, link. */
  source: string;
  onOpenProof: (p: DailyProof) => void;
  /** Today's challenge without my proof: the empty board invites me to answer. */
  onAnswer?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const { identity } = useApp();
  const money = useMoney();
  const [board, setBoard] = useState<DailyBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [city, setCity] = useState<DailyCityRef | null>(null);
  const [cityProofs, setCityProofs] = useState<DailyProof[] | null>(null);
  const tracked = useRef(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    fetchDailyBoard(date, identity?.guestId)
      .then(b => {
        if (!alive) return;
        setBoard(b);
        if (!tracked.current) {
          tracked.current = true;
          track('world_board_viewed', { source, date, cities: b.cities, type: b.compare?.type ?? null });
        }
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [date, identity?.guestId, source]);

  useEffect(() => {
    if (!city) { setCityProofs(null); return; }
    let alive = true;
    setCityProofs(null);
    fetchDailySheet(date, { scope: 'city', cityId: city.id, limit: 50, guestId: identity?.guestId })
      .then(s => { if (alive) setCityProofs(s.proofs); })
      .catch(() => { if (alive) setCityProofs([]); });
    return () => { alive = false; };
  }, [city, date, identity?.guestId]);

  if (failed) return <EmptyState icon="cloud-offline-outline" body={t('loadFailed')} />;
  if (!board) return <ActivityIndicator color={colors.primary} style={styles.loading} />;

  // One city's proofs, with the way back to every city.
  if (city) {
    return (
      <View style={styles.wrap}>
        <TouchableOpacity style={styles.back} onPress={() => setCity(null)} accessibilityRole="button" hitSlop={8}>
          <Ionicons name="chevron-back" size={18} color={colors.text} />
          <Text style={styles.backText}>{t('compare.allCities')}</Text>
        </TouchableOpacity>
        <View style={styles.cityHead}>
          <CityFlag country={city.country} size={20} />
          <Text style={styles.cityTitle}>{shortCityName(city.name)}</Text>
        </View>
        {cityProofs === null ? <ActivityIndicator color={colors.primary} style={styles.loading} /> : (
          <View style={styles.grid}>
            {cityProofs.map(p => (
              <View key={p.id} style={styles.cell}><DailyProofTile proof={p} onPress={() => onOpenProof(p)} /></View>
            ))}
          </View>
        )}
      </View>
    );
  }

  const type = board.compare?.type;
  const range = board.range;
  const prices = board.prices ?? null;
  const cheapest = prices ? money.fromEur(prices.cheapest.eur) : null;
  const priciest = prices ? money.fromEur(prices.priciest.eur) : null;
  const rangeKeys = type === 'time' ? ['compare.earliest', 'compare.latest'] : ['compare.lowest', 'compare.highest'];
  return (
    <View style={styles.wrap}>
      <Text style={styles.title} accessibilityRole="header">{t('compare.boardTitle')}</Text>
      {board.compare && <Text style={styles.question}>{board.compare.question}</Text>}
      {/* The empty board has nothing to count (COPY.md: "Already 5 countries answered"). */}
      {board.rows.length > 0 && <Text style={styles.count}>{t('compare.answeredRow', { count: board.countries })}</Text>}
      {range && (
        <Text style={styles.range}>
          {t(rangeKeys[0], { city: shortCityName(range.min.city.name), answer: range.min.answer ? answerText(range.min.answer, i18n.language) : '-' })}
          {'  ·  '}
          {t(rangeKeys[1], { city: shortCityName(range.max.city.name), answer: range.max.answer ? answerText(range.max.answer, i18n.language) : '-' })}
        </Text>
      )}
      {prices && cheapest && priciest && (
        <Text style={styles.range}>
          {t('compare.cheapest', { city: shortCityName(prices.cheapest.city.name), price: cheapest })}
          {'  ·  '}
          {t('compare.priciest', { city: shortCityName(prices.priciest.city.name), price: priciest })}
        </Text>
      )}
      {/* The fun fact, only from twice the price (COPY.md): surprise, never a ranking. */}
      {prices && prices.ratio !== null && prices.ratio >= 2 && (
        <Text style={styles.funFact}>
          {t('compare.funFact', {
            ratio: prices.ratio.toLocaleString(i18n.language, { maximumFractionDigits: prices.ratio >= 10 ? 0 : 1 }),
            city: shortCityName(prices.priciest.city.name), other: shortCityName(prices.cheapest.city.name),
          })}
        </Text>
      )}
      {board.rows.length === 0 ? (
        <EmptyState icon="earth-outline" title={t('compare.emptyTitle')} body={t('compare.emptyBody')}
                    action={onAnswer ? <Button size="sm" icon="camera-outline" label={t('ctaAnswerNoCity')} onPress={onAnswer} /> : undefined} />
      ) : (
        <View style={styles.table}>
          {board.rows.map((r, i) => {
            const price = money.fromEur(r.priceMedianEur);
            return (
              <TouchableOpacity key={r.city.id} style={[styles.row, i > 0 && styles.rowLine]} onPress={() => setCity(r.city)}
                                accessibilityRole="button" activeOpacity={0.7}>
                <CityFlag country={r.city.country} size={20} />
                <View style={styles.rowBody}>
                  <Text style={styles.cityName} numberOfLines={1}>{shortCityName(r.city.name)}</Text>
                  <Text style={[styles.answer, !r.answer && styles.answerNone]} numberOfLines={2}>
                    {r.answer ? answerText(r.answer, i18n.language) : t('compare.noAnswer')}
                  </Text>
                </View>
                <View style={styles.rowSide}>
                  {price && <Text style={styles.price}>{t('compare.median', { price })}</Text>}
                  <Text style={styles.proofs}>{t('compare.proofs', { count: r.count })}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.muted} />
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {/* Below the empty state, then below the board once players answered. */}
      <PicksMeanwhile picks={board.picks ?? []} />
    </View>
  );
}

/**
 * "Meanwhile, from our picks": the Hilads picks attached to the challenge, with
 * the pick's own checked answer. Editorial context, never a row of the board.
 */
function PicksMeanwhile({ picks }: { picks: NonNullable<DailyBoard['picks']> }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  if (picks.length === 0) return null;
  return (
    <View style={styles.picks}>
      <Text style={styles.title} accessibilityRole="header">{t('compare.picksTitle')}</Text>
      <View style={styles.table}>
        {picks.map((p, i) => (
          <TouchableOpacity key={p.place.id} style={[styles.row, i > 0 && styles.rowLine]} onPress={() => router.push(`/spot/${p.place.id}` as never)}
                            accessibilityRole="button" activeOpacity={0.7}>
            {p.photo ? <Image source={{ uri: p.photo.thumbUrl ?? p.photo.url }} style={styles.pickPhoto} contentFit="cover" />
              : <CityFlag country={p.city?.country} size={20} />}
            <View style={styles.rowBody}>
              <Text style={styles.cityName} numberOfLines={1}>{p.city?.name ? `${shortCityName(p.city.name)} · ${p.place.name}` : p.place.name}</Text>
              {p.answer && <Text style={styles.answer} numberOfLines={2}>{answerText(p.answer, i18n.language)}</Text>}
              <PickBadge />
            </View>
            <PickVoteButton pick={p} />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:       { gap: 10, paddingTop: 4 },
  loading:    { marginVertical: Spacing.lg },
  title:      { fontSize: FontSizes.sm, fontWeight: '800', color: c.muted },
  question:   { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  count:      { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  range:      { fontSize: FontSizes.xs, fontWeight: '700', color: c.text, backgroundColor: c.stepBg, borderRadius: 12, padding: 10, overflow: 'hidden' },
  funFact:    { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
  table:      { backgroundColor: c.bg2, borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, overflow: 'hidden' },
  row:        { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingHorizontal: 12, paddingVertical: 8 },
  rowLine:    { borderTopWidth: 1, borderTopColor: c.line },
  rowBody:    { flex: 1, gap: 2 },
  cityName:   { fontSize: FontSizes.xs, fontWeight: '700', color: c.muted },
  answer:     { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  answerNone: { color: c.mutedDim, fontWeight: '500' },
  rowSide:    { alignItems: 'flex-end', gap: 2 },
  price:      { fontSize: FontSizes.xs, fontWeight: '700', color: c.text },
  proofs:     { fontSize: 12, fontWeight: '500', color: c.muted },
  back:       { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, alignSelf: 'flex-start' },
  backText:   { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  cityHead:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cityTitle:  { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  grid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell:       { width: '48%' },
  picks:      { gap: 8, marginTop: 6 },
  pickPhoto:  { width: 52, height: 52, borderRadius: 10, backgroundColor: c.primaryTint },
});
