// Custom entry: install global responsive scaling BEFORE expo-router loads any
// screens, so the StyleSheet.create patch in ./src/scaling is in place before the
// first component registers its styles. Then hand off to the normal Expo Router
// entry. (package.json "main" points here.)
// The perf probe first: it hooks timers, listeners and React's commits before anything loads.
import { installPerfProbe } from './src/lib/perfProbe';
import { enableFreeze } from 'react-native-screens';
import './src/scaling';
import 'expo-router/entry';

installPerfProbe();
// Screens that aren't focused (other tabs, screens under a pushed one) don't re-render:
// their updates wait until they're shown again (react-freeze, via react-native-screens).
enableFreeze(true);
