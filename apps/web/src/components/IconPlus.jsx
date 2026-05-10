// Shared "+" glyph used by the chat composer "Add attachment" button across
// every chat surface (city channel, event chat, DM). Stroke style matches the
// app's other inline SVG icons (currentColor, stroke 2.2, round caps).

export default function IconPlus({ size = 22 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5"  x2="12" y2="19" />
      <line x1="5"  y1="12" x2="19" y2="12" />
    </svg>
  )
}
