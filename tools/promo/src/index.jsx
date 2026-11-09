import { Composition, Still, registerRoot } from 'remotion';
import { PromoVideo, PromoSlide } from './Promo.jsx';
import { StoryFrame } from './Stories.jsx';
import { WorldsVideo, worldsTiming } from './Worlds.jsx';
import { ReactionRanking, reactionSeconds } from './Reaction.jsx';

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
      <Composition id="Story" component={StoryFrame} width={1080} height={1920} fps={30} durationInFrames={150}
        defaultProps={{ frame: 'help', locale: 'en', halloween: true, photo: null, still: false, guide: false }} />
      <Composition id="Worlds" component={WorldsVideo} width={1080} height={1920} fps={30} durationInFrames={90}
        defaultProps={{ slides: [{ kind: 'hook', text: 'Same night, October 31. Seven countries, seven very different Halloweens.' }] }}
        calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, worldsTiming(props.slides).total) })} />
      <Composition id="Reaction" component={ReactionRanking} width={1080} height={1920} fps={30} durationInFrames={10 * 30}
        calculateMetadata={({ props }) => ({ durationInFrames: Math.round(reactionSeconds(props.question) * 30) })}
        defaultProps={{ headline: 'The 20 biggest beer drinkers 🍺', detail: '#1 has won for 32 years.', source: 'Source: Kirin', highlight: ['Vietnam'], clip: null,
                        rows: [{ rank: 1, country: 'Czech Republic', flag: null, value: 148.8, unit: 'L' }, { rank: 2, country: 'Lithuania', flag: null, value: 110.6, unit: 'L' }] }} />
      <Still id="Slide" component={PromoSlide} width={1080} height={1350} defaultProps={{ ...sample, slide: { kind: 'end' } }} />
    </>
  );
}

registerRoot(Root);
