// Theme icons live with ThemeIcon (src/ui): Taste and Only here are drawn.
export { THEME_ICON } from '@/ui/ThemeIcon';

/** 350 → "350 m", 1234 → "1.2 km", 25400 → "25 km". */
export function distance(m: number, locale?: string): string {
  if (m < 1000) return `${Math.round(m / 10) * 10 || m} m`;
  const km = m / 1000;
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km);
  return `${n} km`;
}

/** A compact price: 35000 VND → "35k", 4.5 EUR → "4.5 €"-style via Intl, 1200000 → "1.2M". */
export function compactPrice(amount: number, currency: string, locale?: string): string {
  if (amount >= 1000) {
    const n = amount >= 1_000_000 ? amount / 1_000_000 : amount / 1000;
    const f = new Intl.NumberFormat(locale, { maximumFractionDigits: n < 10 && !Number.isInteger(n) ? 1 : 0 }).format(n);
    return `${f}${amount >= 1_000_000 ? 'M' : 'k'}`;
  }
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export const PIN_LABEL_MAX = 18;

/**
 * A map pin's label: the spot name cut at about 18 characters, then the
 * median price paid when there is one ("Cơm Tấm Ba Ghiền · 35k").
 */
export function pinLabel(name: string, price: { min: number; max: number; median?: number; currency: string } | null, locale?: string): string {
  const chars = [...name.trim()];
  const short = chars.length > PIN_LABEL_MAX ? `${chars.slice(0, PIN_LABEL_MAX - 1).join('').trimEnd()}…` : chars.join('');
  const median = price ? (price.median ?? (price.min === price.max ? price.min : null)) : null;
  return median !== null && price ? `${short} · ${compactPrice(median, price.currency, locale)}` : short;
}

/** Great-circle distance in meters between two [lng, lat] points. */
export function meters(a: [number, number], b: [number, number]): number {
  const r = 6371000, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.min(1, Math.sqrt(h))));
}
