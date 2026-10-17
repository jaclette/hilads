/**
 * AccountWelcome - one-time congrats screen shown right after a user creates an
 * account (not on login). Friendly, easy to dismiss (close button or CTA).
 * Driven by the global `showAccountWelcome` flag (set in sign-up.tsx).
 */

import { Modal, View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, Card, IconButton } from '@/ui';

interface Props {
  visible:  boolean;
  username: string;
  onClose:  () => void;
}

export function AccountWelcome({ visible, username, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('common');

  const features: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }[] = [
    { icon: 'flame-outline',       text: t('accountWelcome.fc1') },   // local challenge — the primary action
    { icon: 'globe-outline',       text: t('accountWelcome.fc2') },   // international challenge
    { icon: 'chatbubbles-outline', text: t('accountWelcome.f1') },
    { icon: 'calendar-outline',    text: t('accountWelcome.f2') },
    { icon: 'chatbubble-outline',  text: t('accountWelcome.f3') },
    { icon: 'location-outline',    text: t('accountWelcome.f4') },
    { icon: 'people-outline',      text: t('accountWelcome.f5') },
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
        <IconButton icon="close" label={t('close')} onPress={onClose} style={[styles.close, { top: insets.top + 8 }]} />

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.party}><Ionicons name="sparkles-outline" size={36} color={colors.primaryOnTint} /></View>
          <Text style={styles.title}>{t('accountWelcome.title', { username })}</Text>
          <Text style={styles.subtitle}>{t('accountWelcome.subtitle')}</Text>

          <View style={styles.features}>
            {features.map((f, i) => (
              <Card key={i} style={styles.feature}>
                <Ionicons name={f.icon} size={20} color={colors.primaryText} />
                <Text style={styles.featureText}>{f.text}</Text>
              </Card>
            ))}
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <Button label={t('accountWelcome.cta')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  close: { position: 'absolute', right: Spacing.lg, zIndex: 2 },
  content: {
    flexGrow: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xl, gap: Spacing.md,
  },
  party: { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  title: { fontSize: 26, fontWeight: '800', color: c.text, textAlign: 'center', letterSpacing: -0.5 },
  subtitle: { fontSize: FontSizes.md, color: c.muted, textAlign: 'center', marginBottom: Spacing.sm },
  features: { alignSelf: 'stretch', gap: Spacing.md, marginTop: Spacing.sm },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  featureText: { flex: 1, fontSize: FontSizes.md, fontWeight: '500', color: c.text, lineHeight: 24 },
  footer: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
});
