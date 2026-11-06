import { useEffect, useState } from 'react';
import { AppState, Linking, Pressable, Text, View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { hasPushPermission } from '@/services/push';

const DISMISSED_KEY = 'hilads_push_off_banner_dismissed';

/** Whether push permission is granted, re-checked when the app comes back (after the OS settings). */
export function usePushEnabled(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => { hasPushPermission().then(setOn).catch(() => setOn(null)); };
    check();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') check(); });
    return () => sub.remove();
  }, []);
  return on;
}

/** "Push is off, you might miss your results 🏆 · Turn on" (V6), until turned on or dismissed. */
export function PushOffBanner() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('notifications');
  const enabled = usePushEnabled();
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => { AsyncStorage.getItem(DISMISSED_KEY).then(v => setDismissed(v === '1')).catch(() => setDismissed(false)); }, []);
  if (enabled !== false || dismissed !== false) return null;
  return (
    <View style={styles.banner} testID="push-off-banner">
      <Text style={styles.text}>{t('inbox.pushOff.text')}</Text>
      <View style={styles.actions}>
        <Pressable onPress={() => { setDismissed(true); AsyncStorage.setItem(DISMISSED_KEY, '1').catch(() => {}); }} hitSlop={8} accessibilityRole="button">
          <Text style={styles.later}>{t('inbox.pushOff.dismiss')}</Text>
        </Pressable>
        <Pressable onPress={() => Linking.openSettings().catch(() => {})} style={styles.on} accessibilityRole="button">
          <Text style={styles.onText}>{t('inbox.pushOff.on')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  banner:  { marginHorizontal: 16, marginBottom: 10, padding: 12, borderRadius: Radius.card, backgroundColor: c.primaryTint, gap: 8 },
  text:    { fontSize: 14, lineHeight: 19, fontWeight: '700', color: c.text },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 16 },
  later:   { fontSize: 14, fontWeight: '700', color: c.muted },
  on:      { paddingHorizontal: 16, height: 36, borderRadius: Radius.full, backgroundColor: c.cta, alignItems: 'center', justifyContent: 'center' },
  onText:  { fontSize: 14, fontWeight: '800', color: c.onCta },
});
