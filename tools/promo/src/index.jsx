import { Composition, Still, registerRoot } from 'remotion';
import { PromoVideo, PromoSlide } from './Promo.jsx';

// Props come from render.mjs ({locale, data, cities, clip, timing}); the
// defaults let `npm run studio` open without a render.
const sample = {
  locale: 'en',
  data: {
    yesterday: { theme: 'sip', themeName: { en: 'Drinks', fr: 'Boissons' }, question: { en: 'How does the world say cheers?', fr: 'Comment le monde dit santé ?' } },
    today: { theme: 'get_around', themeName: { en: 'Get around', fr: 'En route' }, question: { en: 'Take the ride locals take to work.', fr: 'Prends le trajet des locaux pour aller bosser.' } },
  },
  cities: [],
  clip: null,
  timing: { clip: 0, hook: 75, city: 30, end: 60, cities: 0, total: 60 },
};

function Root() {
  return (
    <>
      <Composition id="Video" component={PromoVideo} width={1080} height={1920} fps={30} durationInFrames={60}
        defaultProps={sample} calculateMetadata={({ props }) => ({ durationInFrames: props.timing.total })} />
      <Still id="Slide" component={PromoSlide} width={1080} height={1350} defaultProps={{ ...sample, slide: { kind: 'end' } }} />
    </>
  );
}

registerRoot(Root);
