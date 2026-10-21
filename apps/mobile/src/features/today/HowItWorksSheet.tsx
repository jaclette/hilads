import type { ComponentProps } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, Sheet } from '@/ui';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * How it works (SPEC 9.3), shown the first time someone taps "I'm in": do it
 * where you are, snap a photo, it goes on the map and gets votes (Language:
 * in today's proofs). "Open the camera" or "Remind me later".
 */
export function HowItWorksSheet({ visible, placeTheme, onCamera, onLater, onClose }: {
  visible: boolean; placeTheme: boolean; onCamera: () => void; onLater: () => void; onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const steps: [IconName, string][] = [
    ['location-outline', t('howItWorks.step1')],
    ['camera-outline', t('howItWorks.step2')],
    [placeTheme ? 'map-outline' : 'heart-outline', placeTheme ? t('howItWorks.step3') : t('howItWorks.step3NoPlace')],
  ];
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t('howItWorks.later')}>
      <Text style={styles.title} accessibilityRole="header">{t('howItWorks.title')}</Text>
      <View style={styles.steps}>
        {steps.map(([icon, label], i) => (
          <View key={icon} style={styles.step}>
            <View style={styles.icon}><Ionicons name={icon} size={22} color={colors.primaryOnTint} /></View>
            <Text style={styles.stepText}><Text style={styles.stepNum}>{i + 1}. </Text>{label}</Text>
          </View>
        ))}
      </View>
      <Button label={t('howItWorks.camera')} icon="camera-outline" onPress={onCamera} style={styles.cta} testID="how-camera" />
      <Button variant="link" label={t('howItWorks.later')} onPress={onLater} />
    </Sheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  title:    { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, marginBottom: 14 },
  steps:    { gap: 14, marginBottom: 20 },
  step:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon:     { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1, fontSize: FontSizes.md, lineHeight: 22, fontWeight: '600', color: c.text },
  stepNum:  { fontWeight: '800' },
  cta:      { minHeight: 56, marginBottom: 4 },
});
