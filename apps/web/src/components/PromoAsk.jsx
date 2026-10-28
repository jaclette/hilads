import { useTranslation } from 'react-i18next'
import ConfirmDialog from './ConfirmDialog'
import { answerPromo } from '../api'

// Daily promo (SPEC 10.13): asked once to players with photos from before the
// terms' promo clause. Allow lets Hilads feature those too; Not now (or a tap
// outside) never asks again. The Me screen's "Feature my photos" changes it later.
export default function PromoAsk({ account, onAnswered }) {
  const { t } = useTranslation('common')
  if (!account?.promoAsk) return null

  // ConfirmDialog runs onPress then onClose: onClose answers only a tap outside.
  let answered = false
  const answer = (a) => {
    answered = true
    onAnswered({ ...account, promoAsk: false, promoConsent: a === 'yes' ? 'yes' : account.promoConsent ?? null })
    answerPromo(a).catch(() => {})
  }

  return (
    <ConfirmDialog
      dialog={{
        title: t('promo.askTitle'),
        body: t('promo.askBody'),
        primary: { label: t('promo.allow'), onPress: () => answer('yes') },
        secondary: { label: t('promo.notNow'), onPress: () => answer('later') },
      }}
      onClose={() => { if (!answered) answer('later') }}
    />
  )
}
