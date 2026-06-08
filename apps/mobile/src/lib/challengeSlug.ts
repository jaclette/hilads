/**
 * Challenge slug - kept in sync with apps/web/api/sitemap.mjs (challengeSlug)
 * and apps/web/api/prerender.mjs. Algorithm matches eventSlug.ts; lives in its
 * own file so future divergence (e.g. challenge-specific URL shape) doesn't
 * leak into event code.
 *
 * The prerender layer accepts both `/challenge/{hex}` and `/challenge/{slug}-{hex}`
 * - we emit the slug form for shareability/SEO whenever a title is available.
 */

interface ChallengeLike {
  id:     string;
  title?: string;
}

export function challengeSlug(challenge: ChallengeLike | null | undefined): string {
  if (!challenge?.id) return '';
  const titleSlug = String(challenge.title || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return titleSlug ? `${titleSlug}-${challenge.id}` : challenge.id;
}
