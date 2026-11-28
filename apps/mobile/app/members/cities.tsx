import { useEffect, useMemo, useState } from 'react';
import { FlatList, Text, TextInput, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Space, Gutter, Radius, Type, Border, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, CityFlag, EmptyState, ScreenHeader, Tappable } from '@/ui';
import { fetchMembersSummary, type MemberCity } from '@/api/members';

/** Every city with members, searchable (the World's "See all"): a tap shows that city's crew in Members. */
export default function MembersCitiesScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('members');
  const router = useRouter();
  const [cities, setCities] = useState<(MemberCity & { members: number })[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  const load = () => { setFailed(false); fetchMembersSummary({ scope: 'world' }).then(s => setCities(s.cities ?? [])).catch(() => setFailed(true)); };
  useEffect(load, []);

  const shown = useMemo(() => {
    const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const q = fold(query.trim());
    return (cities ?? []).filter(c => !q || fold(c.name).includes(q));
  }, [cities, query]);

  const pick = (c: MemberCity) => router.navigate({ pathname: '/members', params: { scope: 'world', filterCity: String(c.id) } } as never);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={t('allCitiesTitle')} />
      <View style={styles.search}>
        <Ionicons name="search-outline" size={18} color={colors.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder={t('searchCityList')} placeholderTextColor={colors.muted}
                   style={styles.searchInput} autoCorrect={false} autoFocus accessibilityLabel={t('searchCityList')} />
      </View>
      <FlatList
        data={shown}
        keyExtractor={c => String(c.id)}
        renderItem={({ item }) => (
          <Tappable style={styles.row} onPress={() => pick(item)} accessibilityRole="button" accessibilityLabel={t('cityA11y', { city: item.name, count: item.members })}>
            <CityFlag country={item.country} size={20} />
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.count}>{t('memberCount', { count: item.members })}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Tappable>
        )}
        ItemSeparatorComponent={() => <View style={{ height: Space.xs }} />}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={failed
          ? <EmptyState icon="cloud-offline-outline" title={t('errorTitle')} body={t('errorBody')} action={<Button variant="secondary" label={t('retry')} onPress={load} />} />
          : cities === null ? <View style={styles.skeletons}>{[0, 1, 2, 3, 4].map(i => <View key={i} style={styles.skeleton} />)}</View>
          : <EmptyState icon="search-outline" body={t('noCityResults', { q: query.trim() })} />}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:   { flex: 1, backgroundColor: c.bg },
  search:      { flexDirection: 'row', alignItems: 'center', gap: Space.sm, height: 44, marginHorizontal: Gutter, marginBottom: Space.md,
                 paddingHorizontal: Space.md, borderRadius: Radius.control, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  searchInput: { flex: 1, ...Type.body, color: c.text, paddingVertical: 0 },
  list:        { paddingHorizontal: Gutter, paddingBottom: Space.xxl },
  row:         { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 56, paddingHorizontal: Space.md, borderRadius: Radius.card, backgroundColor: c.bg2 },
  name:        { ...Type.label, fontSize: 15, color: c.text, flex: 1 },
  count:       { ...Type.caption, color: c.muted },
  skeletons:   { gap: Space.xs },
  skeleton:    { height: 56, borderRadius: Radius.card, backgroundColor: c.bg3 },
});
