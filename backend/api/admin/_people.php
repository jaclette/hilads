<?php

declare(strict_types=1);

/**
 * Shared bits of the people pages (Arrivals, Users, a user's page): the Hilads city name, a
 * country flag, the "where from" cell, and a platform badge.
 *
 * IPs (2026-11-28): every admin sees the country, the approximate city and a short network id
 * (8 characters of the IP's salted hash: the same network across accounts). The full IP is only
 * kept 30 days and only a super admin can open it, through /admin/ip, which writes the audit log.
 */

function people_flag(?string $cc): string
{
    if (!$cc || !preg_match('/^[A-Za-z]{2}$/', $cc)) return '';
    $cc = strtoupper($cc);
    return mb_chr(127397 + ord($cc[0])) . mb_chr(127397 + ord($cc[1]));
}

/** "Saigon" for "Ho Chi Minh City": the name Hilads shows everywhere. Never an internal id. */
function people_city(?string $name): string
{
    if ($name === null || $name === '') return '';
    return class_exists('CityNames') ? CityNames::short($name) : $name;
}

/** A city by its channel id ('city_20'), as [name, country], or ['', null]. */
function people_city_by_id(?string $channelId): array
{
    if (!$channelId || !preg_match('/^city_(\d+)$/', $channelId, $m)) return ['', null];
    $c = CityRepository::findById((int) $m[1]);
    return $c ? [people_city($c['name']), $c['country'] ?? CityRepository::countryOf((int) $m[1])] : ['', null];
}

/**
 * Where a row came from: flag + country, approximate city, network id. $ipRef: [kind, id] of the row
 * holding a full IP (still within 30 days), for the super admin's "Show IP" link.
 */
function people_where(?string $country, ?string $city, ?string $ipHash, ?array $ipRef = null): string
{
    $out = [];
    if ($country) {
        $out[] = '<span style="font-size:15px">' . people_flag($country) . '</span> <span style="font-size:12px;color:var(--faint)">' . ui_e(strtoupper($country)) . '</span>';
    }
    if ($city) $out[] = '<span style="font-size:12px">' . ui_e($city) . '</span>';
    $line = $out ? implode(' · ', $out) : '<span class="faint">–</span>';
    $net = UserSignups::networkId($ipHash);
    if ($net !== null) {
        $line .= '<div class="td-mono" style="font-size:11px;color:var(--muted);margin-top:2px" title="Network id: the same 8 characters on two rows means the same connection (a salted hash of the IP, not the IP)">net ' . ui_e($net) . '</div>';
    }
    if ($ipRef !== null && AdminAuth::isSuper()) {
        $line .= '<a href="/admin/ip?' . http_build_query(['kind' => $ipRef[0], 'id' => $ipRef[1]]) . '" style="font-size:11px" title="Super admins only. Opening it is written to the audit log.">Show IP</a>';
    }
    return $line;
}

function people_platform(?string $p, ?string $version = null): string
{
    $v = $version ? ' <span class="faint">' . ui_e($version) . '</span>' : '';
    return match ($p) {
        'ios'     => '<span style="font-size:12px">🍎 iOS' . $v . '</span>',
        'android' => '<span style="font-size:12px">🤖 Android' . $v . '</span>',
        'web'     => '<span style="font-size:12px">🌐 Web</span>',
        default   => '<span class="faint">–</span>',
    };
}
