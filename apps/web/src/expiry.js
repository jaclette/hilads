import i18n from './i18n'

// Relative "expires in …" label for hangouts (24h lifespan). `expiresAt` is a
// unix timestamp in seconds. Computed on render — approximate is fine.
export function formatExpiresIn(expiresAt) {
  if (!expiresAt) return null
  const T = (k, opts) => i18n.t(k, { ns: 'common', ...opts })
  const secs = expiresAt - Math.floor(Date.now() / 1000)
  if (secs <= 0) return T('time.expired')
  const mins = Math.floor(secs / 60)
  if (mins < 1) return T('time.expiresSoon')
  if (mins < 60) return T('time.expiresInMin', { mins })
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 && hours < 6
    ? T('time.expiresInHourMin', { hours, mins: rem })
    : T('time.expiresInHour', { hours })
}
