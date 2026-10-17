import { useCallback, useState, type ReactNode } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { fetchPeopleCounts, type PeopleCounts } from '@/api/people';

const REFRESH_MS = 60_000;

/**
 * The Chat people row (SPEC 9.6, chat.html): Hi now, tonight's plans with who
 * is going, arrivals this week and people here now. Shown only above the
 * threshold: the API returns no count below it, and an empty row is hidden.
 */
export function PeopleRow({ cityId, onArrivals }: { cityId: string; onArrivals: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('chat');
  const router = useRouter();
  const [counts, setCounts] = useState<PeopleCounts | null>(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    const load = () => fetchPeopleCounts(cityId).then(c => { if (alive) setCounts(c); }).catch(() => {});
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, [cityId]));

  if (!counts) return null;
  const chips: ReactNode[] = [];
  if (counts.hiNow !== null) {
    chips.push(
      <TouchableOpacity key="hinow" style={[styles.chip, styles.accent]} onPress={() => router.push('/(tabs)/events' as never)} accessibilityRole="button"
                        accessibilityLabel={t('people.hiNowA11y', { count: counts.hiNow })}>
        <Ionicons name="hand-left-outline" size={17} color={colors.primaryOnTint} />
        <Text style={styles.accentText}>{t('people.hiNow')}</Text>
      </TouchableOpacity>,
    );
  }
  for (const p of counts.tonight) {
    const time = new Date(p.startsAt * 1000).toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit' });
    chips.push(
      <TouchableOpacity key={p.id} style={styles.chip} onPress={() => router.push(`/event/${p.id}` as never)} accessibilityRole="button">
        <Text style={styles.bold} numberOfLines={1}>{p.title}, {time}</Text>
        {p.going !== null && <Text style={styles.muted}>{t('people.going', { count: p.going })}</Text>}
      </TouchableOpacity>,
    );
  }
  if (counts.arrivalsWeek !== null) {
    chips.push(
      <TouchableOpacity key="arrivals" style={styles.chip} onPress={onArrivals} accessibilityRole="button">
        <Text style={styles.text}>{t('people.arrivals', { count: counts.arrivalsWeek })}</Text>
      </TouchableOpacity>,
    );
  }
  if (counts.nearby !== null) {
    chips.push(
      <TouchableOpacity key="nearby" style={styles.chip} onPress={() => router.push('/(tabs)/here' as never)} accessibilityRole="button">
        <View style={styles.dot} />
        <Text style={styles.text}>{t('people.nearby', { count: counts.nearby })}</Text>
      </TouchableOpacity>,
    );
  }
  if (chips.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {chips}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row:        { gap: 8 },
  chip:       { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: Radius.full,
                borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2, maxWidth: 260 },
  accent:     { borderColor: c.primary, gap: 6 },
  accentText: { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryOnTint },
  bold:       { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  text:       { fontSize: FontSizes.sm, fontWeight: '600', color: c.text },
  muted:      { fontSize: FontSizes.sm, fontWeight: '600', color: c.muted },
  dot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: c.green },
});
