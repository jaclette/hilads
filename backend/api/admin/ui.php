<?php

declare(strict_types=1);

/**
 * Small building blocks for back office pages (admin/assets/admin.css has the look):
 * page header, tabs, help panel, empty state, pager, relative time. Plain functions that return
 * HTML strings, so a page stays a readable template.
 */

function ui_e(mixed $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES);
}

/** Page header: breadcrumb group, title, one-line description, actions on the right (HTML). */
function ui_page_head(string $group, string $title, string $sub = '', string $actions = ''): string
{
    return '<div class="page-head"><div>'
         . ($group !== '' ? '<div class="crumbs">' . ui_e($group) . ' ›</div>' : '')
         . '<h1 class="page-title">' . ui_e($title) . '</h1>'
         . ($sub !== '' ? '<p class="sub">' . $sub . '</p>' : '')
         . '</div>' . ($actions !== '' ? '<div class="head-actions">' . $actions . '</div>' : '') . '</div>';
}

/** Segmented tabs: [[label, href, count|null, current bool], …]. */
function ui_tabs(array $tabs, string $label = 'View'): string
{
    $h = '<nav class="seg" aria-label="' . ui_e($label) . '">';
    foreach ($tabs as [$text, $href, $count, $current]) {
        $h .= '<a href="' . ui_e($href) . '"' . ($current ? ' aria-current="page"' : '') . '>' . ui_e($text)
            . ($count !== null ? ' <span class="c">' . number_format((int) $count) . '</span>' : '') . '</a>';
    }
    return $h . '</nav>';
}

/** "How this works" panel: a button in the header that opens a short explanation. */
function ui_help(string $title, string $html): string
{
    return '<details class="help"><summary class="btn">' . ui_e($title) . '</summary><div class="help-body card">' . $html . '</div></details>';
}

function ui_empty(string $title, string $text = ''): string
{
    return '<div class="empty"><b>' . ui_e($title) . '</b>' . ui_e($text) . '</div>';
}

/** Newer / older pager with "from–to of total". */
function ui_pager(int $page, int $perPage, int $total, callable $href): string
{
    if ($total === 0) return '';
    $from = ($page - 1) * $perPage + 1;
    $to   = min($total, $page * $perPage);
    $h = '<div class="pager"><span>' . number_format($from) . '–' . number_format($to) . ' of ' . number_format($total) . '</span><span class="spacer"></span>';
    if ($page > 1) $h .= '<a class="btn btn-sm" href="' . ui_e($href($page - 1)) . '">Newer</a>';
    if ($to < $total) $h .= '<a class="btn btn-sm" href="' . ui_e($href($page + 1)) . '">Older</a>';
    return $h . '</div>';
}

/** "5 min ago", "3 h ago", "yesterday", else the date (Saigon time). */
function ui_ago(int|string|null $ts): string
{
    if ($ts === null || $ts === '') return '';
    $t = is_int($ts) || ctype_digit((string) $ts) ? (int) $ts : (int) strtotime((string) $ts);
    $s = time() - $t;
    if ($s < 60) return 'just now';
    if ($s < 3600) return intdiv($s, 60) . ' min ago';
    if ($s < 86400) return intdiv($s, 3600) . ' h ago';
    if ($s < 172800) return 'yesterday';
    return date($s < 300 * 86400 ? 'j M' : 'j M Y', $t);
}

/** The exact time for a title attribute. */
function ui_when(int|string|null $ts): string
{
    if ($ts === null || $ts === '') return '';
    $t = is_int($ts) || ctype_digit((string) $ts) ? (int) $ts : (int) strtotime((string) $ts);
    return date('j M Y, H:i', $t) . ' (Saigon)';
}

/** Community › Hi plan & Hi now: one header, two tabs. */
function ui_plans_head(string $current, string $title, string $sub, string $actions = ''): string
{
    return ui_page_head('Community', $title, $sub, $actions)
        . '<div style="margin-bottom:16px">' . ui_tabs([
            ['Hi plan', '/admin/events', null, $current === 'events'],
            ['Hi now', '/admin/topics', null, $current === 'topics'],
        ], 'Kind') . '</div>';
}
