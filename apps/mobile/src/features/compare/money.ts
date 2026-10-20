import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchDailyRates } from '@/api/daily';
import { useApp } from '@/context/AppContext';
import { defaultCurrency } from '@/features/daily/currency';
import type { DailyPrice, DailyRates } from '@/types';

// The day's rates (EUR base), fetched once per session and shared.
let cached: DailyRates | null = null;
let pending: Promise<DailyRates | null> | null = null;

function loadRates(): Promise<DailyRates | null> {
  if (cached) return Promise.resolve(cached);
  pending ??= fetchDailyRates()
    .then(r => (cached = r && Object.keys(r.rates ?? {}).length > 0 ? r : null))
    .catch(() => null)
    .finally(() => { pending = null; });
  return pending;
}

/** A converted amount, rounded to 3 significant digits from 100 up ("≈ ₫45,000", not ₫45,010). */
export function approx(v: number): number {
  if (v < 100) return Math.round(v * 100) / 100;
  const step = 10 ** (Math.floor(Math.log10(v)) - 2);
  return Math.round(v / step) * step;
}

/** An amount in a currency, in the viewer's locale: "€1.55", "45.000 ₫". */
/** A bare "$" for another dollar than the US one reads as USD: "NT$ 38", "MX$ 90", except where it is the local money (MXN in es-MX). */
function disambiguate(out: string, currency: string, locale?: string): string {
  if (currency === 'USD' || !/(^|[^A-Za-z])\$/.test(out) || (currency === 'MXN' && /-MX$/i.test(locale ?? ''))) return out;
  const prefix = currency === 'TWD' ? 'NT$' : new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'symbol' })
    .formatToParts(0).find(p => p.type === 'currency')?.value ?? currency;
  return out.replace(/(^|[^A-Za-z])\$/, `$1${prefix}`);
}

export function formatMoney(amount: number, currency: string, locale?: string): string {
  try {
    return disambiguate(new Intl.NumberFormat(locale, {
      style: 'currency', currency, currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: amount >= 100 || Number.isInteger(amount) ? 0 : 2,
    }).format(amount), currency, locale);
  } catch {
    return `${amount} ${currency}`;
  }
}

/**
 * Prices in the viewer's currency (SPEC 10.5): their current city's, else the
 * device's. Returns helpers that convert an EUR amount and show a price as
 * "≈ €1.55" with its original ("45,000 VND"); without rates, the original only.
 */
export function useMoney() {
  const { city } = useApp();
  const { i18n } = useTranslation();
  const [rates, setRates] = useState<DailyRates | null>(cached);
  useEffect(() => {
    let alive = true;
    if (!cached) loadRates().then(r => { if (alive) setRates(r); });
    return () => { alive = false; };
  }, []);
  const currency = defaultCurrency(city?.country);
  const fromEur = (eur: number | null | undefined): string | null => {
    const r = rates?.rates[currency];
    if (eur == null || !r) return null;
    return formatMoney(approx(eur * r), currency, i18n.language);
  };
  /** {main, original}: main is the converted price (or the original), original is set when converted. */
  const price = (p: DailyPrice): { main: string; original: string | null } => {
    const own = formatMoney(p.amount, p.currency, i18n.language);
    if (p.currency === currency) return { main: own, original: null };
    const conv = fromEur(p.eur ?? null);
    return conv ? { main: `≈ ${conv}`, original: own } : { main: own, original: null };
  };
  return { currency, fromEur, price };
}
