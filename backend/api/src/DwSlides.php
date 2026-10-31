<?php

declare(strict_types=1);

/**
 * "Different Worlds by Hilads" slides: one 1080x1920 PNG per slide (hook, one
 * per country, outro), always the same layout so the series is recognisable.
 *
 *   0-1080      the 1080x1080 illustration (TikTok's top bar only covers picture)
 *   ~1000       "DIFFERENT WORLDS by Hilads" pill over the illustration
 *   1120-1560   the text: 72 px left margin, 170 px right (the app's side buttons)
 *   1560-1920   empty (caption and buttons of TikTok / Reels / Shorts)
 *
 * The picture is a real photo (cropped to a square by squarePhoto(), its credit
 * under the pill) or, for older packages, a drawn SVG illustration.
 * The slide is built as one SVG (picture nested, Be Vietnam Pro text, a
 * Twemoji flag) and converted with rsvg-convert (librsvg, in the Dockerfile).
 * Lines are broken here with GD measuring the same TTF, since SVG text never wraps.
 * Pure apart from toPng(): DwStudio stores and uploads.
 */
final class DwSlides
{
    public const W = 1080;
    public const H = 1920;

    private const BG     = '#16110D';
    private const TEXT   = '#FFFFFF';
    private const ACCENT = '#FF7A3D';
    private const GOLD   = '#D9AE52';
    private const LEFT   = 72;
    private const RIGHT  = 170;
    private const BOTTOM = 1560;
    private const MAX_SVG_BYTES = 400_000;

    /** Background colours of an illustration that failed (a plain slide, still on brand). */
    private const FALLBACK = ['hook' => ['#FF7A3D', '#D9622A'], 'country' => ['#D9AE52', '#C98A45'], 'outro' => ['#D9622A', '#3A2216']];

    public static function font(string $weight = 'ExtraBold'): string
    {
        return __DIR__ . '/../assets/fonts/BeVietnamPro-' . $weight . '.ttf';
    }

