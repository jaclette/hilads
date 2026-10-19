import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { fetchCompared } from '@/api/daily';
import { track } from '@/services/analytics';
import { SectionTitle } from '@/ui';
import { ShareSheet } from '@/features/share/ShareSheet';
import type { ShareContent } from '@/features/share/content';
import type { DailyCompared } from '@/types';
import { ComparisonCard, comparisonShare, useComparisonValue } from './ComparisonCard';

const CARD_W = 272;
const CARD_ROWS = 5;

/**
 * "The world, compared" on Today (SPEC 10.9): last week's comparisons, one
 * card per shared key with at least 2 cities of 3 answers or more, then "See
 * all comparisons". A card opens the Index screen on it. Readable without an
 * account; nothing when no card qualifies.
 */
export function IndexCarousel({ refreshKey = 0 }: { refreshKey?: number }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const value = useComparisonValue();
  const [data, setData] = useState<DailyCompared | null>(null);
  const [share, setShare] = useState<ShareContent | null>(null);
  const swiped = useRef(false);

  const load = useCallback(() => {
    fetchCompared('week').then(setData).catch(() => setData(null));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || data.cards.length === 0) return null;
  const open = (focus: string | null, source: string) => {
    track('index_opened', { source, focus });
    router.push(`/daily/compared?source=${source}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}` as never);
  };

  return (
    <View style={styles.wrap}>
      <SectionTitle small title={t('index.carouselTitle')} />
      <Text style={styles.sub}>{t('index.carouselSub')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}
                  snapToInterval={CARD_W + 10} decelerationRate="fast"
                  onScrollBeginDrag={() => {
                    if (swiped.current) return;
                    swiped.current = true;
                    track('index_carousel_swiped', { cards: data.cards.length });
                  }}>
        {data.cards.map(card => (
          <ComparisonCard key={`${card.kind}:${card.key}`} card={card} rows={CARD_ROWS} style={styles.card}
                          onPress={() => open(`${card.kind}:${card.key}`, 'carousel_card')}
                          onShare={() => {
                            track('index_shared', { card: card.key, source: 'today_carousel' });
                            setShare(comparisonShare(card, t, value));
                          }} />
        ))}
        <TouchableOpacity style={[styles.card, styles.all]} onPress={() => open(null, 'carousel_all')} accessibilityRole="button">
          <Ionicons name="earth-outline" size={28} color={colors.primaryText} />
          <Text style={styles.allText}>{t('index.seeAllComparisons')}</Text>
          <Ionicons name="arrow-forward" size={20} color={colors.text} />
        </TouchableOpacity>
      </ScrollView>
      <ShareSheet content={share} source="index_today" onClose={() => setShare(null)} />
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:    { gap: 4 },
  sub:     { fontSize: 13, fontWeight: '500', color: c.muted, marginBottom: 4 },
  row:     { gap: 10, paddingRight: 4 },
  card:    { width: CARD_W },
  all:     { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 14, borderRadius: Radius.card, borderWidth: Border,
             borderColor: c.line, backgroundColor: c.bg2, minHeight: 180 },
  allText: { fontSize: FontSizes.md, fontWeight: '800', color: c.text, textAlign: 'center' },
});
