import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { track } from '@/services/analytics';
import { useDailyArchive, useDailyGuide } from '@/hooks/useDaily';
import { LeaderboardCityPickerSheet } from '@/features/challenge/LeaderboardCityPickerSheet';
import { DailyHeroCard } from './DailyHeroCard';
import { formatAmount } from './currency';
import { OriginalToggle, useOriginal } from './OriginalToggle';
import { DailyWeekStrip } from './DailyWeekStrip';
import { THEME_EMOJI, THEME_KEYS, nextThemeDay, themeLabel, ymd } from './themes';
import { trackLocalPassEarned } from './localPassTracking';
import type { DailyArchiveItem, DailyLocalPassProgress, DailyThemeKey } from '@/types';

/**
 * Top of the CHALLENGES tab, in three tiers (SPEC 8.4):
 * 1. Today: the hero card (theme, Local Twist, countdown, my proof, CTA, top 3);
 * 2. the week strip (and the month calendar behind it);
 * 3. the city guide: my Local Pass progress in the city, theme chips, and past
 *    challenges as informative cards (best proof, the city's Local Twist, price
 *    range, proof count, pinned places), newest first.
 * The city defaults to the user's and can be changed to explore before visiting
 * (it never changes the user's city). A dead city shows the World selection.
 */
