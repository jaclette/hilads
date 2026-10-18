import { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { fetchChannels } from '@/api/channels';
import { localizeCityName } from '@/i18n/cityName';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { CityFlag, EmptyState, Sheet, TextField } from '@/ui';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import type { City } from '@/types';

const RESULT_CAP = 10;

/**
 * Bottom-sheet city picker for the Leaderboard "My city" segment. Lists up
 * to 10 cities at a time (ranked by liveScore from /channels), filterable
 * via a search input. Selecting a city flips the leaderboard's view to that
 * city via the existing `?city_id=` query param.
 *
 * NOT a global city switcher - does NOT call setCurrentCity. Scope is just
 * the leaderboard view; the user's actual current city stays untouched.
 */
export function LeaderboardCityPickerSheet({
  visible,
  selectedChannelId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  /** Channel id (int) currently selected. Used to render a check on the row. */
  selectedChannelId: string | null;
  /** Fired with the picked city's channel id (e.g. "3"). The caller wraps it
   *  into "city_3" before passing to the leaderboard API. */
  onSelect: (channelId: string, city: City) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('challenge');
  const [cities,  setCities]  = useState<City[]>([]);
  const [loading, setLoading] = useState(false);
  const [query,   setQuery]   = useState('');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const list = await fetchChannels();   // ranked top cities; cheap read
        if (!cancelled) setCities(list);
      } catch {
        if (!cancelled) setCities([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cities.slice(0, RESULT_CAP);
    return cities
      .filter(c => c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q))
      .slice(0, RESULT_CAP);
  }, [cities, query]);

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t('cancel', { ns: 'common' })} style={styles.sheet}>
      <TextField
        variant="search"
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery('')}
        clearLabel={t('clear', { ns: 'common' })}
        placeholder={t('leaderboard.cityPicker.searchPlaceholder', { defaultValue: 'Search cities…' })}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />

      {loading ? (
        <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
      ) : filtered.length === 0 ? (
        <EmptyState body={t('leaderboard.cityPicker.empty', { defaultValue: 'No cities match.' })} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.channelId}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          renderItem={({ item }) => {
            const isSelected = item.channelId === selectedChannelId;
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => onSelect(item.channelId, item)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
              >
                {item.country ? <CityFlag country={item.country} size={22} /> : <Ionicons name="globe-outline" size={20} color={colors.muted} />}
                <Text style={[styles.cityName, isSelected && styles.cityNameSelected]} numberOfLines={1}>
                  {localizeCityName(item.name)}
                </Text>
                {isSelected && <Ionicons name="checkmark" size={20} color={colors.primaryText} />}
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </Sheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheet:            { maxHeight: '75%' },
  list:             { flexGrow: 0 },
  empty:            { padding: Spacing.lg, alignItems: 'center' },
  row:              { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  cityName:         { flex: 1, fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  cityNameSelected: { color: c.primaryText },
  sep:              { height: 1, backgroundColor: c.line, marginLeft: 34 },
});
