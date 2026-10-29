/**
 * The app-wide scope selector (SPEC 9.1): the pill (my city's flag and short
 * name, or World) and its sheet (my city, World, where I am, change city). The
 * same component in every tab's header and next to the Map's search bar; a
 * pick changes the scope everywhere. When I'm somewhere else than the city
 * shown, a small location mark on the pill says so; the sheet's "You're in
 * [city]" row fixes where I play (the hero's old "Not in Saigon? Change").
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
import { useHere } from '@/hooks/useDaily';
import { track } from '@/services/analytics';

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
  // Where I am (the server's "here"): elsewhere than the city shown, a hint on the pill.
  const here = useHere();
  const hereName = here?.name ? shortCityName(here.name) : null;
  const away = scope === 'city' && !!here && !!city && String(here.id) !== String(city.channelId);

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
        accessibilityLabel={[t('scope.a11y', { scope: scope === 'world' ? label : cityName }), away && hereName ? t('scope.here', { city: hereName }) : null].filter(Boolean).join('. ')}
      >
        {scope === 'world' ? <Ionicons name="globe-outline" size={17} color={colors.text} /> : <CityFlag country={city?.country} />}
        <Text style={styles.scopeText} numberOfLines={1}>{label}</Text>
        {away && <Ionicons name="navigate" size={13} color={colors.primaryText} testID="scope-away" />}
        <Ionicons name="chevron-down" size={18} color={colors.text} />
      </TouchableOpacity>
      <ScopeSheet
        visible={sheet}
        scope={scope}
        cityName={city?.name ? shortCityName(city.name) : null}
        cityCountry={city?.country ?? null}
        onPick={pick}
        onChangeCity={() => { setSheet(false); router.push('/switch-city' as never); }}
        hereName={hereName}
        hereCountry={here?.country ?? null}
        onHere={() => {
          setSheet(false);
          track('here_change', { from: here?.name ?? null, source: here?.source ?? null, surface: 'scope_sheet' });
          router.push('/switch-city?mode=here' as never);
        }}
        onClose={() => setSheet(false)}
      />
    </>
  );
}

/** Bottom sheet of the scope selector: my city, World, change city. */
function ScopeSheet({ visible, scope, cityName, cityCountry, hereName, hereCountry, onPick, onChangeCity, onHere, onClose }: {
  visible: boolean; scope: Scope; cityName: string | null; cityCountry: string | null;
  hereName: string | null; hereCountry: string | null;
  onPick: (s: Scope) => void; onChangeCity: () => void; onHere: () => void; onClose: () => void;
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
      {/* The pill's name ("Saigon"), so the sheet reads like the header. */}
      <Row icon="location-outline" title={cityName ?? t('scope.pickCity')} flag={cityName ? cityCountry : null} sub={t('scope.citySub')}
           active={scope === 'city' && !!cityName} onPress={() => onPick('city')} />
      <Row icon="globe-outline" title={t('scope.world')} sub={t('scope.worldSub')}
           active={scope === 'world'} onPress={() => onPick('world')} />
      {/* Where I play today (an IP guess, a VPN, GPS at a border): always correctable. */}
      <Row icon="navigate-outline" title={hereName ? t('scope.here', { city: hereName }) : t('scope.hereUnknown')} flag={hereName ? hereCountry : null}
           sub={t('scope.hereSub')} onPress={onHere} />
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
