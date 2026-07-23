/**
 * AccountWelcome - one-time congrats screen shown right after a user creates an
 * account (not on login). Friendly, emoji-forward, easy to dismiss (✕ or CTA).
 * Driven by the global `showAccountWelcome` flag (set in sign-up.tsx).
 */

import {
  Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

interface Props {
  visible:  boolean;
  username: string;
  onClose:  () => void;
}

export function AccountWelcome({ visible, username, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);

  const insets = useSafeAreaInsets();
  const { t } = useTranslation('common');

  const features = [
    t('accountWelcome.fc1'),   // local challenge — the primary action
    t('accountWelcome.fc2'),   // international challenge
    t('accountWelcome.f1'),
    t('accountWelcome.f2'),
    t('accountWelcome.f3'),
    t('accountWelcome.f4'),
    t('accountWelcome.f5'),
  ];

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={[styles.close, { top: insets.top + 8 }]}
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel={t('close')}
        >
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.party}>🎉</Text>
          <Text style={styles.title}>{t('accountWelcome.title', { username })}</Text>
          <Text style={styles.subtitle}>{t('accountWelcome.subtitle')}</Text>

          <View style={styles.features}>
            {features.map((f, i) => (
              <Text key={i} style={styles.feature}>{f}</Text>
            ))}
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <TouchableOpacity style={styles.cta} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.ctaText}>{t('accountWelcome.cta')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  close: {
    position: 'absolute', right: Spacing.lg, zIndex: 2,
    width: 36, height: 36, borderRadius: Radius.full,
    backgroundColor: c.bg2, borderWidth: 1, borderColor: c.border,
    alignItems: 'center', justifyContent: 'center',
  },
  closeText: { color: c.text, fontSize: 16, fontWeight: '600' },
  content: {
    flexGrow: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xl, gap: Spacing.md,
  },
  party: { fontSize: 64, marginBottom: Spacing.sm },
  title: { fontSize: 26, fontWeight: '800', color: c.text, textAlign: 'center', letterSpacing: -0.5 },
  subtitle: { fontSize: FontSizes.md, color: c.muted, textAlign: 'center', marginBottom: Spacing.sm },
  features: { alignSelf: 'stretch', gap: Spacing.md, marginTop: Spacing.sm },
  feature: {
    fontSize: FontSizes.md, color: c.text, lineHeight: 24,
    backgroundColor: c.overlayWeak,
    borderWidth: 1, borderColor: c.border, borderRadius: Radius.lg,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  footer: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
  cta: {
    backgroundColor: c.accent, borderRadius: 16, padding: 16, alignItems: 'center',
    shadowColor: c.accent, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  ctaText: { fontSize: FontSizes.md, fontWeight: '700', color: '#fff' },
});
