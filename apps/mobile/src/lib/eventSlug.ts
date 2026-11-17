/**
 * Slug helpers - keep in sync with apps/web/src/eventUtils.js.
 *
 * Native consumers receive `id` from Expo Router's [id].tsx dynamic route.
 * When deep-linked from a slug URL (e.g. /event/cong-ca-phe-2e617620a3f3b6f7)
 * the param is the entire slug. We always extract the trailing 16-hex before
 * calling the backend, which only knows hex IDs.
 */

interface EventLike {
  id:    string;
  title?: string;
}

export function eventSlug(event: EventLike | null | undefined): string {
  if (!event?.id) return '';
  const titleSlug = String(event.title || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return titleSlug ? `${titleSlug}-${event.id}` : event.id;
}

