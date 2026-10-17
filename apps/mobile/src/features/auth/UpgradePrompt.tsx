import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Spacing } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Button, EmptyState } from '@/ui';

/** Guest-only invitation to create an account (Messages): the reason, then Sign up / I have an account. */
export function UpgradePrompt({ title, subtitle }: { title: string; subtitle: string }) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { t } = useTranslation('auth');

  return (
    <View style={styles.container}>
      <EmptyState
        icon="lock-open-outline"
        title={title}
        body={subtitle}
        action={
          <View style={styles.actions}>
            <Button label={t('sheet.signUp')} onPress={() => router.push('/sign-up')} />
            <Button variant="secondary" label={t('sheet.haveAccount')} onPress={() => router.push('/sign-in')} />
          </View>
        }
      />
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.lg },
  actions:   { alignSelf: 'stretch', gap: 10, marginTop: Spacing.sm },
});
