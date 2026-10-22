import { useState } from 'react'
import { ACCENTS, AnswerBubble, DashedRoute, FlagSticker, HighlightText, JoyButton, Stamp, THEME_COLORS, ThemeChipJoy, Wordmark } from './Joy'

const THEMES = [['hidden_gem', 'Hidden gem'], ['taste', 'Taste'], ['join_in', 'Join in'], ['local_find', 'Local find'],
  ['night_out', 'Night out'], ['sip', 'Drinks'], ['only_here', 'Only here']]

/** /design: the joyful design's component gallery (DESIGN.md), with a light / dark switch. */
export default function DesignGallery() {
  const [dark, setDark] = useState(false)
  return (
    <div className="joy-gallery" data-theme={dark ? 'dark' : 'light'}>
      <div className="joy-gallery-head"><h1>Design gallery</h1><button type="button" className="joy-switch" onClick={() => setDark(d => !d)}>{dark ? 'Light' : 'Dark'}</button></div>
      <h2>Brand line</h2>
      <div className="joy-row"><Wordmark height={30} /><span className="joy-tag">Play local. Compare global.</span></div>
      <h2>Titles with a key word</h2>
      <HighlightText as="p" className="joy-title" text="Today around the *world*" />
      <HighlightText as="p" className="joy-title" text="Be the *first* to play for Saigon" color={THEME_COLORS.sip.fill} />
      <HighlightText as="p" className="joy-title" text="Yesterday around the *world*" color={THEME_COLORS.hidden_gem.fill} />
      <h2>Theme colors</h2>
      <div className="joy-wrap">{THEMES.map(([k, l]) => <ThemeChipJoy key={k} theme={k} label={l} />)}</div>
      <div className="joy-wrap">{THEMES.map(([k, l]) => <span key={k} className="joy-colored" style={{ '--ct': THEME_COLORS[k].light, '--ctd': THEME_COLORS[k].dark }}>{l}</span>)}</div>
      <div className="joy-wrap">{ACCENTS.map(c => <span key={c} className="joy-swatch" style={{ background: c }} />)}</div>
      <h2>Buttons</h2>
      <JoyButton label="Play for Saigon" icon="camera-outline" />
      <div className="joy-photo"><AnswerBubble text="Một, hai, ba, dzô!" onPhoto size="lg" /><JoyButton label="Play for Saigon" icon="camera-outline" onPhoto /></div>
      <h2>Flag stickers and answer bubbles</h2>
      {[['VN', 'Saigon', 'Một, hai, ba, dzô!'], ['MX', 'Mexico City', '¡Salud!'], ['JP', 'Tokyo', 'Kanpai!'], ['DE', 'Berlin', 'Prost!']].map(([cc, city, a]) => (
        <div key={cc} className="joy-cmp"><FlagSticker country={cc} size={30} /><span className="joy-cmp-body"><span className="joy-city">{city}</span><AnswerBubble text={a} /></span><span className="joy-price">Usual price $1.16</span></div>
      ))}
      <h2>Stamps</h2>
      <div className="joy-wrap">{THEMES.map(([k, l], i) => <Stamp key={k} theme={k} label={l} earned={i !== 5} />)}</div>
      <h2>Header motif</h2>
      <div className="joy-header"><DashedRoute /><span className="joy-screen-title">Passport</span></div>
    </div>
  )
}