    /**
     * A generated illustration made safe to render: an <svg> root with a viewBox,
     * nothing that loads a file or a URL (scripts, images, foreignObject, external
     * hrefs, url() outside the document, @import), no text. Null if it is not usable.
     */
    public static function sanitizeSvg(string $svg): ?string
    {
        $svg = trim($svg);
        if (preg_match('/```(?:svg|xml)?\s*(.*?)```/s', $svg, $m)) {
            $svg = trim($m[1]);
        }
        $start = stripos($svg, '<svg');
        $end   = strripos($svg, '</svg>');
        if ($start === false || $end === false || strlen($svg) > self::MAX_SVG_BYTES) {
            return null;
        }
        $svg = substr($svg, $start, $end - $start + 6);
        if (stripos($svg, '<!DOCTYPE') !== false || stripos($svg, '<!ENTITY') !== false) {
            return null;
        }
        $doc = new DOMDocument();
        $prev = libxml_use_internal_errors(true);
        $ok = $doc->loadXML($svg, LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        $root = $ok ? $doc->documentElement : null;
        if ($root === null || strtolower($root->localName) !== 'svg') {
            return null;
        }

        $banned = ['script', 'foreignobject', 'image', 'feimage', 'iframe', 'object', 'embed', 'audio', 'video',
                   'a', 'text', 'tspan', 'textpath', 'font', 'font-face', 'animate', 'animatetransform', 'animatemotion', 'set'];
        $remove = [];
        foreach ($doc->getElementsByTagName('*') as $el) {
            $name = strtolower($el->localName);
            if (in_array($name, $banned, true)) {
                $remove[] = $el;
                continue;
            }
            if ($name === 'style' && preg_match('/@import|url\(\s*[\'"]?(?!#)/i', $el->textContent)) {
                $remove[] = $el;
                continue;
            }
            $drop = [];
            foreach ($el->attributes as $attr) {
                $an = strtolower($attr->localName);
                $v  = $attr->value;
                if (str_starts_with($an, 'on')
                    || (($an === 'href') && !str_starts_with(trim($v), '#'))
                    || preg_match('/url\(\s*[\'"]?(?!#)/i', $v)) {
                    $drop[] = $attr;
                }
            }
            foreach ($drop as $attr) {
                $el->removeAttributeNode($attr);
            }
        }
        foreach ($remove as $el) {
            $el->parentNode?->removeChild($el);
        }

        if (!$root->hasAttribute('viewBox')) {
            $w = (float) ($root->getAttribute('width') ?: 1080);
            $h = (float) ($root->getAttribute('height') ?: 1080);
            $root->setAttribute('viewBox', '0 0 ' . ($w ?: 1080) . ' ' . ($h ?: 1080));
        }
        foreach (['width', 'height', 'x', 'y'] as $a) {
            $root->removeAttribute($a);
        }
        if (!$root->hasAttribute('xmlns')) {
            $root->setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }
        return $doc->saveXML($root) ?: null;
    }

    /**
     * A photo as the slide's 1080x1080 JPEG: centre crop to a square, resized.
     * Throws InvalidArgumentException when the bytes are not a usable photo.
     */
    public static function squarePhoto(string $bytes): string
    {
        $info = @getimagesizefromstring($bytes);
        if ($info === false || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP], true)) {
            throw new InvalidArgumentException('not a JPEG, PNG or WebP photo');
        }
        [$w, $h] = $info;
        if ($w * $h > 40_000_000) {
            throw new InvalidArgumentException("the photo is too big ({$w}x{$h}), use a smaller version");
        }
        if (min($w, $h) < 600) {
            throw new InvalidArgumentException("the photo is too small ({$w}x{$h}), 1080 px or more is needed");
        }
        $src = @imagecreatefromstring($bytes);
        if ($src === false) {
            throw new InvalidArgumentException('the photo could not be read');
        }
        $side = min($w, $h);
        $dst = imagecreatetruecolor(self::W, self::W);
        imagecopyresampled($dst, $src, 0, 0, intdiv($w - $side, 2), intdiv($h - $side, 2), self::W, self::W, $side, $side);
        ob_start();
        imagejpeg($dst, null, 88);
        return (string) ob_get_clean();
    }

    /** Path of the Twemoji SVG for a flag emoji (🇻🇳, 🏴󠁧󠁢󠁥󠁮󠁧󠁿), or null. */
    public static function flagFile(string $flag): ?string
    {
        $cps = [];
        foreach (mb_str_split(trim($flag)) as $ch) {
            $cp = mb_ord($ch);
            if ($cp !== 0xFE0F) {
                $cps[] = dechex($cp);
            }
        }
        if ($cps === []) {
            return null;
        }
        $file = __DIR__ . '/../assets/flags/' . implode('-', $cps) . '.svg';
        return is_file($file) ? $file : null;
    }

    /** Text as it can be drawn: no emoji (no emoji font in the renderer), one line of spaces. */
    public static function plain(string $text): string
    {
        $text = preg_replace('/[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}\x{200D}\x{E0020}-\x{E007F}]/u', '', $text) ?? $text;
        return trim(preg_replace('/\s+/u', ' ', $text) ?? $text);
    }

    /** Width in px of a line set in $px pixels (GD sizes are points at 96 dpi). */
    public static function measure(string $text, int $px, string $font): float
    {
        $box = imagettfbbox($px * 0.75, 0, $font, $text);
        return $box === false ? mb_strlen($text) * $px * 0.6 : (float) ($box[2] - $box[0]);
    }

    /** Lines of $text, greedy, each at most $width px wide (a longer single word gets its own line). */
    public static function wrap(string $text, int $px, float $width, string $font): array
    {
        $lines = [];
        $line  = '';
        foreach (preg_split('/\s+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY) as $word) {
            $try = $line === '' ? $word : $line . ' ' . $word;
            if ($line !== '' && self::measure($try, $px, $font) > $width) {
                $lines[] = $line;
                $line = $word;
            } else {
                $line = $try;
            }
        }
        if ($line !== '') {
            $lines[] = $line;
        }
        return $lines;
    }

    /**
     * The biggest size from $max down to $min (step 4) at which $text fits in
     * $maxLines lines of $width px. [px, lines]; at $min it may still overflow.
     */
    public static function fit(string $text, int $max, int $min, float $width, int $maxLines, string $font): array
    {
        for ($px = $max; $px > $min; $px -= 4) {
            $lines = self::wrap($text, $px, $width, $font);
            if (count($lines) <= $maxLines && max(array_map(static fn($l) => self::measure($l, $px, $font), $lines ?: [''])) <= $width) {
                return [$px, $lines];
            }
        }
        return [$min, self::wrap($text, $min, $width, $font)];
    }

    /**
     * The slide as SVG. $slide = {kind: hook|country|outro, text, country?, flag?, credit?},
     * $photo = squarePhoto() JPEG bytes, else $illustration = a sanitizeSvg()
     * result, else (both null) the plain fallback.
     */
    public static function compose(array $slide, ?string $illustration, ?string $photo = null): string
    {
        $kind  = (string) ($slide['kind'] ?? 'country');
        $text  = self::plain((string) ($slide['text'] ?? ''));
        $width = self::W - self::LEFT - self::RIGHT;
        $x     = self::LEFT;
        $o     = [];

        $o[] = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">';
        $o[] = '<defs><linearGradient id="dwFade" x1="0" y1="0" x2="0" y2="1">'
             . '<stop offset="0" stop-color="' . self::BG . '" stop-opacity="0"/><stop offset="1" stop-color="' . self::BG . '" stop-opacity="1"/></linearGradient>';
        [$c1, $c2] = self::FALLBACK[$kind] ?? self::FALLBACK['country'];
        $o[] = '<linearGradient id="dwPlain" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' . $c1 . '"/><stop offset="1" stop-color="' . $c2 . '"/></linearGradient></defs>';
        $o[] = '<rect width="1080" height="1920" fill="' . self::BG . '"/>';

        if ($photo !== null) {
            $o[] = '<image x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice" href="data:image/jpeg;base64,' . base64_encode($photo) . '"/>';
        } elseif ($illustration !== null) {
            $o[] = preg_replace('/^<svg\b/', '<svg x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"', $illustration, 1);
        } else {
            $o[] = '<rect width="1080" height="1080" fill="url(#dwPlain)"/>'
                 . '<circle cx="840" cy="260" r="190" fill="#FFFFFF" fill-opacity="0.14"/>'
                 . '<circle cx="230" cy="760" r="270" fill="#FFFFFF" fill-opacity="0.10"/>';
        }
        $o[] = '<rect y="930" width="1080" height="152" fill="url(#dwFade)"/>';

        // The series mark, on every slide.
        $bold = self::font('ExtraBold');
        $semi = self::font('SemiBold');
        $a = 'DIFFERENT WORLDS';
        $b = 'by Hilads';
        $wa = self::measure($a, 24, $bold) + strlen($a) * 2;    // + letter-spacing 2
        $wb = self::measure($b, 24, $semi);
        $pill = 28 + $wa + 12 + $wb + 28;
        $o[] = '<rect x="' . $x . '" y="996" width="' . round($pill) . '" height="56" rx="28" fill="' . self::BG . '" fill-opacity="0.9"/>';
        $o[] = '<text x="' . ($x + 28) . '" y="1033" font-family="Be Vietnam Pro" font-weight="800" font-size="24" letter-spacing="2" fill="' . self::ACCENT . '">' . self::esc($a) . '</text>';
        $o[] = '<text x="' . round($x + 28 + $wa + 12) . '" y="1033" font-family="Be Vietnam Pro" font-weight="600" font-size="24" fill="' . self::TEXT . '">' . self::esc($b) . '</text>';

        $credit = self::plain((string) ($slide['credit'] ?? ''));
        if ($credit !== '' && ($photo !== null || $illustration !== null)) {
            [, $cl] = self::fit($credit, 18, 14, $width, 1, $semi);
            $o[] = '<text x="' . $x . '" y="1090" font-family="Be Vietnam Pro" font-weight="600" font-size="' . (self::measure($credit, 18, $semi) <= $width ? 18 : 14)
                 . '" fill="#FFFFFF" fill-opacity="0.55">' . self::esc($cl[0] ?? $credit) . '</text>';
        }
        $o[] = '<rect x="' . $x . '" y="1120" width="88" height="8" rx="4" fill="' . self::ACCENT . '"/>';

        if ($kind === 'country') {
            $top = 1160;
            $flagFile = self::flagFile((string) ($slide['flag'] ?? ''));
            $nameX = $x;
            if ($flagFile !== null) {
                $flag = (string) file_get_contents($flagFile);
                $o[] = preg_replace('/^<svg\b/', '<svg x="' . $x . '" y="' . $top . '" width="76" height="76"', trim($flag), 1);
                $nameX = $x + 96;
            }
            $name = self::plain((string) ($slide['country'] ?? ''));
            [$npx, $nlines] = self::fit($name, 56, 36, $width - ($nameX - $x), 1, self::font('Bold'));
            $o[] = '<text x="' . $nameX . '" y="' . ($top + 38 + round($npx * 0.36)) . '" font-family="Be Vietnam Pro" font-weight="700" font-size="' . $npx . '" fill="' . self::GOLD . '">' . self::esc($nlines[0] ?? $name) . '</text>';
            $o[] = self::block($text, $x, 1276, $width, 96, 48);
        } elseif ($kind === 'outro') {
            $o[] = '<text x="' . $x . '" y="1196" font-family="Be Vietnam Pro" font-weight="800" font-size="34" letter-spacing="3" fill="' . self::ACCENT . '">YOUR TURN</text>';
            $o[] = self::block($text, $x, 1226, $width, 104, 52);
        } else {
            $o[] = self::block($text, $x, 1164, $width, 112, 56);
        }

        $o[] = '</svg>';
        return implode("\n", $o);
    }

    /** A wrapped text block whose first line's top is $top: the biggest size that fits above the bottom safe zone. */
    private static function block(string $text, int $x, int $top, int $width, int $max, int $min): string
    {
        $font = self::font('ExtraBold');
        $lines = [];
        for ($px = $max; $px >= $min; $px -= 4) {
            $lines = self::wrap($text, $px, $width, $font);
            $height = $px * 0.95 + (count($lines) - 1) * $px * 1.16;
            $widest = max(array_map(static fn($l) => self::measure($l, $px, $font), $lines ?: ['']));
            if ($top + $height <= self::BOTTOM && $widest <= $width) {
                break;
            }
        }
        $px = max($px, $min);
        $out = '<text font-family="Be Vietnam Pro" font-weight="800" font-size="' . $px . '" fill="' . self::TEXT . '">';
        foreach ($lines as $i => $line) {
            $out .= '<tspan x="' . $x . '" y="' . round($top + $px * 0.95 + $i * $px * 1.16) . '">' . self::esc($line) . '</tspan>';
        }
        return $out . '</text>';
    }

    private static function esc(string $s): string
    {
        return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }

    /** PNG bytes of a composed slide (rsvg-convert, 30 s at most). */
    public static function toPng(string $svg): string
    {
        $cmd = ['rsvg-convert', '--format=png', '--width=1080', '--height=1920'];
        if (is_executable('/usr/bin/timeout')) {
            array_unshift($cmd, '/usr/bin/timeout', '30');
        }
        $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($proc)) {
            throw new RuntimeException('rsvg-convert could not start');
        }
        fwrite($pipes[0], $svg);
        fclose($pipes[0]);
        $png = stream_get_contents($pipes[1]);
        $err = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $code = proc_close($proc);
        if ($code !== 0 || !is_string($png) || !str_starts_with($png, "\x89PNG")) {
            throw new RuntimeException('rsvg-convert failed (' . $code . '): ' . trim((string) $err));
        }
        return $png;
    }

    /** ZIP / file name of a slide: 01_hook.png, 02_vietnam.png, …, 09_outro.png. */
    public static function fileName(int $position, string $kind, ?string $country): string
    {
        $slug = $kind === 'country' ? self::slug((string) $country) : $kind;
        return sprintf('%02d_%s.png', $position, $slug !== '' ? $slug : 'slide');
    }

    public static function slug(string $s): string
    {
        if (class_exists('Normalizer')) {
            $t = preg_replace('/\p{Mn}+/u', '', (string) Normalizer::normalize($s, Normalizer::FORM_D)) ?? $s;
        } else {
            $t = strtr($s, ['á' => 'a', 'à' => 'a', 'â' => 'a', 'ä' => 'a', 'ã' => 'a', 'å' => 'a', 'ç' => 'c', 'é' => 'e', 'è' => 'e',
                'ê' => 'e', 'ë' => 'e', 'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i', 'ñ' => 'n', 'ó' => 'o', 'ò' => 'o', 'ô' => 'o',
                'ö' => 'o', 'õ' => 'o', 'ø' => 'o', 'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ý' => 'y', 'ÿ' => 'y',
                'Á' => 'A', 'É' => 'E', 'Í' => 'I', 'Ó' => 'O', 'Ú' => 'U', 'Ü' => 'U', 'Ö' => 'O', 'Ç' => 'C', 'Ñ' => 'N', 'Ô' => 'O']);
        }
        return trim((string) preg_replace('/[^a-z0-9]+/', '_', strtolower($t)), '_');
    }
}
