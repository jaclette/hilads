<?php

declare(strict_types=1);

// Shared helpers for the Daily Challenge back office pages (admin/daily_*.php).
// Admin pages run in Asia/Ho_Chi_Minh (boot.php); a challenge_date is the UTC
// date of its drop, so every date is shown with its live window in Saigon time.

function dh(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES);
}

/** "Mon 2 Nov 09:00 → Tue 3 Nov 09:00" in Saigon time. */
function daily_window_label(string $date): string
{
    [$start, $end] = DailyClock::window($date);
    return date('D j M H:i', $start->getTimestamp()) . ' → ' . date('D j M H:i', $end->getTimestamp());
}

function daily_text(?string $json): string
{
    return (string) (json_decode((string) $json, true)['en'] ?? '');
}

function daily_state_badge(string $state): string
{
    $map = [
        'empty'        => ['#7f1d1d', '#fca5a5', 'empty'],
        'draft'        => ['#3f3f46', '#d4d4d8', 'draft'],
        'scheduled'    => ['#1e3a5f', '#93c5fd', 'scheduled'],
        'published'    => ['#14532d', '#86efac', 'published'],
        'reserve_used' => ['#4a3410', '#fcd34d', 'reserve used'],
        'pending'      => ['#4a3410', '#fcd34d', 'pending'],
        'approved'     => ['#14532d', '#86efac', 'approved'],
        'rejected'     => ['#7f1d1d', '#fca5a5', 'rejected'],
        'removed'      => ['#3f3f46', '#a1a1aa', 'removed'],
    ];
    [$bg, $fg, $label] = $map[$state] ?? ['#3f3f46', '#d4d4d8', $state];
    return '<span class="badge" style="background:' . $bg . ';color:' . $fg . '">' . dh($label) . '</span>';
}

/**
 * Run a back office action: success → flash + redirect; refusal
 * (InvalidArgumentException) → error flash + redirect. Keeps every POST
 * handler a one-liner and post/redirect/get.
 */
function daily_action(callable $fn, string $successMessage, string $redirect): never
{
    try {
        $result = $fn();
        flash_set('success', is_string($result) && $result !== '' ? $result : $successMessage);
    } catch (InvalidArgumentException $e) {
        flash_set('error', $e->getMessage());
    }
    admin_redirect($redirect);
}

/** The app's other 18 locales with their names, for the translation forms. */
function daily_locale_names(): array
{
    return [
        'fr' => 'French', 'vi' => 'Vietnamese', 'es' => 'Spanish', 'it' => 'Italian', 'pt-br' => 'Portuguese (Brazil)',
        'pt-pt' => 'Portuguese (Portugal)', 'de' => 'German', 'nl' => 'Dutch', 'zh-hans' => 'Chinese (Simplified)',
        'zh-hant' => 'Chinese (Traditional)', 'ja' => 'Japanese', 'ko' => 'Korean', 'fil' => 'Filipino', 'th' => 'Thai',
        'id' => 'Indonesian', 'hi' => 'Hindi', 'ru' => 'Russian', 'ar' => 'Arabic',
    ];
}

/** Brand-term warnings for a {locale: text} map against its English: "fr: Daily Challenge; vi: Local Twist". */
function daily_brand_warnings(string $english, array $translations): string
{
    $out = [];
    foreach ($translations as $locale => $text) {
        if (!is_string($text) || str_starts_with((string) $locale, '_') || $locale === 'en') continue;
        $missing = DailyI18n::missingBrandTerms($english, $text);
        if ($missing !== []) $out[] = $locale . ': ' . implode(', ', $missing);
    }
    return implode('; ', $out);
}

function daily_subnav(string $current): void
{
    $links = [
        '/admin/daily'         => '📅 Calendar',
        '/admin/daily/today'   => '🔥 Today',
        '/admin/daily/reserve' => '🧺 Reserve',
        '/admin/daily/import'  => '⬆️ Import',
        '/admin/daily/log'     => '📜 Log',
    ];
    echo '<div class="daily-subnav">';
    foreach ($links as $href => $label) {
        echo '<a href="' . $href . '"' . ($current === $href ? ' class="active"' : '') . '>' . $label . '</a>';
    }
    echo '</div>';
}

