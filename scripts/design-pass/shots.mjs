// Design pass screenshots: the four tabs (Today · World · Map · Passport) on a small and a
// large iPhone, light and dark, plus the web app at a phone width. Same demo data as the store
// screenshots (scripts/store-screenshots: Docker stack on 8080/8091, photos on 8099, seed.json),
// so "before" and "after" shots compare like for like.
//
//   node scripts/design-pass/shots.mjs --out=docs/design-pass/before
//   node scripts/design-pass/shots.mjs --out=docs/design-pass/after --only=today --app=<Hilads.app>
//
// Options: --devices=small,large  --themes=light,dark  --only=today,world,map,passport
//          --no-web / --web-only   --app (default: the store pipeline's last release build)
// Files: <out>/<device>-<theme>-<screen>.png (device = small, large, web).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const STORE = path.join(ROOT, 'scripts/store-screenshots');
const require = createRequire(path.join(STORE, 'package.json'));
const puppeteer = require('puppeteer-core');

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const flag = (name) => process.argv.includes(`--${name}`);
const OUT = path.resolve(ROOT, arg('out', 'docs/design-pass/before'));
const APP = path.resolve(ROOT, arg('app', path.join(STORE, '.cache/app/Hilads.app')));
const DEVICES = arg('devices', 'small,large').split(',');
const THEMES = arg('themes', 'light,dark').split(',');
const ONLY = arg('only', 'today,world,map,passport').split(',');
const SEED = JSON.parse(fs.readFileSync(path.join(STORE, '.cache/seed.json'), 'utf8'));
const BUNDLE = 'com.hilads.app';
const MAESTRO = path.join(process.env.HOME, '.maestro/bin/maestro');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WORK = path.join(HERE, '.cache');

// The small phone is where the responsive scaling (src/scaling.ts) shrinks everything.
const SIMS = {
  small: { name: 'iPhone SE (3rd generation)' },
  large: { name: 'Hilads 6.9 (iPhone 17 Pro Max)' },
};

// tab → shots. Each shot: a deep link, what to wait for, optional scroll/tap, then the screenshot.
const SCREENS = {
  today: [
    { id: 'today-top', link: 'hilads:///', wait: { id: 'today-play' } },
    { id: 'today-catalogue', link: 'hilads:///', wait: { id: 'today-play' }, scrollTo: 'mosaic-tile' },
    { id: 'today-bottom', link: 'hilads:///', wait: { id: 'today-play' }, swipes: 6 },
  ],
  world: [
    { id: 'world-photos', link: 'hilads://ranks?tab=photos&period=today&scope=world', wait: { text: '.*minhanh.*' } },
    { id: 'world-photos-list', link: 'hilads://ranks?tab=photos&period=today&scope=world', wait: { text: '.*minhanh.*' }, swipes: 2 },
    { id: 'world-players', link: 'hilads://ranks?tab=players&period=week&scope=world', wait: { id: 'ranks-screen' } },
    { id: 'world-cities', link: 'hilads://ranks?tab=cities&period=week&scope=world', wait: { id: 'ranks-screen' } },
    { id: 'world-city', link: 'hilads://ranks?tab=photos&period=today&scope=city', wait: { id: 'ranks-screen' } },
  ],
  map: [
    { id: 'map', link: 'hilads://map', wait: { text: '(.*\\D)?10\\D.*' } },
    { id: 'map-sheet', link: 'hilads://map', wait: { text: '(.*\\D)?10\\D.*' }, tap: '.*spots to explore.*' },
  ],
  passport: [
    { id: 'passport-top', link: 'hilads://passport', wait: { id: 'passport-settings' } },
    { id: 'passport-bottom', link: 'hilads://passport', wait: { id: 'passport-settings' }, swipes: 6 },
  ],
};
const WEB = [
  { id: 'today-top', path: '/' },
  { id: 'today-catalogue', path: '/', scroll: 700 },
  { id: 'world', path: '/world?scope=world&period=today' },
  { id: 'map', path: '/map' },
  { id: 'passport-top', path: '/passport' },
  { id: 'passport-bottom', path: '/passport', scroll: 5000 },
];

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, ...opts });
const q = (s) => JSON.stringify(s);
const psql = (sql) => run('docker', ['exec', 'hilads-db-1', 'psql', '-U', 'hilads', '-d', 'hilads', '-qtAc', sql]);
const setAccountTheme = (t) => psql(`UPDATE users SET theme = '${t}' WHERE email = '${SEED.reviewEmail}'`);

