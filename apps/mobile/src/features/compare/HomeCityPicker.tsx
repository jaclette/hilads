import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { fetchChannels } from '@/api/channels';
import { localizeCityName } from '@/i18n/cityName';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, CityFlag, EmptyState, Sheet, TextField } from '@/ui';
import { FLAGS } from '@/ui/flags';
import type { City, HomeCityRef } from '@/types';

const RESULT_CAP = 30;

/** A country's name in the viewer's language when the engine knows it, else its code. */
function countryName(code: string, locale: string): string {
  try {
    const DN = (Intl as unknown as { DisplayNames?: new (l: string[], o: { type: string }) => { of: (c: string) => string | undefined } }).DisplayNames;
    return (DN ? new DN([locale], { type: 'region' }).of(code) : undefined) ?? code;
  } catch {
    return code;
  }
}

/**
 * "Where's home?" (SPEC 10.4): a search over Hilads' cities, or "My city
 * isn't listed": a typed name and its country (a flag list). Used by Back home
 * in the proof flow and by Settings.
 */
export function HomeCityPicker({ visible, selected, onPick, onClear, onClose }: {
  visible: boolean;
  selected: HomeCityRef | null;
  onPick: (city: HomeCityRef) => void;
  /** Settings: remove the home city. */
  onClear?: () => void;
  onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [other, setOther] = useState(false);
  const [name, setName] = useState('');
  const [country, setCountry] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setOther(false); setQuery(''); setName(''); setCountry(null);
    let alive = true;
    setLoading(true);
    fetchChannels()
      .then(list => { if (alive) setCities(list); })
      .catch(() => { if (alive) setCities([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? cities.filter(c => c.name.toLowerCase().includes(q) || localizeCityName(c.name).toLowerCase().includes(q))
      : cities;
    return list.slice(0, RESULT_CAP);
  }, [cities, query]);

  const countries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.keys(FLAGS)
      .map(code => ({ code, label: countryName(code, i18n.language) }))
      .filter(c => !q || c.label.toLowerCase().includes(q) || c.code.toLowerCase() === q)
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language));
  }, [query, i18n.language]);

  const closeLabel = t('cancel', { ns: 'common' });

  if (other) {
    const ready = name.trim() !== '' && country !== null;
    return (
      <Sheet visible={visible} onClose={onClose} closeLabel={closeLabel} style={styles.sheet}>
        <Text style={styles.title}>{t('backHome.otherTitle')}</Text>
        <TextField label={t('backHome.otherName')} value={name} onChangeText={v => setName(v.slice(0, 60))} maxLength={60}
                   placeholder={t('backHome.otherNamePlaceholder')} autoFocus />
        <Text style={styles.label}>{t('backHome.otherCountry')}</Text>
        <TextField variant="search" value={query} onChangeText={setQuery} onClear={() => setQuery('')}
                   clearLabel={t('clear', { ns: 'common' })} placeholder={t('backHome.countrySearch')} autoCorrect={false} />
        <FlatList
          data={countries}
          keyExtractor={c => c.code}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => setCountry(item.code)} accessibilityRole="button"
                              accessibilityState={{ selected: country === item.code }}>
              <CityFlag country={item.code} size={22} />
              <Text style={[styles.cityName, country === item.code && styles.selected]} numberOfLines={1}>{item.label}</Text>
              {country === item.code && <Ionicons name="checkmark" size={20} color={colors.primaryText} />}
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
        <Button label={t('backHome.otherSave')} disabled={!ready}
                onPress={() => { if (ready) onPick({ id: null, name: name.trim(), country: country! }); }} />
        <Button variant="link" label={t('backHome.otherBack')} onPress={() => { setOther(false); setQuery(''); }} />
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={closeLabel} style={styles.sheet}>
      <Text style={styles.title}>{t('backHome.askTitle')}</Text>
      <Text style={styles.sub}>{t('backHome.askSub')}</Text>
      <TextField variant="search" value={query} onChangeText={setQuery} onClear={() => setQuery('')}
                 clearLabel={t('clear', { ns: 'common' })} placeholder={t('backHome.searchPlaceholder')}
                 autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
      {loading ? (
        <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
      ) : filtered.length === 0 ? (
        <EmptyState body={t('backHome.noMatch')} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.channelId}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          renderItem={({ item }) => {
            const id = Number(item.channelId);
            const on = selected?.id === id;
            return (
              <TouchableOpacity style={styles.row} onPress={() => onPick({ id, name: item.name, country: item.country })}
                                accessibilityRole="button" accessibilityState={{ selected: on }}>
                <CityFlag country={item.country} size={22} />
                <Text style={[styles.cityName, on && styles.selected]} numberOfLines={1}>{localizeCityName(item.name)}</Text>
                {on && <Ionicons name="checkmark" size={20} color={colors.primaryText} />}
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
      <Button variant="secondary" icon="create-outline" label={t('backHome.notListed')} onPress={() => { setOther(true); setQuery(''); }} />
      {onClear && selected && <Button variant="link" label={t('backHome.clear')} onPress={onClear} />}
    </Sheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheet:    { maxHeight: '85%' },
  title:    { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  sub:      { fontSize: FontSizes.sm, color: c.muted, marginTop: -4 },
  label:    { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  list:     { flexGrow: 0, maxHeight: 300 },
  empty:    { padding: Spacing.lg, alignItems: 'center' },
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  cityName: { flex: 1, fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  selected: { color: c.primaryText },
  sep:      { height: 1, backgroundColor: c.line, marginLeft: 34 },
});
