// ISO-2 country code → flag emoji. Returns '' for null / invalid / too long.
// Mirrors apps/web/src/lib/countryFlag.js - same logic, typed.
export function countryToFlag(code: string | null | undefined): string {
  if (typeof code !== 'string') return '';
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  const A = 0x1F1E6;
  return String.fromCodePoint(A + (c.charCodeAt(0) - 65), A + (c.charCodeAt(1) - 65));
}
