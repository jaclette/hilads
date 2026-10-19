/**
 * The app-wide scope selector (SPEC 9.1): the pill (my city's flag and short
 * name, or World) and its sheet (my city, World, change city). The same
 * component in every tab's header and next to the Map's search bar; a pick
 * changes the scope everywhere.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useScope, type Scope } from '@/context/ScopeContext';
import { localizeCityName, shortCityName } from '@/i18n/cityName';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { CityFlag, Sheet } from '@/ui';

export function ScopeSelector({ style, onPicked }: {
  style?: StyleProp<ViewStyle>;
  /** After a pick (the Map moves its camera). */
  onPicked?: (s: Scope) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('common');
  const { city } = useApp();
  const { scope, setScope } = useScope();
  const [sheet, setSheet] = useState(false);

  const cityName = city?.name ? localizeCityName(city.name) : t('scope.pickCity');
  // The pill is tight: the city's short name ("Saigon") after its flag.
  const label = scope === 'world' ? t('scope.world') : city?.name ? shortCityName(city.name) : cityName;

  const pick = (s: Scope) => {
    setSheet(false);
    if (s === 'city' && !city) { router.push('/switch-city' as never); return; }
    setScope(s);
    onPicked?.(s);
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.scope, style]}
        onPress={() => setSheet(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={t('scope.a11y', { scope: scope === 'world' ? label : cityName })}
      >
        {scope === 'world' ? <Ionicons name="globe-outline" size={17} color={colors.text} /> : <CityFlag country={city?.country} />}
        <Text style={styles.scopeText} numberOfLines={1}>{label}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.text} />
      </TouchableOpacity>
      <ScopeSheet
        visible={sheet}
        scope={scope}
        cityName={city?.name ? cityName : null}
        cityCountry={city?.country ?? null}
        onPick={pick}
        onChangeCity={() => { setSheet(false); router.push('/switch-city' as never); }}
        onClose={() => setSheet(false)}
      />
    </>
  );
}

/** Bottom sheet of the scope selector: my city, World, change city. */
function ScopeSheet({ visible, scope, cityName, cityCountry, onPick, onChangeCity, onClose }: {
  visible: boolean; scope: Scope; cityName: string | null; cityCountry: string | null;
  onPick: (s: Scope) => void; onChangeCity: () => void; onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');

  const Row = ({ icon, title, flag, sub, active, onPress }: {
    icon: React.ComponentProps<typeof Ionicons>['name']; title: string; flag?: string | null; sub?: string; active?: boolean; onPress: () => void;
  }) => (
    <TouchableOpacity style={[styles.row, active && styles.rowActive]} onPress={onPress} accessibilityRole="button"
                      accessibilityState={{ selected: !!active }}>
      <Ionicons name={icon} size={22} color={active ? colors.primaryOnTint : colors.text} />
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          {!!flag && <CityFlag country={flag} />}
          <Text style={[styles.rowTitle, active && styles.rowTitleActive]} numberOfLines={1}>{title}</Text>
        </View>
        {!!sub && <Text style={styles.rowSub} numberOfLines={2}>{sub}</Text>}
      </View>
      {active && <Ionicons name="checkmark" size={20} color={colors.primaryOnTint} />}
    </TouchableOpacity>
  );

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t('close')} style={styles.sheet}>
      <Text style={styles.sheetTitle}>{t('scope.title')}</Text>
      <Row icon="location-outline" title={cityName ?? t('scope.pickCity')} flag={cityName ? cityCountry : null} sub={t('scope.citySub')}
           active={scope === 'city' && !!cityName} onPress={() => onPick('city')} />
      <Row icon="globe-outline" title={t('scope.world')} sub={t('scope.worldSub')}
           active={scope === 'world'} onPress={() => onPick('world')} />
      <Row icon="swap-horizontal-outline" title={t('scope.changeCity')} onPress={onChangeCity} />
    </Sheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  scope:          { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14,
                    borderRadius: Radius.full, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2 },
  scopeText:      { flexShrink: 1, flexGrow: 1, fontSize: 15, fontWeight: '700', color: c.text },
  sheet:          { gap: 6 },
  sheetTitle:     { fontSize: FontSizes.md, fontWeight: '800', color: c.text, marginBottom: 4 },
  row:            { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16 },
  rowActive:      { backgroundColor: c.primaryTint },
  rowBody:        { flex: 1 },
  rowTitleLine:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle:       { flexShrink: 1, fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  rowTitleActive: { color: c.primaryOnTint },
  rowSub:         { fontSize: FontSizes.xs, color: c.muted, marginTop: 2 },
});
