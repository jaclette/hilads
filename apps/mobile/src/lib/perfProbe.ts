import { AppState, Keyboard } from 'react-native';

/**
 * Perf probe (perf regression work, 2026-11-06). Two modes:
 *
 * - Development (__DEV__): live resource counters - intervals, pending timeouts, AppState /
 *   Keyboard subscriptions, realtime handlers - logged when they change (at most every 10 s),
 *   so a leak (a listener registered again on each focus, a timer never cleared) shows as a
 *   number that keeps climbing while you switch tabs.
 * - Measurement builds (EXPO_PUBLIC_PERF=1, release): the same counters plus the React commits
 *   (counted through the DevTools hook, which production React also calls), how long the JS
 *   thread was blocked (timer lag), each tab switch's latency (tab press → two frames after the
 *   screen is focused, then until its commits settle) and JS frames per second, sent every 10 s
 *   as JSON to EXPO_PUBLIC_PERF_URL (a collector on the Mac; release builds don't log).
 *
 * Off (no wrapping, no cost) in a normal release build.
 */
const PERF = process.env.EXPO_PUBLIC_PERF === '1';
const PERF_URL = process.env.EXPO_PUBLIC_PERF_URL ?? '';
export const perfEnabled = PERF || __DEV__;

const counts = { intervals: 0, timeouts: 0, appState: 0, keyboard: 0 };
let socketHandlers: () => number = () => 0;
let commitCount = 0;      // monotonic
let reported = 0;
let lastCommitAt = 0;
let lagMs = 0;
let maxLag = 0;
const switches: { to: string; ms: number; settledMs: number; commits: number }[] = [];
let pending: { to: string; t0: number; firstAt: number | null; commits0: number } | null = null;

// Count React commits: a minimal DevTools hook, defined before React loads (this module is
// imported first by index.js). Production React calls onCommitFiberRoot when a hook exists.
if (PERF) {
  (globalThis as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false,
    inject: () => 1, checkDCE: () => {}, onScheduleFiberRoot: () => {}, onPostCommitFiberRoot: () => {}, onCommitFiberUnmount: () => {},
    onCommitFiberRoot: () => { commitCount++; lastCommitAt = Date.now(); },
  };
}
let frames: number[] = [];

/** The realtime client's handler count (lib/socket registers it). */
export function setSocketHandlerCounter(fn: () => number) { socketHandlers = fn; }

function wrapTimers() {
  const g = globalThis as unknown as Record<string, (...a: unknown[]) => unknown>;
  const live = new Set<unknown>();
  const si = g.setInterval, ci = g.clearInterval, st = g.setTimeout, ct = g.clearTimeout;
  g.setInterval = (...a: unknown[]) => { const id = si(...a); live.add(id); counts.intervals = live.size; return id; };
  g.clearInterval = (id: unknown) => { live.delete(id); counts.intervals = live.size; return ci(id); };
  const waiting = new Set<unknown>();
  g.setTimeout = (fn: unknown, ...rest: unknown[]) => {
    let id: unknown = null;
    id = st(((...args: unknown[]) => { waiting.delete(id); counts.timeouts = waiting.size; (fn as (...x: unknown[]) => void)(...args); }) as unknown, ...rest);
    waiting.add(id); counts.timeouts = waiting.size;
    return id;
  };
  g.clearTimeout = (id: unknown) => { waiting.delete(id); counts.timeouts = waiting.size; return ct(id); };
}

function wrapListeners() {
  const as = AppState.addEventListener.bind(AppState);
  (AppState as unknown as { addEventListener: typeof AppState.addEventListener }).addEventListener = ((type: never, fn: never) => {
    const sub = as(type, fn);
    counts.appState++;
    let done = false;
    return { remove: () => { if (!done) { done = true; counts.appState--; } sub.remove(); } };
  }) as typeof AppState.addEventListener;
  const kb = Keyboard.addListener.bind(Keyboard);
  (Keyboard as unknown as { addListener: typeof Keyboard.addListener }).addListener = ((type: never, fn: never) => {
    const sub = kb(type, fn);
    counts.keyboard++;
    let done = false;
    return { remove: () => { if (!done) { done = true; counts.keyboard--; } sub.remove(); } } as ReturnType<typeof Keyboard.addListener>;
  }) as typeof Keyboard.addListener;
}

/** A tab was pressed (the tab bar). */
export function markTabPress(to: string) {
  if (!PERF) return;
  pending = { to, t0: Date.now(), firstAt: null, commits0: commitCount };
}

/** A tab screen got the focus: two frames later, the switch is on screen. */
export function markTabFocus(name: string) {
  if (!PERF || !pending || pending.to !== name) return;
  const p = pending;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    p.firstAt = Date.now();
    // Settled: no commit on that screen for 400 ms (data arriving, re-renders), at most 3 s.
    const check = () => {
      if (Date.now() - lastCommitAt >= 400 || Date.now() - p.t0 > 3000) {
        switches.push({ to: p.to, ms: (p.firstAt ?? Date.now()) - p.t0, settledMs: Math.max(p.firstAt ?? 0, lastCommitAt) - p.t0, commits: commitCount - p.commits0 });
        if (pending === p) pending = null;
      } else setTimeout(check, 100);
    };
    setTimeout(check, 100);
  }));
}

function heapMB(): number | null {
  const h = (globalThis as unknown as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } }).HermesInternal;
  const s = h?.getInstrumentedStats?.();
  return s?.js_heapSize ? Math.round((s.js_heapSize / 1048576) * 10) / 10 : null;
}

function snapshot() {
  return { ...counts, socket: socketHandlers() };
}

let installed = false;
/** Called once from index.js, before the app. */
export function installPerfProbe() {
  if (installed || !perfEnabled) return;
  installed = true;
  wrapTimers();
  wrapListeners();
  if (__DEV__ && !PERF) {
    // Development: the counters, when they change.
    let last = '';
    setInterval(() => {
      const s = JSON.stringify(snapshot());
      if (s !== last) { last = s; console.log('[perf] live', s); }
    }, 10_000);
    return;
  }
  // Measurement build: the JS thread's lag (a 50 ms timer that fires late = blocked), JS frames
  // per second, and a report every 10 s.
  let due = Date.now() + 50;
  const lag = () => {
    const late = Math.max(0, Date.now() - due);
    lagMs += late; maxLag = Math.max(maxLag, late);
    due = Date.now() + 50;
    setTimeout(lag, 50);
  };
  setTimeout(lag, 50);
  let n = 0;
  let t = Date.now();
  const tick = () => {
    n++;
    const now = Date.now();
    if (now - t >= 1000) { frames.push(Math.round((n * 1000) / (now - t))); n = 0; t = now; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setInterval(() => {
    const report = {
      at: Date.now(), heapMB: heapMB(), live: snapshot(),
      commits: commitCount - reported, lagMs, maxLagMs: maxLag,
      switches: switches.splice(0),
      fps: frames.length ? { min: Math.min(...frames), avg: Math.round(frames.reduce((a, b) => a + b, 0) / frames.length) } : null,
    };
    reported = commitCount; lagMs = 0; maxLag = 0;
    frames = [];
    if (PERF_URL) fetch(PERF_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) }).catch(() => {});
  }, 10_000);
}