export function DailyChallengesSection() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const { city, account } = useApp();
  const [picked, setPicked] = useState<{ channelId: string; name: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [theme, setTheme] = useState<DailyThemeKey | null>(null);
  const cityId   = picked?.channelId ?? city?.channelId ?? null;
  const cityName = picked?.name ?? city?.name ?? '';
  const archive  = useDailyArchive(cityId, theme);
  const guide    = useDailyGuide(cityId);
  const router   = useRouter();

  useEffect(() => { trackLocalPassEarned(guide?.localPass, account?.id); }, [guide?.localPass, account?.id]);

  const pickTheme = (key: DailyThemeKey | null) => {
    setTheme(key);
    track('daily_theme_filter_used', { theme: key ?? 'all', city: cityName || null, scope: guide?.scope ?? null });
  };
  const counts = new Map(guide?.themes.map(g => [g.theme.key, g.challengesDone]) ?? []);
  const themeName = theme ? guide?.themes.find(g => g.theme.key === theme)?.theme.name ?? theme : '';

  return (
    <View style={styles.wrap}>
      {city && <DailyHeroCard cityId={city.channelId} source="challenges_tab" />}

      <DailyWeekStrip />

      <View style={styles.headRow}>
        <Text style={styles.title}>{t('guide.title')}</Text>
        <View style={styles.headActions}>
          {archive.items.some(i => i.pinnedPlaces > 0) && (
            <TouchableOpacity
              style={styles.cityChip}
              onPress={() => router.push(`/daily/places?cityId=${cityId ?? ''}&cityName=${encodeURIComponent(cityName)}&source=archive` as never)}
              accessibilityRole="button"
            >
              <Text style={styles.cityChipText}>🗺️ {t('map.button')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.cityChip} onPress={() => setPickerOpen(true)} accessibilityRole="button" accessibilityLabel={t('archive.pickCity')}>
            <Text style={styles.cityChipText} numberOfLines={1}>📍 {localizeCityName(cityName)}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>
      {archive.scope === 'world' && archive.items.length > 0 && (
        <Text style={styles.scopeNote}>🌍 {t('archive.worldSelection')}</Text>
      )}

      {guide?.localPass && <LocalPassProgress progress={guide.localPass} />}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <TouchableOpacity style={[styles.chip, theme === null && styles.chipOn]} onPress={() => pickTheme(null)} accessibilityRole="button" accessibilityState={{ selected: theme === null }}>
          <Text style={[styles.chipText, theme === null && styles.chipTextOn]}>{t('guide.all')}</Text>
        </TouchableOpacity>
        {(guide?.themes ?? []).map(g => (
          <TouchableOpacity key={g.theme.key} style={[styles.chip, theme === g.theme.key && styles.chipOn]} onPress={() => pickTheme(g.theme.key)} accessibilityRole="button" accessibilityState={{ selected: theme === g.theme.key }}>
            <Text style={[styles.chipText, theme === g.theme.key && styles.chipTextOn]}>
              {themeLabel(g.theme)}{counts.get(g.theme.key) ? ` · ${counts.get(g.theme.key)}` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {archive.loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : archive.items.length === 0 ? (
        <Text style={styles.empty}>
          {theme
            ? (archive.scope === 'city'
              ? t('guide.emptyCity', { theme: themeName, city: localizeCityName(cityName), day: nextThemeDay(theme, ymd(new Date()), i18n.language) })
              : t('guide.emptyWorld', { theme: themeName, day: nextThemeDay(theme, ymd(new Date()), i18n.language) }))
            : t('archive.empty')}
        </Text>
      ) : (
        <FlatList
          horizontal
          data={archive.items}
          keyExtractor={i => i.challenge.id}
          renderItem={({ item }) => <ArchiveCard item={item} cityLabel={archive.scope === 'city' ? localizeCityName(cityName) : null} />}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          onEndReached={archive.loadMore}
          onEndReachedThreshold={0.6}
          ListFooterComponent={archive.loadingMore ? <ActivityIndicator color={colors.accent} style={styles.moreLoader} /> : null}
        />
      )}

      <LeaderboardCityPickerSheet
        visible={pickerOpen}
        selectedChannelId={cityId}
        onSelect={(channelId, c) => { setPicked({ channelId, name: c.name }); setPickerOpen(false); }}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

function ArchiveCard({ item, cityLabel }: { item: DailyArchiveItem; cityLabel: string | null }) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const [showOriginal, toggleOriginal] = useOriginal();
  const photo = item.bestProof ? (item.bestProof.thumbUrl ?? item.bestProof.photoUrl) : null;
  const count = cityLabel !== null ? (item.counts.city ?? 0) : item.counts.world;
  const open = () => {
    track('daily_challenge_viewed', { source: 'archive', challenge_date: item.challenge.date, city: cityLabel });
    router.push(`/daily/${item.challenge.date}` as never);
  };
  return (
    <TouchableOpacity style={styles.card} onPress={open} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={item.challenge.text}>
      {photo
        ? <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" transition={150} />
        : <View style={[styles.photo, styles.photoEmpty]}><Text style={styles.photoEmptyText}>🔥</Text></View>}
      <View style={styles.body}>
        <Text style={styles.date}>{item.challenge.date}{item.challenge.theme ? ` · ${themeLabel(item.challenge.theme)}` : ''}</Text>
        <Text style={styles.text} numberOfLines={3}>{showOriginal && item.challenge.original ? item.challenge.original.text : item.challenge.text}</Text>
        {item.twist && <Text style={styles.twist} numberOfLines={2}>📍 {showOriginal && item.twist.originalText ? item.twist.originalText : item.twist.text}</Text>}
        <OriginalToggle translated={!!item.challenge.original || !!item.twist?.originalText} showingOriginal={showOriginal} onPress={toggleOriginal} />
        {item.bestProof && item.bestProof.voteCount > 0 && (
          <Text style={styles.best} numberOfLines={1}>
            🏆 {item.bestProof.user.displayName || item.bestProof.user.username} · ♥ {item.bestProof.voteCount}
          </Text>
        )}
        <Text style={styles.meta} numberOfLines={1}>
          {t('archive.proofs', { count })}
          {item.priceRange ? ` · 💸 ${formatAmount(item.priceRange.min, i18n.language)}${item.priceRange.max !== item.priceRange.min ? `-${formatAmount(item.priceRange.max, i18n.language)}` : ''} ${item.priceRange.currency}` : ''}
        </Text>
        {item.pinnedPlaces > 0 && <Text style={styles.meta}>📍 {t('places', { count: item.pinnedPlaces })}</Text>}
      </View>
    </TouchableOpacity>
  );
}

/** My Local Pass progress in the guide's city: 7 theme marks, or "Earned". */
function LocalPassProgress({ progress }: { progress: DailyLocalPassProgress }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const city = localizeCityName(progress.city.name ?? '');
  return (
    <View style={[styles.pass, progress.earned && styles.passEarned]}>
      <View style={styles.passHead}>
        <Text style={styles.passTitle} numberOfLines={1}>🎫 {t('localPass.name')} · {city}</Text>
        <Text style={styles.passCount}>{progress.earned ? `✓ ${t('localPass.earned')}` : t('localPass.progress', { done: progress.done, total: progress.total })}</Text>
      </View>
      <View style={styles.passThemes}>
        {THEME_KEYS.map(k => (
          <Text key={k} style={[styles.passTheme, !progress.themes.includes(k) && styles.passThemeOff]}>{THEME_EMOJI[k]}</Text>
        ))}
      </View>
      {!progress.earned && progress.done === 0 && <Text style={styles.passHint}>{t('localPass.hint', { city })}</Text>}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  chips:         { gap: 6, paddingRight: 4 },
  chip:          { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg2 },
  chipOn:        { backgroundColor: c.accent, borderColor: c.accent },
  chipText:      { fontSize: FontSizes.xs, fontWeight: '700', color: c.text },
  chipTextOn:    { color: c.white },
  pass:          { backgroundColor: c.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, padding: 12, gap: 6 },
  passEarned:    { borderColor: c.accent },
  passHead:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  passTitle:     { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '800', color: c.text },
  passCount:     { fontSize: FontSizes.xs, fontWeight: '800', color: c.accentText },
  passThemes:    { flexDirection: 'row', justifyContent: 'space-between' },
  passTheme:     { fontSize: 20 },
  passThemeOff:  { opacity: 0.25 },
  passHint:      { fontSize: 12, color: c.muted },
  wrap:          { gap: 10, marginBottom: 14 },
  headRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 6 },
  title:         { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  headActions:   { flexDirection: 'row', gap: 6, flexShrink: 1 },
  cityChip:      { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 200, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg2 },
  cityChipText:  { fontSize: FontSizes.xs, fontWeight: '700', color: c.text, flexShrink: 1 },
  scopeNote:     { fontSize: 12, color: c.muted },
  loader:        { marginVertical: 20 },
  moreLoader:    { marginHorizontal: 20, alignSelf: 'center' },
  empty:         { fontSize: FontSizes.sm, color: c.muted, paddingVertical: 12 },
  row:           { gap: 10, paddingRight: 4 },
  card:          { width: 220, backgroundColor: c.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, overflow: 'hidden' },
  photo:         { width: '100%', height: 120, backgroundColor: c.bg3 },
  photoEmpty:    { alignItems: 'center', justifyContent: 'center' },
  photoEmptyText:{ fontSize: 30 },
  body:          { padding: 10, gap: 4 },
  date:          { fontSize: 11, fontWeight: '700', color: c.muted },
  text:          { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  twist:         { fontSize: 12, color: c.accentText },
  meta:          { fontSize: 11, color: c.muted },
  best:          { fontSize: 12, fontWeight: '700', color: c.text },
});
