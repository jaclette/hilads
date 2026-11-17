import { Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Space, FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { answerPromo } from '@/api/auth';
import { Button, Sheet, SheetTitle } from '@/ui';

// Daily promo (SPEC 10.13): asked once to players with photos from before the
// terms' promo clause. Allow lets Hilads feature those too; Not now (or
// closing) never asks again, and photos from the clause on stay covered.
// Settings › Feature my photos changes it later.
export function PromoAskSheet({ blocked }: { blocked: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('common');
  const { account, setAccount } = useApp();
  const visible = !!account?.promoAsk && !blocked;

  const answer = (a: 'yes' | 'later') => {
    if (!account) return;
    setAccount({ ...account, promoAsk: false, promoConsent: a === 'yes' ? 'yes' : account.promoConsent ?? null });
    answerPromo(a).catch(() => {});
  };

  return (
    <Sheet visible={visible} onClose={() => answer('later')} closeLabel={t('close')} style={styles.sheet}>
      <SheetTitle>{t('promo.askTitle')}</SheetTitle>
      <Text style={styles.body}>{t('promo.askBody')}</Text>
      <Button label={t('promo.allow')} onPress={() => answer('yes')} />
      <Button variant="secondary" label={t('promo.notNow')} onPress={() => answer('later')} />
    </Sheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheet: { gap: Space.md },
  body:  { fontSize: FontSizes.sm, color: c.muted, marginBottom: Space.xs },
});
