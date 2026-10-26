/**
 * The line drawing behind a main screen's header (SPEC 9.1): Hi = speech
 * bubbles, Map = contour lines with a dashed route and a pin, Passport = a
 * round stamp, slightly rotated, over guilloche lines. Primary-coloured at
 * about 20% (a tuned stroke in dark mode, --header-art*), on the header's
 * right so the title stays on a plain background. Decorative. Photos stay
 * reserved for the Daily Challenge cover on Today.
 */
import { SeasonalHeaderDecor } from './event/seasonal'

export default function HeaderArt({ kind }) {
  return (
    <>
    <svg className="header-art" viewBox="0 0 160 96" aria-hidden="true" focusable="false"
         fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {kind === 'hi' && <Bubbles />}
      {kind === 'map' && <Contours />}
      {kind === 'passport' && <Stamp />}
    </svg>
    {/* A seasonal event's live day: a cobweb and ghosts over the drawing. */}
    <SeasonalHeaderDecor />
    </>
  )
}

function Bubbles() {
  return (
    <>
      <path d="M58 14h52a12 12 0 0 1 12 12v20a12 12 0 0 1-12 12H84l-12 11V58H58a12 12 0 0 1-12-12V26a12 12 0 0 1 12-12z" />
      <circle cx="70" cy="36" r="2.5" /><circle cx="84" cy="36" r="2.5" /><circle cx="98" cy="36" r="2.5" />
      <path d="M118 50h26a10 10 0 0 1 10 10v10a10 10 0 0 1-10 10h-3v8l-9-8h-14a10 10 0 0 1-10-10V60a10 10 0 0 1 10-10z" />
      <path d="M118 63h22M118 70h14" />
    </>
  )
}

function Contours() {
  return (
    <>
      <path d="M66 48c0-20 22-36 46-34s40 16 38 32-18 34-42 34-42-12-42-32z" />
      <path d="M80 48c0-12 14-22 30-21s27 10 25 21-12 22-28 22-27-8-27-22z" />
      <path d="M95 48c0-6 7-11 15-10s13 5 12 11-6 11-14 11-13-5-13-12z" />
      <path d="M36 90c18-7 32-3 46 1s32 6 54-5" />
      <path d="M44 74c14-10 28-4 38-12s16-20 34-24" strokeDasharray="4 5" />
      <path d="M130 14c-6 0-10.5 4.5-10.5 10.5 0 7.5 10.5 18.5 10.5 18.5s10.5-11 10.5-18.5C140.5 18.5 136 14 130 14z" />
      <circle cx="130" cy="24.5" r="3" />
    </>
  )
}

function Stamp() {
  const waves = [14, 26, 38, 50, 62, 74, 86]
  return (
    <>
      {waves.map((y, i) => (
        <path key={y} strokeWidth="0.75"
              d={`M${20 + (i % 2) * 10} ${y} q10 -6 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0`} />
      ))}
      <g transform="rotate(-12 112 48)">
        <circle cx="112" cy="48" r="32" strokeWidth="2" />
        <circle cx="112" cy="48" r="25" strokeDasharray="2 3" />
        <path d="M98 44h28M101 52h22" />
        <path d="M112 24l1.6 3.4 3.7.4-2.8 2.5.8 3.7-3.3-1.9-3.3 1.9.8-3.7-2.8-2.5 3.7-.4z" />
      </g>
    </>
  )
}