/** Page-local styles: layout of the Daily pages and the phone rules. */
function daily_styles(): void
{
    echo '<style>
.daily-subnav { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:18px; }
.daily-subnav a { padding:6px 12px; border:1px solid #2a2a2a; border-radius:6px; color:#aaa; font-size:13px; }
.daily-subnav a.active, .daily-subnav a:hover { color:#fff; background:#252525; text-decoration:none; }
.daily-cols { display:grid; grid-template-columns: minmax(0,1fr) 340px; gap:20px; align-items:start; }
.daily-row-empty-soon td { background:#2a1414; }
.daily-muted { color:#777; font-size:12px; }
.daily-counter { font-size:12px; color:#777; text-align:right; margin-top:4px; }
.daily-counter.near { color:#FF7A3C; } .daily-counter.over { color:#f87171; font-weight:600; }
.daily-checklist label { display:flex; gap:8px; align-items:flex-start; padding:4px 0; color:#ccc; font-size:13px; }
.daily-preview-card { background:#1f1410; border:1px solid #FF7A3C55; border-radius:14px; padding:14px; margin-bottom:14px; }
.daily-preview-card .kicker { color:#FF7A3C; font-size:11px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; }
.daily-preview-card .text { color:#fff; font-size:16px; font-weight:600; margin:6px 0; }
.daily-preview-card .context { color:#bbb; font-size:13px; }
.daily-preview-card .twist { margin-top:10px; padding:8px 10px; background:#2a1a12; border-radius:8px; color:#ffd2bd; font-size:13px; }
.daily-preview-card .cta { margin-top:12px; background:#FF7A3C; color:#111; text-align:center; font-weight:700; border-radius:10px; padding:9px; }
.daily-preview-push { background:#2c2c2e; border-radius:16px; padding:10px 12px; display:flex; gap:10px; }
.daily-preview-push .icon { width:34px; height:34px; border-radius:8px; background:#FF7A3C; color:#111; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.daily-preview-push .title { color:#fff; font-weight:600; font-size:13px; }
.daily-preview-push .body { color:#ddd; font-size:13px; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; }
.daily-thumb { width:72px; height:72px; object-fit:cover; border-radius:6px; background:#222; }
.daily-inline { display:inline-flex; gap:6px; align-items:center; flex-wrap:wrap; }
.daily-inline input[type=text], .daily-inline input[type=date] { background:#111; border:1px solid #333; color:#eee; padding:6px 8px; border-radius:5px; font-size:13px; }
.daily-twist { border-top:1px solid #222; padding:12px 0; }
.daily-tr { width:100%; border-collapse:collapse; }
.daily-tr td { padding:4px 4px; vertical-align:top; border-top:1px solid #222; }
.daily-tr td.lang { width:130px; color:#aaa; font-size:12px; padding-top:10px; }
.daily-tr textarea, .daily-tr input[type=text] { width:100%; background:#111; border:1px solid #333; color:#eee; padding:6px 8px; border-radius:5px; font-size:13px; font-family:inherit; }
.daily-tr .missing { color:#f87171; font-size:11px; }
@media (max-width: 720px) {
  .admin-header { overflow-x: auto; }
  .admin-header nav { flex-wrap: nowrap; }
  .daily-cols { grid-template-columns: 1fr; }
  .daily-stack tr { display: block; border-bottom: 1px solid #222; padding: 6px 0; }
  .daily-stack td { display: block; width: 100%; min-width: 0 !important; }
  .daily-stack .daily-inline input[type=text] { flex: 1 1 100%; }
  .form-card { max-width: 100%; }
  .admin-main { padding: 16px 12px; }
  .btn, .btn-sm, button { min-height: 40px; }
  .daily-inline input[type=text] { width: 100%; }
}
</style>';
}
