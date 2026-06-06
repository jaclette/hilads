import { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, FlatList, TouchableOpacity,
  StyleSheet, Pressable, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { fetchChannels } from '@/api/channels';
import { countryToFlag } from '@/lib/countryFlag';
import { localizeCityName } from '@/i18n/cityName';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { City } from '@/types';

const RESULT_CAP = 10;

/**
 * Bottom-sheet city picker for the Leaderboard "My city" segment. Lists up
 * to 10 cities at a time (ranked by liveScore from /channels), filterable
 * via a search input. Selecting a city flips the leaderboard's view to that
 * city via the existing `?city_id=` query param.
 *
 * NOT a global city switcher — does NOT call setCurrentCity. Scope is just
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.header}>
          <Ionicons name="search" size={18} color={Colors.muted2} />
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder={t('leaderboard.cityPicker.searchPlaceholder', { defaultValue: 'Search cities…' })}
            placeholderTextColor={Colors.muted2}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityLabel={t('cancel', { ns: 'common' })}>
            <Ionicons name="close" size={22} color={Colors.muted} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.empty}><ActivityIndicator color={Colors.accent} /></View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {t('leaderboard.cityPicker.empty', { defaultValue: 'No cities match.' })}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.channelId}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const isSelected = item.channelId === selectedChannelId;
              const flag = countryToFlag(item.country);
              return (
                <TouchableOpacity
                  style={[styles.row, isSelected && styles.rowSelected]}
                  onPress={() => onSelect(item.channelId, item)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.flag}>{flag || '🌍'}</Text>
                  <Text style={[styles.cityName, isSelected && styles.cityNameSelected]} numberOfLines={1}>
                    {localizeCityName(item.name)}
                  </Text>
                  {isSelected && <Ionicons name="checkmark" size={18} color="#FF7A3C" />}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '70%',
    backgroundColor: Colors.bg2,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    paddingBottom: Spacing.xl,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 8, marginBottom: 8,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  search: {
    flex: 1, fontSize: FontSizes.md, color: Colors.text,
    paddingVertical: Spacing.xs,
  },
  empty: { padding: Spacing.lg, alignItems: 'center' },
  emptyText: { color: Colors.muted, fontSize: FontSizes.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2,
  },
  rowSelected: { backgroundColor: 'rgba(255,122,60,0.10)' },
  flag: { fontSize: 22 },
  cityName: { flex: 1, fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  cityNameSelected: { color: '#FF7A3C' },
  sep: { height: 1, backgroundColor: Colors.border, marginLeft: Spacing.md + 22 + Spacing.md },
});
