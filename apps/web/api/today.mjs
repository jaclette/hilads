/**
 * hilads.live/today (and /<locale>/today) — today's Daily Challenge, shareable.
 *
 * With the app installed the link never lands here: Universal Links (AASA) and
 * Android App Links open the app on today's challenge sheet. This page is for
 * everyone else: today's challenge, the Local Twist when the visitor's city is
 * live, a countdown, and the same install / join CTAs as /join. Inside in-app
 * browsers (Instagram, Zalo…), which never hand links to the OS, an "Open in
 * the app" button (plus the same auto-bounce as OpenInAppBanner) gets app
 * users in.
 *
 * Server-rendered so link previews show the challenge (og:title / og:image).
 * The HTML is CDN-cached until the next drop, one copy per locale path. The
 * twist depends on the visitor's city, so the browser adds it after load
 * (/api/geo → /api/daily-today, itself cached per city).
 *
 * V2: the challenge's theme (server-rendered), and in the browser "Proposed
 * by", tomorrow's theme (a teaser, never its text) and the live top 3 (fetched
 * from the public API, hidden until the challenge is ranked).
 *
 * Standalone and light (no fonts, no app bundle), same daylight style as
 * /join. UI strings: the path locale, else (bare /today) the browser language.
 * The challenge text itself is English.
 */

import { API_BASE, fetchDailyToday, cacheSeconds, cacheHeader } from './_daily.mjs'
import { TODAY_STRINGS } from './_today-i18n.mjs'

const SITE = 'https://hilads.live'
const THEME_EMOJI = {
  hidden_gem: '💎', taste: '🍜', get_around: '🛵', local_find: '🛍️', night_out: '🌙', sip: '🍹', only_here: '📍',
}
const LOCALES = Object.keys(TODAY_STRINGS)

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

