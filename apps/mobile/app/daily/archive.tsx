import { useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { useScope } from '@/context/ScopeContext';
import { useDailyArchive } from '@/hooks/useDaily';
import { THEME_KEYS, themeName } from '@/features/daily/themes';
import { THEME_ICON } from '@/features/today/format';
import type { DailyArchiveItem, DailyThemeKey } from '@/types';
import { Chip, EmptyState, Screen, ScreenHeader } from '@/ui';

/**
 * All past challenges (SPEC 9.3, Today's "All past challenges"): newest first,
 * each with its date, theme, text, a mosaic of its best photos and its counts
 * (proofs, countries in World). Theme chips filter; a challenge opens its
 * sheet, read-only. In the app's scope: World, or a live city's proofs.
 * Readable without an account. Paged by date.
 */
export default function DailyArchiveScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { city } = useApp();
  const { scope } = useScope();
  const [theme, setTheme] = useState<DailyThemeKey | null>(null);
  const archive = useDailyArchive(city?.channelId ?? null, theme, scope === 'city' && city ? 'city' : 'world');

  const chips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      <Chip variant="filter" label={t('today.archiveAll')} selected={theme === null} onPress={() => setTheme(null)} />
      {THEME_KEYS.map(k => (
        <Chip key={k} variant="filter" icon={THEME_ICON[k]} label={themeName(k)} selected={theme === k} onPress={() => setTheme(k)} />
      ))}
    </ScrollView>
  );

  return (
    <Screen>
      <ScreenHeader title={t('today.archiveTitle')} />
      <FlatList
        data={archive.items}
        keyExtractor={item => item.challenge.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={chips}
        ListEmptyComponent={archive.loading
          ? <ActivityIndicator color={colors.primary} style={styles.loading} />
          : <EmptyState icon="calendar-outline" body={t('today.archiveEmpty')} />}
        ListFooterComponent={archive.loadingMore ? <ActivityIndicator color={colors.primary} style={styles.loading} /> : null}
        onEndReached={archive.loadMore}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => (
          <ArchiveCard item={item} world={archive.scope === 'world'}
                       onPress={() => router.push(`/daily/${item.challenge.date}?source=archive` as never)} />
        )}
      />
    </Screen>
  );
}

function ArchiveCard({ item, world, onPress }: { item: DailyArchiveItem; world: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('daily');
  const c = item.challenge;
  const count = world ? item.counts.world : item.counts.city ?? item.counts.world;
  const proofs = t('today.proofs', { count });
  const photos = (item.photos ?? []).slice(0, 4);
  const date = new Date(`${c.date}T12:00:00Z`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`${date}: ${c.text}`}>
      <View style={styles.head}>
        <Text style={styles.muted}>{date}</Text>
        {!!c.theme && <Chip icon={THEME_ICON[c.theme.key] ?? 'pricetag-outline'} label={themeName(c.theme.key)} />}
      </View>
      <Text style={styles.text}>{c.text}</Text>
      {photos.length > 0 && (
        <View style={styles.mosaic}>
          {photos.map(p => <Image key={p.proofId} source={{ uri: p.thumbUrl ?? undefined }} style={styles.tile} contentFit="cover" />)}
        </View>
      )}
      <Text style={styles.muted}>
        {count > 0 && world ? t('today.proofsIn', { proofs, countries: t('today.countries', { count: item.counts.countries ?? 0 }) }) : proofs}
      </Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  list:    { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xl, gap: 12 },
  chips:   { gap: 8, paddingBottom: 4 },
  loading: { marginVertical: 24 },
  card:    { gap: 8, padding: 14, borderRadius: 18, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2 },
  head:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  text:    { fontSize: FontSizes.md, lineHeight: 22, fontWeight: '800', color: c.text },
  mosaic:  { flexDirection: 'row', gap: 4, height: 120, borderRadius: Radius.md, overflow: 'hidden' },
  tile:    { flex: 1, height: '100%', backgroundColor: c.bg3 },
  muted:   { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
});
