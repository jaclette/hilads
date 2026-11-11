// Fonts: every composition waits for its fonts before its first layout (index.jsx withFonts). @remotion/fonts loadFont
// holds the screenshot (delayRender) but React has already laid the frame out with the fallback font by then, and
// nothing re-renders it once the font is in: the first frame each render tab draws kept the fallback's measurements
// (the canvas measure() in Reaction.jsx: a wider headline wrapping on two lines, a smaller table). So the components
// render nothing until every font is loaded, then lay out once with the real fonts.
import { useEffect, useState } from 'react';
import { continueRender, delayRender } from 'remotion';
import { loadFont as remotionLoadFont } from '@remotion/fonts';

const loads = [];

/** loadFont, tracked: withFonts waits for it. */
export function loadFont(options) {
  const p = remotionLoadFont(options);
  loads.push(p);
  return p;
}

/** The component, rendered only once every tracked font is loaded (the frame's screenshot waits for it). */
export function withFonts(Component) {
  return function WithFonts(props) {
    const [handle] = useState(() => delayRender('Waiting for the fonts before the first layout'));
    const [ready, setReady] = useState(false);
    useEffect(() => {
      let live = true;
      Promise.all(loads).then(() => document.fonts.ready).then(() => {
        if (live) setReady(true);
        continueRender(handle);
      });
      return () => { live = false; };
    }, [handle]);
    return ready ? <Component {...props} /> : null;
  };
}
