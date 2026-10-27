import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Modal, Platform, Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { fetchAppConfig, type AppConfig } from '@/api/appConfig';
import { APP_BUILD_VERSION, isOlderVersion } from '@/lib/appVersion';
import { Banner, Button } from '@/ui';

const DISMISSED_KEY = 'hilads_update_dismissed';   // the latestVersion the banner was closed for

/**
 * Update prompts from GET /app/config (V3-04), read at launch and on return to
 * the foreground: below latestVersion a dismissible "Update available" banner
 * (not shown again for that version once closed), below minVersion a blocking
 * "Update required" screen. Silent when the call fails.
 */
export function UpdateGate() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const insets = useSafeAreaInsets();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchAppConfig().then(setConfig).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    AsyncStorage.getItem(DISMISSED_KEY).then(setDismissed).catch(() => {});
    const sub = AppState.addEventListener('change', s => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  if (!config) return null;
  const storeUrl = Platform.OS === 'ios' ? config.storeUrls.ios : config.storeUrls.android;
  const openStore = () => { Linking.openURL(storeUrl).catch(() => {}); };

  // Dev builds never block: a local build older than the prod minimum still runs.
  if (!__DEV__ && isOlderVersion(APP_BUILD_VERSION, config.minVersion)) {
    return (
      <Modal visible animationType="fade" onRequestClose={() => {}}>
        <View style={[styles.required, { paddingTop: insets.top + Spacing.xl, paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.requiredIcon}><Ionicons name="arrow-up-circle-outline" size={44} color={colors.primary} /></View>
          <Text style={styles.requiredTitle}>{t('update.requiredTitle')}</Text>
          <Text style={styles.requiredBody}>{t('update.requiredBody')}</Text>
          <Button label={t('update.cta')} onPress={openStore} style={styles.cta} />
        </View>
      </Modal>
    );
  }

  if (!config.latestVersion || dismissed === config.latestVersion
      || !isOlderVersion(APP_BUILD_VERSION, config.latestVersion)) {
    return null;
  }
  const dismiss = () => {
    setDismissed(config.latestVersion);
    AsyncStorage.setItem(DISMISSED_KEY, config.latestVersion ?? '').catch(() => {});
  };
  return (
    <Banner icon="sparkles-outline" text={t('update.availableBody')} action={{ label: t('update.cta'), onPress: openStore }}
            onClose={dismiss} closeLabel={t('update.later')} style={[styles.banner, { top: insets.top + 6 }]} />
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  banner:        { position: 'absolute', left: Spacing.md, right: Spacing.md },
  required:      { flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, gap: 14 },
  requiredIcon:  { width: 84, height: 84, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  requiredTitle: { fontSize: FontSizes.xl, fontWeight: '800', color: c.text, textAlign: 'center' },
  requiredBody:  { fontSize: FontSizes.md, color: c.muted, textAlign: 'center' },
  cta:           { alignSelf: 'stretch', marginTop: Spacing.md },
});
