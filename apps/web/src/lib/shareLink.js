import i18n, { SUPPORTED, DEFAULT_LOCALE } from '../i18n'
import { track } from './analytics'

/**
 * Share a Hilads link from the web (SPEC 9.14): the system share sheet where
 * there is one (phones), else the link copied. `path` like '/today' or
 * '/s/{id}', in the active language (/fr/today...), with utm_source =
 * share_sheet | copy_link. share_started / share_completed like the app.
 * Resolves 'shared' | 'copied' | null.
 */
export async function shareLink({ type, path, text, source }) {
  const lang = i18n.language
  const lp = lang && lang !== DEFAULT_LOCALE && SUPPORTED.includes(lang) ? `/${lang}` : ''
  const url = channel => `${window.location.origin}${lp}${path}?utm_source=${channel}&utm_medium=share`
  const props = { content_type: type, source }
  track('share_started', props)
  if (navigator.share) {
    try {
      await navigator.share({ text, url: url('share_sheet') })
      track('share_completed', { ...props, channel: 'share_sheet' })
      return 'shared'
    } catch {
      return null
    }
  }
  try {
    await navigator.clipboard.writeText(url('copy_link'))
    track('share_completed', { ...props, channel: 'copy_link' })
    return 'copied'
  } catch {
    return null
  }
}
