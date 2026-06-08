// Relative "expires in …" label for hangouts (24h lifespan). `expiresAt` is a
// unix timestamp in seconds. Computed on render - approximate is fine.

import i18n from '@/i18n';

export function formatExpiresIn(expiresAt?: number | null): string | null {
  if (!expiresAt) return null;
  const secs = expiresAt - Math.floor(Date.now() / 1000);
  if (secs <= 0)   return i18n.t('time.expired', { ns: 'common' });
  const mins = Math.floor(secs / 60);
  if (mins < 1)    return i18n.t('time.expiresSoon', { ns: 'common' });
  if (mins < 60)   return i18n.t('time.expiresInMin', { ns: 'common', count: mins });
  const hours = Math.floor(mins / 60);
  const rem   = mins % 60;
  return rem > 0 && hours < 6
    ? i18n.t('time.expiresInHourMin', { ns: 'common', hours, mins: rem })
    : i18n.t('time.expiresInHour', { ns: 'common', count: hours });
}
