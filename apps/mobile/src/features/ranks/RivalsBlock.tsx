import { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchUserDaily } from '@/api/daily';
import { shortCityName } from '@/i18n/cityName';
import { FlagSticker } from '@/ui/joy';
import type { DailyUserStats } from '@/types';

type Rival = NonNullable<DailyUserStats['comparedCities']>[number];

/**
 * Your rivals (V6) in World › Cities (moved from Passport in the UX audit: one place to compare
 * cities): the cities I played the same challenges as, most duels first; a tap opens the face-off.
 * Members only; nothing while loading.
 */
export function RivalsBlock() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('me');
  const router = useRouter();
  const { account } = useApp();
  const [rivals, setRivals] = useState<Rival[] | null>(null);
  useEffect(() => {
    if (!account) return;
    let alive = true;
    fetchUserDaily(account.id).then(s => { if (alive) setRivals(s.comparedCities ?? []); }).catch(() => {});
    return () => { alive = false; };
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!account || rivals === null) return null;
  return (
    <View style={styles.block} testID="world-rivals">
      <Text style={styles.title}>⚔️ {t('passport.rivals')}</Text>
      {rivals.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {rivals.map(c => (
            <TouchableOpacity key={c.id} style={styles.chip} accessibilityRole="button"
                              accessibilityLabel={`${shortCityName(c.name ?? '')}, ${t('passport.duels', { count: c.duels ?? 1 })}`}
                              onPress={() => router.push(`/rivals/${c.id}?user=${account.id}` as never)}>
              <FlagSticker country={c.country} size={22} />
              <View>
                <Text style={styles.name} numberOfLines={1}>{shortCityName(c.name ?? '')}</Text>
                {!!c.duels && <Text style={styles.duels}>{t('passport.duels', { count: c.duels })}</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.empty}>{t('passport.rivalsEmpty')}</Text>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  block: { gap: 8 },
  title: { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  row:   { gap: 8 },
  chip:  { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingLeft: 6, paddingRight: 12, borderRadius: Radius.full,
           borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  name:  { fontSize: FontSizes.xs, fontWeight: '700', color: c.text, maxWidth: 120 },
  duels: { fontSize: FontSizes.tiny, fontWeight: '700', color: c.muted },
  empty: { fontSize: FontSizes.sm, fontWeight: '600', color: c.muted },
});
