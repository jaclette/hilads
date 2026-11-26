import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Space, Gutter, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, Card, CityFlag, Screen, ScreenHeader, Sheet, SheetFlatList, SheetTitle, TextField } from '@/ui';
import { FLAGS } from '@/ui/flags';
import { countryName } from '@/features/compare/HomeCityPicker';
import { fetchContest, joinContest, type ContestOverview } from '@/features/contest/contest';
import { refreshContestTab } from '@/features/contest/useContestTab';
import { track } from '@/services/analytics';

/**
 * Join the Launch Season (once): 18+, a country, the rules accepted (link to the public
 * page). Joining never gates posting; it only makes the photos count for the contest.
 */
export default function ContestJoinScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t, i18n } = useTranslation('me');
  const [data, setData] = useState<ContestOverview | null>(null);
  const [age, setAge] = useState(false);
  const [rules, setRules] = useState(false);
  const [country, setCountry] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchContest(i18n.language).then(d => {
      setData(d);
      const cc = d.me && d.me.joined === false ? d.me.suggestedCountry : null;
      if (cc && FLAGS[cc as keyof typeof FLAGS]) setCountry(cc);
    }).catch(() => setError(t('contest.error')));
  }, [t, i18n.language]);

  const countries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.keys(FLAGS)
      .map(code => ({ code, label: countryName(code, i18n.language) }))
      .filter(c => !q || c.label.toLowerCase().includes(q) || c.code.toLowerCase() === q)
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language));
  }, [query, i18n.language]);

  const season = data?.season;
  const ready = !!season && age && rules && !!country && !busy;
  const back = () => (router.canGoBack() ? router.back() : router.navigate('/(tabs)/trip' as never));

  const join = async () => {
    if (!ready || !season || !country) return;
    setBusy(true);
    setError(null);
    try {
      await joinContest(season.id, country);
      refreshContestTab();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      track('contest_joined', { test: season.isTest });
      // The campaign is a tab: back to it (navigate pops this screen instead of stacking a copy).
      router.navigate('/(tabs)/trip' as never);
    } catch (e) {
      const code = (e as { body?: { code?: string } })?.body?.code;
      setError(code === 'closed' ? t('contest.closed') : t('contest.cantJoin'));
    } finally {
      setBusy(false);
    }
  };

  const Check = ({ on, onPress, label, testID }: { on: boolean; onPress: () => void; label: string; testID: string }) => (
    <Pressable style={styles.check} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} testID={testID}>
      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={26} color={on ? colors.cta : colors.muted} />
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={t('contest.join')} onBack={back} testID="contest-join" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.emoji} accessibilityElementsHidden importantForAccessibility="no">🚀</Text>
        <Text style={styles.title}>{season?.name ?? t('contest.title')}</Text>
        <Text style={styles.text}>{t('contest.joinText')}</Text>

        <Card style={styles.card}>
          <Check on={age} onPress={() => setAge(v => !v)} label={t('contest.age')} testID="contest-age" />
          <Text style={styles.label}>{t('contest.country')}</Text>
          <TouchableOpacity style={styles.country} onPress={() => setPicking(true)} accessibilityRole="button" testID="contest-country"
                            accessibilityLabel={`${t('contest.country')}: ${country ? countryName(country, i18n.language) : t('contest.countryPick')}`}>
            {country ? <CityFlag country={country} size={22} /> : <Ionicons name="earth-outline" size={IconSize.md} color={colors.muted} />}
            <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>{country ? countryName(country, i18n.language) : t('contest.countryPick')}</Text>
            <Ionicons name="chevron-down" size={IconSize.sm} color={colors.muted} />
          </TouchableOpacity>
          <Check on={rules} onPress={() => setRules(v => !v)} label={t('contest.accept')} testID="contest-rules" />
          {season && (
            <Pressable onPress={() => Linking.openURL(season.rulesUrl)} accessibilityRole="link" hitSlop={8} style={styles.link}>
              <Text style={styles.linkText}>{t('contest.rules')}</Text>
              <Ionicons name="open-outline" size={IconSize.sm} color={colors.primaryText} />
            </Pressable>
          )}
        </Card>
        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.footer}>
        <Button icon="rocket-outline" label={t('contest.join')} onPress={join} disabled={!ready} loading={busy} testID="contest-join-submit" />
      </View>

      <Sheet visible={picking} onClose={() => setPicking(false)} closeLabel={t('cancel', { ns: 'common' })} style={styles.sheet}>
        <SheetTitle>{t('contest.countryPick')}</SheetTitle>
        <TextField variant="search" value={query} onChangeText={setQuery} onClear={() => setQuery('')}
                   clearLabel={t('clear', { ns: 'common' })} placeholder={t('contest.countrySearch')} autoCorrect={false} />
        <SheetFlatList
          data={countries}
          keyExtractor={c => c.code}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => { setCountry(item.code); setPicking(false); setQuery(''); }}
                              accessibilityRole="button" accessibilityState={{ selected: country === item.code }}>
              <CityFlag country={item.code} size={22} />
              <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>{item.label}</Text>
              {country === item.code && <Ionicons name="checkmark" size={20} color={colors.primaryText} />}
            </TouchableOpacity>
          )}
        />
      </Sheet>
    </Screen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  body:       { paddingHorizontal: Gutter, paddingBottom: Space.xxl, gap: Space.md },
  emoji:      { fontSize: 48, textAlign: 'center', marginTop: Space.md },
  title:      { ...Type.title, color: c.text, textAlign: 'center' },
  text:       { ...Type.body, color: c.text },
  label:      { ...Type.caption, fontWeight: '800', color: c.muted, marginTop: Space.xs },
  card:       { padding: Space.md, gap: Space.sm },
  check:      { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48 },
  checkLabel: { ...Type.body, color: c.text, flex: 1 },
  country:    { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48, paddingHorizontal: Space.md,
                borderRadius: Radius.control, borderWidth: 1, borderColor: c.line },
  link:       { flexDirection: 'row', alignItems: 'center', gap: Space.xs, minHeight: 44 },
  linkText:   { ...Type.label, fontWeight: '800', color: c.primaryText },
  error:      { ...Type.caption, color: c.red, textAlign: 'center' },
  footer:     { paddingHorizontal: Gutter, paddingTop: Space.sm, paddingBottom: Space.sm },
  sheet:      { maxHeight: '85%' },
  row:        { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48, paddingHorizontal: Space.xs },
});