async function preflight() {
  for (const [port, what] of [['8080', 'the API'], ['8099', 'the photo server']]) {
    const ok = await fetch(`http://localhost:${port}/`).then(() => true, () => false);
    if (!ok) throw new Error(`${what} (localhost:${port}) is not answering: run scripts/store-screenshots/run.sh first, or start it`);
  }
}

function openLink(url) {
  // iOS asks "Open in Hilads?" for links from outside, sometimes twice.
  return [`- openLink: ${q(url)}`, '- repeat:', '    while:', '      visible: "Open"', '    times: 4', '    commands:',
          '      - tapOn: "Open"', '      - waitForAnimationToEnd:', '          timeout: 1500'];
}

function flowFor(shots) {
  const steps = ['- launchApp:', `    appId: ${BUNDLE}`, '    stopApp: true', '    arguments:', '      AppleLanguages: "(en)"',
                 '- waitForAnimationToEnd:', '    timeout: 8000'];
  for (const s of shots) {
    steps.push(...openLink(s.link));
    const w = s.wait.id ? [`      id: ${q(s.wait.id)}`] : [`      text: ${q(s.wait.text)}`];
    steps.push('- extendedWaitUntil:', '    visible:', ...w, '    timeout: 25000');
    if (s.scrollTo) steps.push('- scrollUntilVisible:', '    element:', `      id: "${s.scrollTo}"`, '    direction: DOWN', '    timeout: 30000',
                               '    visibilityPercentage: 100', '    centerElement: true', '    speed: 40');
    for (let i = 0; i < (s.swipes ?? 0); i++) steps.push('- swipe:', '    start: 50%, 75%', '    end: 50%, 25%', '    duration: 500');
    if (s.tap) steps.push('- tapOn:', `    text: ${q(s.tap)}`, '    optional: true');
    steps.push('- waitForAnimationToEnd:', '    timeout: 8000', `- takeScreenshot: ${q(s.id)}`);
  }
  return [`appId: ${BUNDLE}`, '---', ...steps].join('\n') + '\n';
}

function findFile(root, name) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isFile() && e.name === name) return p;
    if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; }
  }
  return null;
}

function simulator(device) {
  const want = SIMS[device].name;
  const all = Object.values(JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '-j'])).devices).flat();
  const d = all.find((x) => x.name === want && x.isAvailable);
  if (!d) throw new Error(`No simulator named ${want}`);
  const sim = (...a) => run('xcrun', ['simctl', ...a]);
  try { sim('boot', d.udid); } catch { /* booted */ }
  sim('bootstatus', d.udid, '-b');
  sim('status_bar', d.udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3',
      '--cellularMode', 'active', '--cellularBars', '4', '--operatorName', '', '--batteryState', 'charged', '--batteryLevel', '100');
  sim('spawn', d.udid, 'defaults', 'write', 'com.apple.Accessibility', 'ReduceMotionEnabled', '-bool', 'YES');
  try { sim('uninstall', d.udid, BUNDLE); } catch { /* not installed */ }
  sim('keychain', d.udid, 'reset');
  sim('install', d.udid, APP);
  for (const s of ['photos', 'camera', 'notifications']) { try { sim('privacy', d.udid, 'grant', s, BUNDLE); } catch { /* fine */ } }
  try { sim('privacy', d.udid, 'revoke', 'location', BUNDLE); } catch { /* fine */ }
  return d.udid;
}

