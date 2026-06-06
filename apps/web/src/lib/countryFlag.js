// ISO-2 country code → flag emoji. Returns '' for null / invalid / too long.
// Each letter maps to the regional-indicator-symbol code point
// (U+1F1E6 + (letter - 'A')). The OS picks the flag glyph from the pair.
export function countryToFlag(code) {
  if (typeof code !== 'string') return ''
  const c = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return ''
  const A = 0x1F1E6
  return String.fromCodePoint(A + (c.charCodeAt(0) - 65), A + (c.charCodeAt(1) - 65))
}
