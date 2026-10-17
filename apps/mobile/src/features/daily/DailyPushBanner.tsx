import { useCallback, useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { askDailyPush, hasPushPermission } from '@/services/push';
import { Button } from '@/ui';

const DISMISSED_KEY = 'hilads_daily_push_banner_dismissed_at';
const DISMISS_FOR_MS = 7 * 24 * 3600 * 1000;

/**
 * "Get the Daily Challenge every morning" - shown on the Daily card while push
 * is off (AUDIT Q9: ask in context, never at launch). Dismissible for 7 days.
 */
export function DailyPushBanner() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const { identity } = useApp();
  const [visible, setVisible] = useState(false);

  const check = useCallback(async () => {
    if (await hasPushPermission()) { setVisible(false); return; }
    const dismissedAt = Number(await AsyncStorage.getItem(DISMISSED_KEY).catch(() => null)) || 0;
    setVisible(Date.now() - dismissedAt > DISMISS_FOR_MS);
  }, []);

  useEffect(() => { check(); }, [check]);
  useFocusEffect(useCallback(() => { check(); }, [check]));

  if (!visible) return null;

  const onTurnOn = async () => {
    await askDailyPush('banner', identity?.guestId);
    check();
  };
  const onDismiss = () => {
    setVisible(false);
    AsyncStorage.setItem(DISMISSED_KEY, String(Date.now())).catch(() => {});
  };

  return (
    <View style={styles.banner}>
      <Ionicons name="notifications-outline" size={18} color={colors.primaryText} />
      <Text style={styles.text} numberOfLines={2}>{t('push.bannerTitle')}</Text>
      <Button variant="secondary" size="sm" label={t('push.bannerCta')} onPress={onTurnOn} />
      <TouchableOpacity style={styles.close} onPress={onDismiss} accessibilityRole="button" accessibilityLabel={t('push.notNow')}>
        <Ionicons name="close" size={18} color={colors.muted} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  banner:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.line },
  text:    { flex: 1, fontSize: FontSizes.xs, color: c.text, fontWeight: '600' },
  close:   { width: 44, height: 44, marginRight: -12, alignItems: 'center', justifyContent: 'center' },
});
