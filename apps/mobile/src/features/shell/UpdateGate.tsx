import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Modal, Platform, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { fetchAppConfig, type AppConfig } from '@/api/appConfig';
import { APP_BUILD_VERSION, isOlderVersion } from '@/lib/appVersion';

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

  if (isOlderVersion(APP_BUILD_VERSION, config.minVersion)) {
    return (
      <Modal visible animationType="fade" onRequestClose={() => {}}>
        <View style={[styles.required, { paddingTop: insets.top + Spacing.xl, paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.requiredIcon}><Ionicons name="arrow-up-circle-outline" size={44} color={colors.primary} /></View>
          <Text style={styles.requiredTitle}>{t('update.requiredTitle')}</Text>
          <Text style={styles.requiredBody}>{t('update.requiredBody')}</Text>
          <TouchableOpacity style={styles.cta} onPress={openStore} accessibilityRole="button">
            <Text style={styles.ctaText}>{t('update.cta')}</Text>
          </TouchableOpacity>
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
    <View style={[styles.banner, { top: insets.top + 6 }]} accessibilityRole="alert">
      <Ionicons name="sparkles-outline" size={20} color={colors.primaryOnTint} />
      <Text style={styles.bannerText} numberOfLines={2}>{t('update.availableBody')}</Text>
      <TouchableOpacity onPress={openStore} style={styles.bannerCta} accessibilityRole="button">
        <Text style={styles.bannerCtaText}>{t('update.cta')}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={dismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('update.later')}>
        <Ionicons name="close" size={20} color={colors.primaryOnTint} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  banner:        { position: 'absolute', left: Spacing.md, right: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: 10,
                   backgroundColor: c.primaryTint, borderRadius: Radius.lg, paddingHorizontal: 14, paddingVertical: 10,
                   borderWidth: 1, borderColor: c.line, minHeight: 44 },
  bannerText:    { flex: 1, fontSize: FontSizes.sm, fontWeight: '600', color: c.primaryOnTint },
  bannerCta:     { backgroundColor: c.primary, borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center' },
  bannerCtaText: { color: c.white, fontSize: FontSizes.xs, fontWeight: '700' },
  required:      { flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, gap: 14 },
  requiredIcon:  { width: 84, height: 84, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  requiredTitle: { fontSize: FontSizes.xl, fontWeight: '800', color: c.text, textAlign: 'center' },
  requiredBody:  { fontSize: FontSizes.md, color: c.muted, textAlign: 'center' },
  cta:           { alignSelf: 'stretch', marginTop: Spacing.md, backgroundColor: c.primary, borderRadius: 16, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  ctaText:       { color: c.white, fontSize: FontSizes.md, fontWeight: '700' },
});