function maestro(udid, flow, env = {}, outDir = null) {
  const args = ['--device', udid, 'test', ...(outDir ? ['--test-output-dir', outDir] : []),
                ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), flow];
  run(MAESTRO, args, { stdio: 'inherit', timeout: 900000 });
}

function captureApp(device) {
  const udid = simulator(device);
  console.log(`▸ ${device}: ${SIMS[device].name}`);
  setAccountTheme('light');
  maestro(udid, path.join(STORE, 'maestro/login.yaml'), {
    EMAIL: SEED.reviewEmail, PASSWORD: SEED.reviewPassword, DUAL: `hilads://daily/${SEED.today}?proof=${SEED.dualProof}`,
  });
  const shots = ONLY.flatMap((tab) => SCREENS[tab]);
  for (const theme of THEMES) {
    setAccountTheme(theme);   // read by the app at launch (account.theme)
    const tag = `${device}-${theme}`;
    const out = path.join(WORK, 'maestro-out', tag);
    fs.rmSync(out, { recursive: true, force: true });
    const flow = path.join(WORK, `flow-${tag}.yaml`);
    fs.writeFileSync(flow, flowFor(shots));
    for (let attempt = 1; ; attempt++) {
      try { maestro(udid, flow, {}, out); break; } catch (e) {
        if (attempt === 2) throw e;
        console.log(`  Maestro failed on ${tag}, once more`);
      }
    }
    for (const s of shots) {
      const f = findFile(out, `${s.id}.png`);
      if (f) fs.copyFileSync(f, path.join(OUT, `${device}-${theme}-${s.id}.png`));
      else console.log(`  missing ${tag} ${s.id}`);
    }
  }
  setAccountTheme('light');
}

async function captureWeb() {
  console.log('▸ web');
  const port = 5173;   // the local API only allows this origin (CORS_ORIGINS)
  const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: path.join(ROOT, 'apps/web'), stdio: 'ignore',
    env: { ...process.env, VITE_API_URL: 'http://localhost:8080', VITE_WS_URL: 'ws://localhost:8091', VITE_SENTRY_DSN: '', VITE_POSTHOG_KEY: '' },
  });
  try {
    const base = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { if (await fetch(base).then(() => true, () => false)) break; await new Promise((r) => setTimeout(r, 1000)); }
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
    try {
      for (const theme of THEMES) {
        setAccountTheme(theme);
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
        await page.goto(base, { waitUntil: 'networkidle2' });
        // Sign in from Node, then hand the session cookie to the browser (localhost cookies ignore the port).
        const login = await fetch('http://localhost:8080/api/v1/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: SEED.reviewEmail, password: SEED.reviewPassword }),
        });
        const token = login.headers.get('set-cookie')?.match(/hilads_token=([^;]+)/)?.[1];
        if (!token) throw new Error(`web sign-in failed (${login.status})`);
        await page.setCookie({ name: 'hilads_token', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'None' });
        await page.evaluate((t) => { localStorage.clear(); localStorage.setItem('hilads_theme', t); localStorage.setItem('hilads_has_auth', '1'); }, theme);   // the web app only asks /auth/me when this flag is set
        for (const s of WEB) {
          await page.goto(base + s.path, { waitUntil: 'networkidle2' });
          await new Promise((r) => setTimeout(r, 2500));
          if (s.scroll) {
            await page.evaluate((y) => { for (const el of [document.scrollingElement, ...document.querySelectorAll('*')]) if (el && el.scrollHeight > el.clientHeight + 50 && getComputedStyle(el).overflowY !== 'hidden') el.scrollTop = y; }, s.scroll);
            await new Promise((r) => setTimeout(r, 1200));
          }
          await page.screenshot({ path: path.join(OUT, `web-${theme}-${s.id}.png`) });
        }
        await page.close();
      }
    } finally { await browser.close(); }
  } finally { vite.kill(); setAccountTheme('light'); }
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });
await preflight();
if (!flag('web-only')) for (const d of DEVICES) captureApp(d);
if (!flag('no-web')) await captureWeb();
console.log(`Done: ${OUT}`);
