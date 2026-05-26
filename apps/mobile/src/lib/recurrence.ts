import i18n from '@/i18n';

type RecurrenceLike = {
  recurrence_type?: 'daily' | 'weekly' | 'every_n_days' | null;
  recurrence_weekdays?: number[];
  recurrence_interval?: number | null;
  recurrence_label?: string | null;
};

/**
 * Localized recurrence label for an event. The backend's recurrence_label is
 * English-only, so build the display string from the structured fields using
 * the event i18n namespace. Falls back to the server string for older payloads.
 * Weekday names come from i18n (Intl is unreliable on Hermes/Android).
 */
export function formatRecurrence(ev: RecurrenceLike): string | null {
  const type = ev.recurrence_type;
  if (!type) return ev.recurrence_label ?? null;

  const T = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'event', ...opts });

  switch (type) {
    case 'daily':
      return T('recur.everyday');
    case 'every_n_days':
      return T('recur.everyNDays', { count: ev.recurrence_interval ?? 1 });
    case 'weekly': {
      const days = [...(ev.recurrence_weekdays ?? [])].sort((a, b) => a - b);
      if (days.length === 0) return T('recur.weekly');
      if (days.length === 7) return T('recur.everyday');
      const names = i18n.t('weekdays', { ns: 'event', returnObjects: true }) as string[];
      return days.map((d) => names[d] ?? '?').join(' · ');
    }
    default:
      return ev.recurrence_label ?? null;
  }
}