// JSON inside a <script>: never let the data close the tag.
function inlineJson(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

export function renderToday(data, locale, prefixed) {
  const S = TODAY_STRINGS[locale] || TODAY_STRINGS.en
  const c = data && data.challenge
  const title = c ? `Daily Challenge: ${c.text}` : 'Hilads Daily Challenge'
  const image = c ? `${SITE}/api/og?type=today&d=${encodeURIComponent(c.date)}` : `${SITE}/og/og-default.png`
  const boot = {
    challenge: c || null,
    nextDropAt: (data && data.nextDropAt) || null,
    tomorrow: (data && data.tomorrow) || null,
    themeEmoji: THEME_EMOJI,
    api: API_BASE,
    locale,
    // Bare /today: the browser language may pick another locale client-side.
    strings: prefixed ? { [locale]: S } : TODAY_STRINGS,
    prefixed,
  }

  return `<!doctype html>
<html lang="${esc(locale)}"${locale === 'ar' ? ' dir="rtl"' : ''}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="theme-color" content="#FBF6F0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(S.pitch)}" />
  <link rel="canonical" href="${SITE}/today" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Hilads" />
  <meta property="og:url" content="${SITE}/today" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(S.pitch)}" />
  <meta property="og:image" content="${esc(image)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(S.pitch)}" />
  <meta name="twitter:image" content="${esc(image)}" />
  <meta name="apple-itunes-app" content="app-id=6768905591" />
  <style>
    :root{
      --bg:#FBF6F0; --surface:#FFFFFF; --surface2:#F3EAE0;
      --accent:#C24A38; --accent2:#9C5A1C; --hot:#FF7A3C;
      --text:#241A12; --muted:#6E5D4E; --line:#EADDD0;
      color-scheme:light;
    }
    *{ box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
    html,body{ margin:0; padding:0; }
    body{
      min-height:100svh; background:var(--bg); color:var(--text);
      font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      -webkit-font-smoothing:antialiased;
      background-image:radial-gradient(120% 60% at 50% -6%, rgba(255,122,60,.16), rgba(251,246,240,0) 55%);
    }
    .wrap{
      max-width:440px; margin:0 auto; min-height:100svh;
      display:flex; flex-direction:column; align-items:center; text-align:center; gap:16px;
      padding:calc(14px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom));
    }
    .brandrow{ display:flex; align-items:center; gap:7px; align-self:stretch; justify-content:center; }
    .brandrow svg{ display:block; flex:0 0 auto; }
    .brandrow .name{ font-weight:700; font-size:16px; letter-spacing:-.3px; }
    .brandrow .tag{ color:var(--muted); font-size:12px; margin-inline-start:2px; padding-inline-start:8px; border-inline-start:1px solid rgba(28,20,14,.14); }
    .card{
      width:100%; margin-top:8px; padding:22px 18px 20px; border-radius:22px;
      background:var(--surface); border:1px solid var(--line); box-shadow:0 8px 28px rgba(28,20,14,.08);
      display:flex; flex-direction:column; align-items:center; gap:12px;
    }
    .kicker{
      display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:800; letter-spacing:.3px;
      color:var(--accent2); background:linear-gradient(135deg,rgba(194,74,56,.14),rgba(184,114,40,.10));
      border:1px solid rgba(255,122,60,.38); border-radius:999px; padding:6px 13px;
    }
    h1{ margin:0; font-weight:800; letter-spacing:-.5px; line-height:1.15; font-size:clamp(24px,7vw,32px); text-wrap:balance; }
    .ctx{ margin:0; color:var(--muted); font-size:15px; line-height:1.45; }
    .twist{
      width:100%; text-align:start; padding:12px 14px; border-radius:14px;
      background:linear-gradient(135deg,rgba(194,74,56,.10),rgba(184,114,40,.07)); border:1px solid rgba(255,122,60,.32);
    }
    .twist .t-title{ font-size:12.5px; font-weight:800; color:var(--accent2); letter-spacing:.2px; }
    .twist .t-text{ margin-top:4px; font-size:15px; font-weight:600; line-height:1.4; }
    .twist .t-by{ margin-top:4px; font-size:12px; color:var(--muted); }
    .theme{ font-size:13px; font-weight:800; color:var(--text); background:var(--surface2); border-radius:999px; padding:5px 12px; }
    .by{ margin:0; font-size:13px; font-weight:700; color:var(--accent); }
    .tomorrow{ font-size:13px; color:var(--muted); }
    .top3{ width:100%; display:flex; flex-direction:column; gap:8px; padding:14px; border-radius:18px; background:var(--surface); border:1px solid var(--line); }
    .top3 .t3-title{ font-size:13px; font-weight:800; text-align:start; }
    .top3 .row{ display:flex; align-items:center; gap:10px; text-align:start; }
    .top3 .medal{ font-size:20px; width:26px; text-align:center; }
    .top3 img, .top3 .ph{ width:42px; height:42px; border-radius:10px; object-fit:cover; background:var(--surface2); flex:0 0 auto; }
    .top3 .who{ flex:1; min-width:0; font-size:14px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .top3 .who small{ font-weight:500; color:var(--muted); }
    .top3 .votes{ font-size:13px; font-weight:800; }
    .timer{ font-size:14px; font-weight:700; color:var(--text); background:var(--surface2); border-radius:999px; padding:7px 14px; font-variant-numeric:tabular-nums; }
    .pitch{ margin:0; max-width:22em; color:var(--text); opacity:.82; font-size:15px; line-height:1.5; }
    .ctas{ width:100%; max-width:360px; display:flex; flex-direction:column; gap:11px; }
    .stores{ display:flex; flex-direction:column; gap:11px; }
    a.btn{
      display:flex; align-items:center; justify-content:center; gap:10px;
      width:100%; min-height:56px; padding:0 18px; border-radius:16px;
      text-decoration:none; font-weight:700; font-size:16px; color:#fff;
      background:#1E150F; border:1px solid rgba(255,255,255,.06); box-shadow:0 4px 14px rgba(28,20,14,.12);
    }
    a.btn .ico{ width:20px; height:20px; flex:0 0 auto; }
    a.btn small{ display:block; font-weight:500; font-size:11px; opacity:.7; line-height:1; margin-bottom:2px; }
    a.btn .lbl{ text-align:left; line-height:1.05; }
    [dir="rtl"] a.btn .lbl{ text-align:right; }
    a.open{ background:var(--surface); color:var(--text); border:1.5px solid var(--accent); box-shadow:none; }
    a.web{
      position:relative; overflow:hidden; isolation:isolate;
      background:linear-gradient(135deg,#FF7A3C 0%,var(--accent) 58%,#A5372A 100%);
      border:none; font-size:16.5px; font-weight:800; letter-spacing:.2px;
      text-shadow:0 1px 2px rgba(0,0,0,.30); box-shadow:0 6px 20px rgba(194,74,56,.38);
      transition:transform .12s ease;
    }
    a.web:active, a.btn:active{ transform:scale(.98); }
    a.web::after{ content:""; position:absolute; top:0; bottom:0; left:-60%; width:42%;
      background:linear-gradient(100deg,transparent,rgba(255,255,255,.42),transparent);
      transform:skewX(-18deg); pointer-events:none; }
    @media (prefers-reduced-motion: no-preference){
      a.web::after{ animation:ctaShine 3.6s ease-in-out infinite; will-change:left; }
    }
    @keyframes ctaShine{ 0%{ left:-60%; } 48%{ left:130%; } 100%{ left:130%; } }
  </style>
</head>
<body>
  <main class="wrap">
    <div class="brandrow">
      <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true">
        <defs><linearGradient id="hig" x1="5%" y1="0%" x2="95%" y2="100%"><stop offset="0%" stop-color="#C24A38"/><stop offset="44%" stop-color="#B85530"/><stop offset="100%" stop-color="#B87228"/></linearGradient></defs>
        <rect width="64" height="64" rx="15" fill="url(#hig)"/>
        <rect x="9" y="13" width="8" height="38" rx="2.5" fill="#fff"/><rect x="26" y="13" width="8" height="38" rx="2.5" fill="#fff"/>
        <rect x="17" y="28" width="9" height="6" rx="2" fill="#fff"/><rect x="43" y="25" width="8" height="26" rx="2.5" fill="#fff"/>
        <circle cx="47" cy="15" r="5.5" fill="#fff"/>
      </svg>
      <span class="name">hilads</span>
      <span class="tag" data-k="tag">${esc(S.tag)}</span>
    </div>

    <section class="card">
      <div class="kicker">🔥 Daily Challenge</div>
      ${c && c.theme ? (c.special
        ? `<div class="theme">${esc(c.special.emoji || '✨')} ${esc(c.special.name)}</div>`
        : `<div class="theme">${THEME_EMOJI[c.theme.key] || '•'} ${esc(c.theme.name)}</div>`) : ''}
      ${c
        ? `<h1>${esc(c.text)}</h1>${c.context ? `\n      <p class="ctx">${esc(c.context)}</p>` : ''}`
        : `<h1 data-k="nothingLive">${esc(S.nothingLive)}</h1>`}
      <p class="by" id="by" hidden></p>
      <div class="twist" id="twist" hidden>
        <div class="t-title" id="twist-title"></div>
        <div class="t-text" id="twist-text"></div>
        <div class="t-by" id="twist-by" hidden></div>
      </div>
      <div class="timer" id="timer" hidden></div>
      <div class="tomorrow" id="tomorrow" hidden></div>
    </section>

    <section class="top3" id="top3" hidden>
      <div class="t3-title" id="top3-title"></div>
      <div id="top3-rows"></div>
    </section>

    <p class="pitch" data-k="pitch">${esc(S.pitch)}</p>

    <div class="ctas">
      <a class="btn open" id="cta-open" href="hilads://today" hidden data-k="open">${esc(S.open)}</a>
      <div class="stores" id="stores">
        <a class="btn" id="cta-ios" href="https://apps.apple.com/app/id6768905591" rel="noopener">
          <svg class="ico" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M16.365 1.43c0 1.14-.417 2.2-1.11 3.02-.83.98-2.19 1.74-3.32 1.65-.14-1.1.42-2.27 1.08-3.02.75-.85 2.06-1.5 3.35-1.65zM20.5 17.02c-.55 1.27-.81 1.83-1.52 2.95-.99 1.57-2.39 3.52-4.12 3.53-1.54.02-1.94-.99-4.03-.98-2.09.01-2.53 1-4.07.97-1.73-.02-3.05-1.79-4.04-3.36C-.19 16.6-.46 11.5 1.4 8.79c1.05-1.55 2.71-2.53 4.28-2.53 1.6 0 2.61 1 3.93 1 1.28 0 2.06-1 3.91-1 1.4 0 2.88.76 3.94 2.08-3.46 1.9-2.9 6.84.14 8.68z"/></svg>
          <span class="lbl"><small data-k="ios">${esc(S.ios)}</small>App Store</span>
        </a>
        <a class="btn" id="cta-android" href="https://play.google.com/store/apps/details?id=com.hilads.app" rel="noopener">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="#34A853" d="M3.6 2.2 13 11.6l2.6-2.6z"/><path fill="#EA4335" d="M3.05 1.9c-.28.2-.45.5-.45.9v18.4c0 .4.17.7.45.9L13 11.6z" opacity=".9"/><path fill="#4285F4" d="M3.6 21.8 15.6 15l-2.6-2.6z"/><path fill="#FBBC05" d="M18.9 10.1 15.6 8.2 12.7 11l2.9 2.9 3.3-1.9c.9-.5.9-1.4 0-1.9z"/></svg>
          <span class="lbl"><small data-k="android">${esc(S.android)}</small>Google Play</span>
        </a>
      </div>
      <a class="btn web" id="cta-web" href="/?auth=signup" rel="noopener" data-k="web">${esc(S.web)}</a>
    </div>
  </main>

  <script>window.__TODAY = ${inlineJson(boot)};</script>
  <script>
  (function () {
    /* ── PostHog (same project + managed reverse proxy as the app and /join) ── */
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once unregister getFeatureFlag isFeatureEnabled reloadFeatureFlags identify setPersonProperties reset get_distinct_id opt_in_capturing opt_out_capturing set_config".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init('phc_zz4Q6VJETesgBUkeKe8a9asUwbra9qGXgw4ff6zPTxLM', {
      api_host: 'https://hi.hilads.live', ui_host: 'https://eu.posthog.com',
      autocapture: false, capture_pageleave: false, disable_session_recording: true, disable_toolbar: true,
    });
    function cap(ev, props){ try { posthog.capture(ev, props); } catch (e) {} }
    function $(id){ return document.getElementById(id); }

    var B = window.__TODAY || {};
    var C = B.challenge;

    /* ── Locale: the path one, else the browser language (as on /join) ─────── */
    function pickLocale(){
      var q = new URLSearchParams(location.search).get('lang');
      var nav = (q || navigator.language || 'en').toLowerCase();
      if (nav === 'pt-br') return 'pt-br';
      if (nav.slice(0,2) === 'pt') return 'pt-pt';
      if (nav.slice(0,2) === 'zh') return /hant|tw|hk|mo/.test(nav) ? 'zh-hant' : 'zh-hans';
      if (nav.slice(0,3) === 'fil' || nav.slice(0,2) === 'tl') return 'fil';
      var s = nav.slice(0,2);
      return B.strings[s] ? s : 'en';
    }
    var L = B.prefixed ? B.locale : pickLocale();
    var S = B.strings[L] || B.strings[B.locale];
    if (L !== B.locale) {
      document.documentElement.lang = L;
      document.documentElement.dir = L === 'ar' ? 'rtl' : 'ltr';
      var els = document.querySelectorAll('[data-k]');
      for (var i = 0; i < els.length; i++) { var k = els[i].getAttribute('data-k'); if (S[k]) els[i].textContent = S[k]; }
    }
    function fmt(s, vars){ return s.replace(/\\{(\\w+)\\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }); }

    /* ── UTM passthrough → super props + the signup CTA ───────────────────── */
    var KEEP = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','ttclid','ref'];
    var sp = new URLSearchParams(location.search), pass = new URLSearchParams(), sup = {};
    KEEP.forEach(function (k) { var v = sp.get(k); if (v) { pass.set(k, v); sup[k] = v; } });
    if (Object.keys(sup).length) { try { posthog.register(sup); } catch (e) {} }
    $('cta-web').setAttribute('href', '/?auth=signup' + (pass.toString() ? '&' + pass.toString() : ''));

    /* ── Countdown (same format as the app: 5h 07m / 12m / 40s) ───────────── */
    function countdown(sec){
      var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
      if (h > 0) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
      if (m > 0) return m + 'm';
      return sec + 's';
    }
    var target = C ? C.endsAt : B.nextDropAt, reloaded = false;
    function tick(){
      if (!target) return;
      var left = Math.max(0, Math.round(target - Date.now() / 1000));
      $('timer').textContent = '⏳ ' + fmt(C ? S.timeLeft : S.nextIn, { time: countdown(left) });
      $('timer').hidden = false;
      // New challenge: the cached page expires at the drop, so a reload shows it.
      if (left === 0 && !reloaded) { reloaded = true; setTimeout(function () { location.reload(); }, 4000); }
    }
    tick();
    setInterval(tick, 1000);

    /* ── Platform: store order + "Open in the app" (mobile only) ─────────────── */
    var ua = navigator.userAgent || '';
    var isAndroid = /android/i.test(ua), isMobile = /android|iphone|ipad|ipod/i.test(ua);
    var IN_APP_RE = /\\b(Zalo|FBAN|FBAV|FB_IAB|Instagram|Line\\/|MicroMessenger|Snapchat|Twitter|TikTok|KAKAOTALK)\\b/i;
    if (isAndroid) $('stores').insertBefore($('cta-android'), $('cta-ios'));
    var appUrl = isAndroid
      ? 'intent://today#Intent;scheme=hilads;package=com.hilads.app;S.browser_fallback_url=' + encodeURIComponent(location.href) + ';end'
      : 'hilads://today';
    if (isMobile) {
      $('cta-open').setAttribute('href', appUrl);
      $('cta-open').hidden = false;
      // In-app browsers swallow Universal / App Links: bounce to the app like
      // OpenInAppBanner does. Without the app, the webview ignores it silently.
      if (IN_APP_RE.test(ua)) setTimeout(function () { try { location.href = appUrl; } catch (e) {} }, 400);
    }

    /* ── Visitor's city → Local Twist when it is live (cached edge fns) ──────── */
    var CITY = 'unknown', CITY_LIVE = false, HAS_TWIST = false, opened = false;
    function opened_(){
      if (opened) return; opened = true;
      cap('daily_link_opened', {
        challenge_date: C ? C.date : null, city: CITY, city_live: CITY_LIVE, has_twist: HAS_TWIST,
        source: 'web', locale: L, in_app_browser: IN_APP_RE.test(ua),
      });
    }
    function locCity(CN, n){ if(!n||!CN) return n||''; var s=String(n).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); return CN[s]||n; }
    if (C) {
      fetch('/api/geo').then(function (r) { return r.json(); }).then(function (g) {
        if (!g || !g.channelId) { opened_(); return; }
        CITY = g.city || 'unknown';
        return Promise.all([
          fetch('/api/daily-today?cityId=' + encodeURIComponent(g.channelId)).then(function (r) { return r.json(); }),
          fetch('/citynames/' + L + '.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
        ]).then(function (res) {
          var d = res[0], CN = res[1];
          CITY_LIVE = !!(d && d.city && d.city.isLive);
          var tw = d && d.twist;
          if (CITY_LIVE && tw && d.challenge && d.challenge.date === C.date) {
            HAS_TWIST = true;
            $('twist-title').textContent = '📍 ' + fmt(S.twistIn, { city: locCity(CN, d.city.name || g.city) });
            $('twist-text').textContent = tw.text;
            if (tw.by) { $('twist-by').textContent = fmt(S.twistBy, { name: tw.by }); $('twist-by').hidden = false; }
            $('twist').hidden = false;
          }
          opened_();
        });
      }).catch(function () { opened_(); });
    }
    setTimeout(opened_, C ? 2500 : 0);

    /* ── V2: "Proposed by", tomorrow's theme, the live top 3 ─────────────── */
    if (C && C.proposedBy && C.proposedBy.name) {
      $('by').textContent = '💡 ' + (C.proposedBy.city
        ? fmt(S.proposedByCity, { name: C.proposedBy.name, city: C.proposedBy.city })
        : fmt(S.proposedBy, { name: C.proposedBy.name }));
      $('by').hidden = false;
    }
    if (B.tomorrow && B.tomorrow.theme) {
      var sp = B.tomorrow.special;
      $('tomorrow').textContent = fmt(S.tomorrow, { theme: sp ? (sp.emoji || '') + ' ' + sp.name : (B.themeEmoji[B.tomorrow.theme.key] || '') + ' ' + B.tomorrow.theme.name });
      $('tomorrow').hidden = false;
    }
    var MEDALS = ['🥇', '🥈', '🥉'];
    function top3(){
      if (!C || document.visibilityState === 'hidden') return;
      fetch(B.api + '/api/v1/daily/leaderboard').then(function (r) { return r.ok ? r.json() : null; }).then(function (lb) {
        var rows = lb && lb.ranked && lb.date === C.date ? (lb.world || []).slice(0, 3) : [];
        if (!rows.length) { $('top3').hidden = true; return; }
        $('top3-title').textContent = '🏆 ' + S.top3;
        var box = $('top3-rows'); box.textContent = '';
        rows.forEach(function (e) {
          var row = document.createElement('div'); row.className = 'row';
          var m = document.createElement('span'); m.className = 'medal'; m.textContent = MEDALS[e.rank - 1] || ('#' + e.rank);
          var img = document.createElement(e.thumbUrl ? 'img' : 'span');
          if (e.thumbUrl) { img.src = e.thumbUrl; img.alt = ''; img.loading = 'lazy'; } else { img.className = 'ph'; }
          var who = document.createElement('span'); who.className = 'who';
          who.textContent = (e.user && (e.user.displayName || e.user.username)) || '';
          if (e.city && e.city.name) { var sm = document.createElement('small'); sm.textContent = ' · ' + e.city.name; who.appendChild(sm); }
          var v = document.createElement('span'); v.className = 'votes'; v.textContent = '♥ ' + e.voteCount;
          row.appendChild(m); row.appendChild(img); row.appendChild(who); row.appendChild(v);
          box.appendChild(row);
        });
        $('top3').hidden = false;
      }).catch(function () {});
    }
    top3();
    setInterval(top3, 60000);

    /* ── CTA tracking (fire, then navigate after a beat so it flushes) ────── */
    function wire(id, target){
      var el = $(id);
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var url = el.getAttribute('href');
        cap('daily_link_cta', { target: target, challenge_date: C ? C.date : null, city: CITY, locale: L });
        setTimeout(function () { location.href = url; }, 140);
      });
    }
    wire('cta-open', 'open_app');
    wire('cta-ios', 'appstore');
    wire('cta-android', 'playstore');
    wire('cta-web', 'web_signup');
  })();
  </script>
</body>
</html>`
}

export default async function handler(req, res) {
  const raw = String((req.query && req.query.locale) || '').toLowerCase()
  const prefixed = raw !== '' && raw !== 'en' && LOCALES.includes(raw)
  const locale = prefixed ? raw : 'en'

  const data = await fetchDailyToday(null)
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', cacheHeader(cacheSeconds(data)))
  res.end(renderToday(data, locale, prefixed))
}
