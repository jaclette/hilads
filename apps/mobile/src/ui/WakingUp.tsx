import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

const FIRST_MS = 3000;
const MAX_MS = 30_000;

/**
 * The API can't be reached (a deploy, no network): "Hilads is waking up… 🌍" instead of a raw
 * error, retrying on its own (3 s, 6 s, 12 s… at most 30 s apart) while it's shown, and a
 * "Try again" for the impatient. Show it only when there's nothing cached to show instead.
 */
export function WakingUp({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('common');
  const retry = useRef(onRetry);
  retry.current = onRetry;
  useEffect(() => {
    let delay = FIRST_MS;
    let id: ReturnType<typeof setTimeout>;
    const tick = () => { retry.current(); delay = Math.min(delay * 2, MAX_MS); id = setTimeout(tick, delay); };
    id = setTimeout(tick, delay);
    return () => clearTimeout(id);
  }, []);
  return (
    <EmptyState icon="earth-outline" title={t('wakingUp.title')} body={t('wakingUp.body')}
                action={<Button variant="secondary" label={t('retry')} onPress={() => retry.current()} />} />
  );
}
