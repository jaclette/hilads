import i18n from './index';

// Canonical city slug rule - mirrors the backend slug + web cityToSlug(). City
// display names live in the `cityNames` namespace keyed by this slug; cities
// without a localized form fall back to their canonical (English/default) name.
function citySlug(name: string): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Localize a city's DISPLAY name for the active locale. The slug/identity never
// changes - purely presentational.
export function localizeCityName(name: string | null | undefined): string {
  if (!name) return name ?? '';
  return i18n.t(citySlug(name), { ns: 'cityNames', defaultValue: name });
}
