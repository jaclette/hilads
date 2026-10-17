import { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

const KEY = 'first_launch_line_seen';

/**
 * First launch (SPEC 9.9): "One local challenge a day." under the logo, no
 * tutorial. Shown to a guest for the whole first session, never again.
 */
export function FirstLaunchLine({ guest }: { guest: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('common');
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!guest) return;
    AsyncStorage.getItem(KEY)
      .then(v => { if (v !== '1') { setShow(true); AsyncStorage.setItem(KEY, '1').catch(() => {}); } })
      .catch(() => {});
  }, [guest]);

  if (!show || !guest) return null;
  return <Text style={styles.line} accessibilityRole="header">{t('firstLaunch')}</Text>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  line: { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, letterSpacing: -0.3, marginTop: 2 },
});
