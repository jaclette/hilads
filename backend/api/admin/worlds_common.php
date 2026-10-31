<?php

declare(strict_types=1);

// Shared bits of the "Different Worlds" pages (Admin › Worlds): escaping,
// the subnav, the status badge and the page styles.

function wh(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

function worlds_subnav(string $current): void
{
    $links = ['/admin/worlds' => '📅 Calendar', '/admin/worlds/settings' => '⚙️ Settings'];
    echo '<div class="worlds-subnav">';
    foreach ($links as $href => $label) {
        echo '<a href="' . $href . '"' . ($current === $href ? ' class="active"' : '') . '>' . $label . '</a>';
    }
    echo '</div>';
}

function worlds_status_badge(string $status): string
{
    $colors = ['planned' => ['#252525', '#aaa'], 'generated' => ['rgba(96,165,250,0.12)', '#60a5fa'],
               'ready' => ['rgba(251,191,36,0.12)', '#fbbf24'], 'published' => ['rgba(34,197,94,0.12)', '#4ade80']];
    [$bg, $fg] = $colors[$status] ?? $colors['planned'];
    return '<span class="badge" style="background:' . $bg . ';color:' . $fg . '">' . wh($status) . '</span>';
}

/** Runs a POST action, flashes its result and redirects (errors stay on the page). */
function worlds_action(callable $fn, string $success, string $back): never
{
    try {
        $msg = $fn();
        flash_set('success', is_string($msg) ? $msg : $success);
    } catch (InvalidArgumentException | RuntimeException $e) {
        flash_set('error', $e->getMessage());
    }
    admin_redirect($back);
}

function worlds_styles(): void
{
    echo '<style>
.worlds-subnav { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:18px; }
.worlds-subnav a { padding:6px 12px; border:1px solid #2a2a2a; border-radius:6px; color:#aaa; font-size:13px; }
.worlds-subnav a.active { color:#fff; background:#252525; }
.worlds-muted { color:#888; font-size:13px; }
.worlds-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; margin-bottom:18px; }
.worlds-grid .form-card { max-width:none; }
.worlds-today td { background:rgba(255,122,60,0.08); }
.worlds-strip { display:flex; gap:12px; overflow-x:auto; padding-bottom:10px; margin-bottom:18px; }
.worlds-slide { flex:0 0 180px; }
.worlds-slide img { width:180px; height:320px; object-fit:cover; border-radius:10px; background:#222; display:block; }
.worlds-slide .worlds-muted { margin:4px 0; font-size:12px; }
.worlds-slide details summary { cursor:pointer; color:#FF7A3C; font-size:12px; }
.worlds-slide textarea { width:180px; height:90px; font:11px monospace; background:#111; color:#ddd; border:1px solid #333; border-radius:6px; }
.worlds-field { border-top:1px solid #222; padding:10px 0; }
.worlds-field label { display:flex; justify-content:space-between; align-items:center; gap:8px; color:#999; font-size:12px; margin-bottom:4px; }
.worlds-field textarea, .worlds-field input { width:100%; background:#111; border:1px solid #333; color:#eee; padding:8px; border-radius:6px; font-family:system-ui, -apple-system, sans-serif; font-size:14px; line-height:1.45; }
.worlds-field textarea { min-height:40px; resize:vertical; overflow:hidden; }
.worlds-field .saved { color:#4ade80; font-size:12px; }
.worlds-field .failed { color:#f87171; font-size:12px; }
.worlds-country { background:#151515; border:1px solid #262626; border-radius:10px; padding:12px 14px; margin-bottom:12px; }
.worlds-country h4 { margin-bottom:4px; }
.worlds-warn { background:#2a1f0a; border:1px solid #6b4e12; color:#fbbf24; border-radius:8px; padding:10px 14px; margin-bottom:14px; }
.worlds-report li { margin:2px 0 2px 18px; }
@media (max-width: 700px) { .worlds-grid { grid-template-columns:1fr; } }
</style>';
}
