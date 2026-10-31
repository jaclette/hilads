<?php

declare(strict_types=1);

/**
 * Renders a "Different Worlds" package file to PNGs, without the database or
 * R2: to check a prepared package before importing it in Admin › Worlds.
 * Needs rsvg-convert and the fonts (the API Docker image has both):
 *
 *   php scripts/dw_render.php docs/worlds/2026-10-31.json /tmp/out [Vietnam]
 *
 * Accepts the import formats ({"packages": [...]}, one {date, content}, a bare content).
 */

require_once __DIR__ . '/../src/DwSeed.php';
require_once __DIR__ . '/../src/DwSlides.php';
require_once __DIR__ . '/../src/DwStudio.php';

[$file, $out] = [$argv[1] ?? '', $argv[2] ?? ''];
$always = isset($argv[3]) ? array_map('trim', explode(',', $argv[3])) : ['Vietnam'];
if ($file === '' || $out === '') {
    fwrite(STDERR, "usage: php scripts/dw_render.php <package.json> <out dir> [always,countries]\n");
    exit(2);
}
$doc = json_decode((string) file_get_contents($file), true);
if (!is_array($doc)) {
    fwrite(STDERR, "not JSON: {$file}\n");
    exit(1);
}
$items = isset($doc['packages']) ? $doc['packages'] : (isset($doc['content']) ? [$doc] : [['content' => $doc]]);
$failed = false;
foreach ($items as $item) {
    $date = (string) ($item['date'] ?? 'package');
    [$errors, $warnings] = DwStudio::validate($item['content'] ?? [], $always);
    foreach ($errors as $e) { echo "{$date} ERROR {$e}\n"; }
    foreach ($warnings as $w) { echo "{$date} warn  {$w}\n"; }
    if ($errors !== []) { $failed = true; continue; }
    [$content, $svgs] = DwStudio::splitSvgs($item['content']);
    $dir = rtrim($out, '/') . '/' . $date;
    @mkdir($dir, 0777, true);
    foreach (DwStudio::slidePlan($content) as $slide) {
        $photo = null;
        if ($slide['photo_src'] !== '') {
            try {
                $photo = DwStudio::fetchPhoto($slide['photo_src']);
            } catch (Throwable $e) {
                echo "{$date} warn  slide {$slide['position']}: photo not used ({$e->getMessage()})\n";
            }
        }
        $raw = $svgs[$slide['position']] ?? null;
        $clean = $photo === null && is_string($raw) ? DwSlides::sanitizeSvg($raw) : null;
        if ($photo === null && $clean === null) { echo "{$date} warn  slide {$slide['position']}: no picture, plain background\n"; }
        $name = DwSlides::fileName($slide['position'], $slide['kind'], $slide['country'] ?? null);
        file_put_contents("{$dir}/{$name}", DwSlides::toPng(DwSlides::compose($slide, $clean, $photo)));
        echo "{$date} ok    {$dir}/{$name}\n";
    }
}
exit($failed ? 1 : 0);
