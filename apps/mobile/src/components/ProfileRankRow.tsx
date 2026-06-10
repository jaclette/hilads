import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { RankBadge } from './RankBadge';
import { countryToFlag } from '../lib/countryFlag';
import { Colors } from '@/constants';
import type { MonthlyRank } from '@/types';

/**
 * Monthly rank section for profile screens (own + other-user).
 *
 * Two rows:
 *   {city-flag}  [Badge]  #N in {city}      ← city scope
 *   🌐           [Badge]  #N worldwide      ← global scope
 *
 * Three states per row (driven by the bounded MonthlyRank shape):
 *   - rank ≤ 10           → RankBadge inline + "#N in {city}" / "#N worldwide"
 *   - 11 ≤ rank ≤ 100     → no badge, "#N in {city}" / "#N worldwide"
 *   - rank null + score>0 → "Outside the top {{topN}}…" (reuse beyond copy)
 *   - rank null + score=0 → "Not ranked this month…" (new copy)
 *
 * Whole block hides itself when there's nothing meaningful to show: no
 * current city AND no global rank AND no monthly score. Otherwise it
 * renders both rows (the world row always renders since it's available
 * to every user regardless of city).
 */
export function ProfileRankRow({
  rank,
  cityName,
  cityCountry,
}: {
  rank?: MonthlyRank | null;
  cityName?: string | null;
  cityCountry?: string | null;
}) {
  const { t } = useTranslation('challenge');

  if (!rank) return null;
  const { city, global, score_month: score, has_city: hasCity, top_n: topN } = rank;
  // Hide entirely when the user has neither a city scope nor any
  // monthly score - there is literally nothing to convey. New
  // registrations without geolocation hit this path.
  if (!hasCity && score === 0 && global == null) return null;

  const flag = cityCountry ? countryToFlag(cityCountry) : '📍';

  const cityLine =
    !hasCity || !cityName
      ? null // user has no resolved city → suppress the city row
      : city != null
        ? t('scoreCelebration.rank.city', { rank: city, city: cityName })
        : score > 0
          ? t('scoreCelebration.rank.cityBeyond', { topN })
          : t('scoreCelebration.rank.cityUnranked', { city: cityName });

  const worldLine =
    global != null
      ? t('scoreCelebration.rank.world', { rank: global })
      : score > 0
        ? t('scoreCelebration.rank.worldBeyond', { topN })
        : t('scoreCelebration.rank.worldUnranked');

  return (
    <View style={styles.wrap}>
      {cityLine ? (
        <View style={styles.row}>
          <Text style={styles.emoji}>{flag}</Text>
          {city != null ? (
            <View style={styles.badgeSlot}>
              <RankBadge rank={city} size={22} />
            </View>
          ) : null}
          <Text style={styles.line} numberOfLines={1}>{cityLine}</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <Text style={styles.emoji}>🌐</Text>
        {global != null ? (
          <View style={styles.badgeSlot}>
            <RankBadge rank={global} size={22} />
          </View>
        ) : null}
        <Text style={styles.line} numberOfLines={1}>{worldLine}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop:        12,
    paddingHorizontal: 16,
    paddingVertical:   10,
    backgroundColor:   Colors.bg2,
    borderRadius:      12,
    gap:               6,
  },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  emoji: {
    fontSize: 18,
    width:    22,
    textAlign: 'center',
  },
  badgeSlot: {
    // Reserves stable horizontal space for the RankBadge so the text
    // baseline doesn't jump between top-10 and 11-100 ranks.
    width:           24,
    height:          22,
    alignItems:      'center',
    justifyContent:  'center',
  },
  line: {
    flex:     1,
    color:    Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
});
