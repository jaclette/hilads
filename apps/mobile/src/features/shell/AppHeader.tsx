/**
 * Shared app header (V3, SPEC 9.1 / mockups): the "Hi" mark, the app-wide
 * scope selector (current city or World, shared by every tab), then the
 * tab-specific extras, the private messages button where asked (Chat) and
 * the notification bell (members) - or a Sign up button for guests (V3-11).
 *
 * Pulls unread counts + setters from AppContext to avoid prop drilling.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useScope, type Scope } from '@/context/ScopeContext';
import { localizeCityName, shortCityName } from '@/i18n/cityName';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { BrandMark, CityFlag, IconButton, Sheet } from '@/ui';

interface Props {
  /** Optional nodes injected before the messages / bell buttons. */
  rightExtra?: React.ReactNode;
  /** Show the private messages button (Chat, SPEC 9.6). */
  messages?: boolean;
}

export function AppHeader({ rightExtra, messages = false }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('common');
  const { account, city, unreadDMs, setUnreadDMs, unreadNotifications, clearEventChatCounts } = useApp();
  const { scope, setScope } = useScope();
  const [sheet, setSheet] = useState(false);

  const cityName = city?.name ? localizeCityName(city.name) : t('scope.pickCity');
  // The pill is tight: the city's short name ("Saigon") after its flag.
  const label = scope === 'world' ? t('scope.world') : city?.name ? shortCityName(city.name) : cityName;

  const pick = (s: Scope) => {
    setSheet(false);
    if (s === 'city' && !city) { router.push('/switch-city' as never); return; }
    setScope(s);
  };

  return (
    <View style={styles.bar}>
      <BrandMark />

      <TouchableOpacity
        style={styles.scope}
        onPress={() => setSheet(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={t('scope.a11y', { scope: scope === 'world' ? label : cityName })}
      >
        {scope === 'world' ? <Ionicons name="globe-outline" size={17} color={colors.text} /> : <CityFlag country={city?.country} />}
        <Text style={styles.scopeText} numberOfLines={1}>{label}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.text} />
      </TouchableOpacity>

      {rightExtra}

      {messages && account && (
        <IconButton icon="paper-plane-outline" iconSize={20} label={t('messages')} badge={unreadDMs > 0}
                    onPress={() => { setUnreadDMs(0); clearEventChatCounts(); router.push('/messages'); }} />
      )}

      {account ? (
        <IconButton icon="notifications-outline" iconSize={21} badge={unreadNotifications > 0}
                    label={unreadNotifications > 0 ? t('notificationsUnread', { count: unreadNotifications }) : t('notifications')}
                    onPress={() => router.push('/notifications' as never)} />
      ) : (
        <TouchableOpacity
          style={styles.signUp}
          onPress={() => router.push('/sign-up?action=header' as never)}
          accessibilityRole="button"
        >
          <Text style={styles.signUpText} numberOfLines={1}>{t('signUp')}</Text>
        </TouchableOpacity>
      )}

      <ScopeSheet
        visible={sheet}
        scope={scope}
        cityName={city?.name ? cityName : null}
        cityCountry={city?.country ?? null}
        onPick={pick}
        onChangeCity={() => { setSheet(false); router.push('/switch-city' as never); }}
        onClose={() => setSheet(false)}
      />
    </View>
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
  // No horizontal padding: each tab's header container sets it.
  bar:            { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, paddingBottom: 6 },
  scope:          { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14,
                    borderRadius: Radius.full, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2 },
  scopeText:      { flex: 1, fontSize: 15, fontWeight: '700', color: c.text },
  signUp:         { height: 44, paddingHorizontal: 16, borderRadius: Radius.full, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  signUpText:     { color: c.white, fontSize: 14, fontWeight: '700' },
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
