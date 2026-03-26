import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, ActivityIndicator, TextInput, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { fetchChannels } from '@/api/channels';
import { track } from '@/services/analytics';
import type { City } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

function CityRow({ city, isActive, onPress }: { city: City; isActive: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.row, isActive && styles.rowActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.rowLeft}>
        <Text style={[styles.cityName, isActive && styles.cityNameActive]}>
          {city.name}
        </Text>
        <Text style={styles.countryName}>{city.country}</Text>
      </View>

      <View style={styles.rowRight}>
        {city.onlineCount != null && (
          <View style={styles.stat}>
            <Text style={styles.statValue}>{city.onlineCount}</Text>
            <Text style={styles.statLabel}>here</Text>
          </View>
        )}
        {city.eventCount != null && (
          <View style={styles.stat}>
            <Text style={styles.statValue}>{city.eventCount}</Text>
            <Text style={styles.statLabel}>events</Text>
          </View>
        )}
        {isActive && (
          <View style={styles.activeDot} />
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function CitiesScreen() {
  const { city: activeCity, setCity } = useApp();
  const [cities,     setCities]     = useState<City[]>([]);
  const [filtered,   setFiltered]   = useState<City[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query,      setQuery]      = useState('');

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await fetchChannels();
      setCities(data);
      setFiltered(data);
    } catch {
      // silent — show stale data
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!query.trim()) {
      setFiltered(cities);
    } else {
      const q = query.toLowerCase();
      setFiltered(cities.filter(c =>
        c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q),
      ));
    }
  }, [query, cities]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🌍 Cities</Text>
      </View>

      <View style={styles.searchWrapper}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search cities…"
          placeholderTextColor={Colors.muted2}
          value={query}
          onChangeText={setQuery}
          clearButtonMode="while-editing"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.channelId}
          renderItem={({ item }) => (
            <CityRow
              city={item}
              isActive={item.channelId === activeCity?.channelId}
              onPress={() => {
                setCity(item);
                track('city_selected', { cityId: item.channelId, cityName: item.name });
              }}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={Colors.accent}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No cities found</Text>
            </View>
          }
          contentContainerStyle={filtered.length === 0 ? styles.flex1 : undefined}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: Colors.bg },
  flex1:         { flex: 1 },
  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle:   { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text },
  searchWrapper: { padding: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  searchInput: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.md,
    borderWidth:     1,
    borderColor:     Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    color:           Colors.text,
    fontSize:        FontSizes.sm,
  },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  emptyText:   { color: Colors.muted, fontSize: FontSizes.sm },
  row: {
    flexDirection:    'row',
    alignItems:       'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:  Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowActive:     { backgroundColor: 'rgba(255,122,60,0.06)' },
  rowLeft:       { flex: 1 },
  cityName:      { fontSize: FontSizes.md, fontWeight: '500', color: Colors.text },
  cityNameActive:{ color: Colors.accent },
  countryName:   { fontSize: FontSizes.xs, color: Colors.muted, marginTop: 2 },
  rowRight:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  stat:          { alignItems: 'center' },
  statValue:     { fontSize: FontSizes.sm, fontWeight: '600', color: Colors.text },
  statLabel:     { fontSize: FontSizes.xs, color: Colors.muted },
  activeDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.accent },
});
