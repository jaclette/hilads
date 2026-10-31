<?php

declare(strict_types=1);

/**
 * "Different Worlds by Hilads" content studio (Admin › Worlds): the editorial
 * calendar (dw_topics), the packages made for a topic (dw_packages, one version
 * per import), their slides (dw_slides, rendered by DwSlides, stored on R2) and
 * the settings row (dw_settings).
 *
 * Packages are prepared outside the API (Claude Code, from the brief this class
 * exports: settings + upcoming topics) and imported as JSON: the content of the
 * system prompt's schema, with an "illustration_svg" next to each
 * "illustration_brief". No AI call happens here.
 */
final class DwStudio
{
    public const STATUSES  = ['planned', 'generated', 'ready', 'published'];
    public const PLATFORMS = ['tiktok', 'instagram', 'youtube'];

    // ── Settings ─────────────────────────────────────────────────────────────

    public static function settings(): array
    {
        $row = Database::pdo()->query("SELECT * FROM dw_settings WHERE id = 1")->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            $row = ['system_prompt' => DwSeed::SYSTEM_PROMPT, 'illustration_prompt' => DwSeed::ILLUSTRATION_PROMPT,
                    'visual_style' => DwSeed::VISUAL_STYLE, 'phase' => 1, 'countries_always_included' => '["Vietnam"]'];
        }
        $row['phase'] = (int) $row['phase'];
        $row['countries_always_included'] = json_decode((string) $row['countries_always_included'], true) ?: [];
        return $row;
    }

    public static function saveSettings(string $system, string $illustration, string $style, int $phase, array $countries): void
    {
        if (trim($system) === '' || trim($illustration) === '') {
            throw new InvalidArgumentException('The prompts cannot be empty.');
        }
        if (!in_array($phase, [1, 2, 3], true)) {
            throw new InvalidArgumentException('The phase is 1, 2 or 3.');
        }
        $countries = array_values(array_filter(array_map('trim', $countries), static fn($c) => $c !== ''));
        Database::pdo()->prepare("
            INSERT INTO dw_settings (id, system_prompt, illustration_prompt, visual_style, phase, countries_always_included, updated_at)
            VALUES (1, ?, ?, ?, ?, ?::jsonb, now())
            ON CONFLICT (id) DO UPDATE SET system_prompt = EXCLUDED.system_prompt, illustration_prompt = EXCLUDED.illustration_prompt,
                visual_style = EXCLUDED.visual_style, phase = EXCLUDED.phase,
                countries_always_included = EXCLUDED.countries_always_included, updated_at = now()
        ")->execute([$system, $illustration, trim($style), $phase, json_encode($countries, JSON_UNESCAPED_UNICODE)]);
    }

    /** The system prompt with {{PHASE}} and {{COUNTRIES_ALWAYS}} filled in. */
    public static function systemPrompt(array $s): string
    {
        $countries = $s['countries_always_included'] ?: ['Vietnam'];
        return strtr($s['system_prompt'], ['{{PHASE}}' => (string) $s['phase'], '{{COUNTRIES_ALWAYS}}' => implode(', ', $countries)]);
    }

    /** The illustration prompt for one brief. */
    public static function illustrationPrompt(array $s, string $brief): string
    {
        return strtr($s['illustration_prompt'], ['{{VISUAL_STYLE}}' => $s['visual_style'], '{{BRIEF}}' => $brief]);
    }

    // ── Topics ───────────────────────────────────────────────────────────────

    public static function topicsInMonth(string $month): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT t.*, (SELECT MAX(version) FROM dw_packages p WHERE p.topic_id = t.id) AS versions
            FROM dw_topics t
            WHERE t.date >= ?::date AND t.date < ?::date + INTERVAL '1 month'
            ORDER BY t.date
        ");
        $stmt->execute([$month . '-01', $month . '-01']);
        return array_map([self::class, 'topicRow'], $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    public static function topic(int $id): ?array
    {
        $stmt = Database::pdo()->prepare("SELECT * FROM dw_topics WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row === false ? null : self::topicRow($row);
    }

    public static function topicByDate(string $date): ?array
    {
        $stmt = Database::pdo()->prepare("SELECT * FROM dw_topics WHERE date = ?::date");
        $stmt->execute([$date]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row === false ? null : self::topicRow($row);
    }

    private static function topicRow(array $r): array
    {
        $r['id'] = (int) $r['id'];
        $r['needs_date_check'] = filter_var($r['needs_date_check'], FILTER_VALIDATE_BOOLEAN);
        $r['published_links'] = json_decode((string) ($r['published_links'] ?? '{}'), true) ?: [];
        return $r;
    }

    /** Validated topic fields from a form: [date, title, notes|null, type, needs_date_check]. */
    public static function topicInput(array $in): array
    {
        $date  = trim((string) ($in['date'] ?? ''));
        $title = trim((string) ($in['title'] ?? ''));
        $type  = (string) ($in['type'] ?? 'evergreen');
        if (!DailyClock::isValidDate($date)) {
            throw new InvalidArgumentException('A valid date is needed.');
        }
        if ($title === '' || mb_strlen($title) > 200) {
            throw new InvalidArgumentException('A title of 1 to 200 characters is needed.');
        }
        if (!in_array($type, ['dated', 'evergreen'], true)) {
            throw new InvalidArgumentException('The type is dated or evergreen.');
        }
        $notes = trim((string) ($in['notes'] ?? ''));
        return [$date, $title, $notes === '' ? null : $notes, $type, !empty($in['needs_date_check'])];
    }

    public static function createTopic(array $in): int
    {
        [$date, $title, $notes, $type, $check] = self::topicInput($in);
        if (self::topicByDate($date) !== null) {
            throw new InvalidArgumentException("There is already a topic on {$date}.");
        }
        $stmt = Database::pdo()->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check) VALUES (?, ?, ?, ?, ?) RETURNING id");
        $stmt->execute([$date, $title, $notes, $type, $check ? 'true' : 'false']);
        return (int) $stmt->fetchColumn();
    }

    public static function updateTopic(int $id, array $in): void
    {
        [$date, $title, $notes, $type, $check] = self::topicInput($in);
        $other = self::topicByDate($date);
        if ($other !== null && $other['id'] !== $id) {
            throw new InvalidArgumentException("There is already a topic on {$date}: {$other['title']}.");
        }
        Database::pdo()->prepare("
            UPDATE dw_topics SET date = ?, title = ?, notes = ?, type = ?, needs_date_check = ?, updated_at = now() WHERE id = ?
        ")->execute([$date, $title, $notes, $type, $check ? 'true' : 'false', $id]);
    }

    /** Deletes the topic, its packages and slides, and their files on R2 (best effort). */
    public static function deleteTopic(int $id): void
    {
        $stmt = Database::pdo()->prepare("
            SELECT s.svg_url, s.png_url, s.photo_url, p.video_url FROM dw_slides s JOIN dw_packages p ON p.id = s.package_id WHERE p.topic_id = ?
        ");
        $stmt->execute([$id]);
        $urls = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            array_push($urls, $r['svg_url'], $r['png_url'], $r['photo_url'], $r['video_url']);
        }
        $urls = array_unique(array_filter($urls));
        Database::pdo()->prepare("DELETE FROM dw_topics WHERE id = ?")->execute([$id]);
        foreach (array_filter($urls) as $url) {
            self::deleteFile($url);
        }
    }

    public static function setStatus(int $id, string $status, ?array $links = null): void
    {
        if (!in_array($status, self::STATUSES, true)) {
            throw new InvalidArgumentException('Unknown status.');
        }
        if ($links !== null) {
            $clean = [];
            foreach (self::PLATFORMS as $p) {
                $url = trim((string) ($links[$p] ?? ''));
                if ($url !== '' && !preg_match('#^https?://\S+$#', $url)) {
                    throw new InvalidArgumentException("The {$p} link is not a URL.");
                }
                if ($url !== '') {
                    $clean[$p] = $url;
                }
            }
            Database::pdo()->prepare("UPDATE dw_topics SET status = ?, published_links = ?::jsonb, updated_at = now() WHERE id = ?")
                ->execute([$status, json_encode($clean, JSON_UNESCAPED_SLASHES), $id]);
            return;
        }
        Database::pdo()->prepare("UPDATE dw_topics SET status = ?, updated_at = now() WHERE id = ?")->execute([$status, $id]);
    }

    // ── Brief (what a package is prepared from) ──────────────────────────────

    /** Settings + the topics from today to today + $days, as the file to prepare packages from. */
    public static function brief(int $days = 14): array
    {
        $s = self::settings();
        $stmt = Database::pdo()->prepare("
            SELECT t.date::text AS date, t.title, t.notes, t.type, t.needs_date_check, t.status,
                   (SELECT MAX(version) FROM dw_packages p WHERE p.topic_id = t.id) AS versions
            FROM dw_topics t WHERE t.date BETWEEN ?::date AND ?::date + ?::int ORDER BY t.date
        ");
        $today = DailyClock::currentDate();
        $stmt->execute([$today, $today, $days]);
        $topics = array_map(static fn($r) => [
            'date' => $r['date'], 'title' => $r['title'], 'notes' => $r['notes'], 'type' => $r['type'],
            'needs_date_check' => filter_var($r['needs_date_check'], FILTER_VALIDATE_BOOLEAN),
            'status' => $r['status'], 'versions' => (int) $r['versions'],
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));
        return [
            '_note' => 'Different Worlds by Hilads brief, exported ' . gmdate('Y-m-d H:i') . ' UTC. For each topic, write a package '
                . '(the system prompt\'s JSON, plus "illustration_svg" next to every "illustration_brief", drawn with the illustration '
                . 'prompt) and import it in Admin › Worlds. File: {"packages": [{"date": "YYYY-MM-DD", "model": "...", "content": {...}}]}.',
            'system_prompt'       => self::systemPrompt($s),
            'illustration_prompt' => $s['illustration_prompt'],
            'visual_style'        => $s['visual_style'],
            'phase'               => $s['phase'],
            'countries_always_included' => $s['countries_always_included'],
            'topics'              => $topics,
        ];
    }

    // ── Packages ─────────────────────────────────────────────────────────────

    /** [{id, version, model, created_at}] newest first. */
    public static function versions(int $topicId): array
    {
        $stmt = Database::pdo()->prepare("SELECT id, version, model, created_at FROM dw_packages WHERE topic_id = ? ORDER BY version DESC");
        $stmt->execute([$topicId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** One package (the latest when $version is null) with its decoded content, or null. */
    public static function package(int $topicId, ?int $version = null): ?array
    {
        $sql = "SELECT * FROM dw_packages WHERE topic_id = ?" . ($version !== null ? " AND version = ?" : " ORDER BY version DESC LIMIT 1");
        $stmt = Database::pdo()->prepare($sql);
        $stmt->execute($version !== null ? [$topicId, $version] : [$topicId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row === false ? null : self::packageRow($row);
    }

    public static function packageById(int $id): ?array
    {
        $stmt = Database::pdo()->prepare("SELECT * FROM dw_packages WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row === false ? null : self::packageRow($row);
    }

    private static function packageRow(array $r): array
    {
        $r['id'] = (int) $r['id'];
        $r['topic_id'] = (int) $r['topic_id'];
        $r['version'] = (int) $r['version'];
        $r['content'] = json_decode((string) $r['content'], true) ?: [];
        return $r;
    }

    public static function slides(int $packageId): array
    {
        $stmt = Database::pdo()->prepare("SELECT * FROM dw_slides WHERE package_id = ? ORDER BY position");
        $stmt->execute([$packageId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * The slides a content gives, in order: [{position, kind, text, country?, flag?,
     * brief, credit, photo_src}]. 1 = hook, then one per country, then the outro.
     */
    public static function slidePlan(array $c): array
    {
        $pic = static fn(array $part) => ['brief' => (string) ($part['illustration_brief'] ?? ''),
            'credit' => (string) ($part['photo_credit'] ?? ''), 'photo_src' => (string) ($part['photo_url'] ?? '')];
        $plan = [['position' => 1, 'kind' => 'hook', 'text' => (string) ($c['hook']['on_screen_text'] ?? '')] + $pic($c['hook'] ?? [])];
        foreach (array_values($c['slides'] ?? []) as $i => $s) {
            $plan[] = ['position' => $i + 2, 'kind' => 'country', 'text' => (string) ($s['on_screen_text'] ?? ''),
                       'country' => (string) ($s['country'] ?? ''), 'flag' => (string) ($s['flag'] ?? '')] + $pic($s);
        }
        $plan[] = ['position' => count($plan) + 1, 'kind' => 'outro', 'text' => (string) ($c['outro']['question'] ?? '')] + $pic($c['outro'] ?? []);
        return $plan;
    }

    /** A photo source we fetch: an https file on Wikimedia Commons' upload server. */
    public static function photoSourceOk(string $url): bool
    {
        return (bool) preg_match('#^https://upload\.wikimedia\.org/\S+\.(jpe?g|png|webp)$#i', trim($url));
    }

    public static function words(string $s): int
    {
        return count(preg_split('/\s+/u', trim($s), -1, PREG_SPLIT_NO_EMPTY));
    }

    /**
     * Checks a package content against the system prompt's schema and rules.
     * [errors (block the import), warnings (shown, the package is still saved)].
     */
    public static function validate(array $c, array $alwaysCountries): array
    {
        $errors = [];
        $warn   = [];
        foreach (['topic', 'why_today', 'caption', 'ai_disclosure', 'follow_up_idea'] as $f) {
            if (!is_string($c[$f] ?? null) || trim($c[$f]) === '') {
                $errors[] = "\"{$f}\" is missing.";
            }
        }
        if (!is_string($c['hook']['on_screen_text'] ?? null) || trim($c['hook']['on_screen_text']) === '') {
            $errors[] = 'The hook has no on_screen_text.';
        }
        if (!is_string($c['outro']['question'] ?? null) || trim($c['outro']['question']) === '') {
            $errors[] = 'The outro has no question.';
        }
        $slides = $c['slides'] ?? null;
        if (!is_array($slides) || !array_is_list($slides)) {
            $errors[] = '"slides" must be a list.';
            $slides = [];
        } elseif (count($slides) < 6 || count($slides) > 8) {
            $errors[] = 'There must be 6 to 8 countries (' . count($slides) . ').';
        }
        $countries = [];
        foreach ($slides as $i => $s) {
            $n = $i + 1;
            foreach (['country', 'flag', 'on_screen_text', 'caption_detail', 'source_url'] as $f) {
                if (!is_string($s[$f] ?? null) || trim($s[$f]) === '') {
                    $errors[] = "Country {$n}: \"{$f}\" is missing.";
                }
            }
            if (is_string($s['source_url'] ?? null) && !preg_match('#^https?://\S+$#', trim($s['source_url']))) {
                $errors[] = "Country {$n}: source_url is not a URL.";
            }
            if (is_string($s['flag'] ?? null) && DwSlides::flagFile($s['flag']) === null) {
                $warn[] = "Country {$n}: no flag image for \"{$s['flag']}\" (the slide shows the name only).";
            }
            if (is_string($s['on_screen_text'] ?? null) && self::words($s['on_screen_text']) > 12) {
                $warn[] = "Country {$n} ({$s['country']}): on-screen text is " . self::words($s['on_screen_text']) . ' words (max 12).';
            }
            $countries[] = mb_strtolower(trim((string) ($s['country'] ?? '')));
        }
        foreach ($alwaysCountries as $must) {
            if (!in_array(mb_strtolower(trim($must)), $countries, true)) {
                $errors[] = "{$must} must be one of the countries.";
            }
        }
        if (count($countries) !== count(array_unique($countries))) {
            $errors[] = 'A country appears twice.';
        }
        foreach ([['hook', 'on_screen_text'], ['outro', 'question']] as [$k, $f]) {
            if (is_string($c[$k][$f] ?? null) && self::words($c[$k][$f]) > 12) {
                $warn[] = "The {$k} text is " . self::words($c[$k][$f]) . ' words (max 12).';
            }
        }
        if (is_string($c['caption'] ?? null)) {
            if (self::words($c['caption']) > 150) {
                $warn[] = 'The caption is ' . self::words($c['caption']) . ' words (under 150).';
            }
            if (stripos($c['caption'], 'Different Worlds by Hilads') === false) {
                $warn[] = 'The caption does not mention "Different Worlds by Hilads".';
            }
        }
        $tags = $c['hashtags'] ?? null;
        if (!is_array($tags) || array_filter($tags, static fn($t) => !is_string($t) || trim($t) === '') !== []) {
            $errors[] = '"hashtags" must be a list of strings.';
        } elseif (count($tags) < 5 || count($tags) > 8) {
            $warn[] = count($tags) . ' hashtags (5 to 8).';
        }
        if (isset($c['warnings']) && !is_array($c['warnings'])) {
            $errors[] = '"warnings" must be a list.';
        }
        $parts = [['the hook', $c['hook'] ?? []]];
        foreach ($slides as $i => $s) {
            $parts[] = ['country ' . ($i + 1), is_array($s) ? $s : []];
        }
        $parts[] = ['the outro', $c['outro'] ?? []];
        foreach ($parts as [$label, $part]) {
            $url = is_string($part['photo_url'] ?? null) ? trim($part['photo_url']) : '';
            $credit = is_string($part['photo_credit'] ?? null) ? trim($part['photo_credit']) : '';
            if ($url !== '' && !self::photoSourceOk($url)) {
                $errors[] = ucfirst($label) . ': photo_url must be an image file on https://upload.wikimedia.org.';
            }
            if ($url !== '' && $credit === '') {
                $errors[] = ucfirst($label) . ': the photo needs a photo_credit (author and license).';
            }
            if (mb_strlen($credit) > 90) {
                $warn[] = ucfirst($label) . ': the photo credit is long (' . mb_strlen($credit) . ' characters), it may be cut on the slide.';
            }
            if ($url === '' && empty($part['illustration_svg'])) {
                $warn[] = ucfirst($label) . ': no photo, plain background.';
            }
        }
        return [$errors, $warn];
    }

    /** Removes the illustration_svg fields from a content: [content, svgs by slide position]. */
    public static function splitSvgs(array $c): array
    {
        $svgs = [];
        $svgs[1] = $c['hook']['illustration_svg'] ?? null;
        unset($c['hook']['illustration_svg']);
        foreach (array_keys($c['slides'] ?? []) as $i) {
            $svgs[$i + 2] = $c['slides'][$i]['illustration_svg'] ?? null;
            unset($c['slides'][$i]['illustration_svg']);
        }
        $svgs[count($c['slides'] ?? []) + 2] = $c['outro']['illustration_svg'] ?? null;
        unset($c['outro']['illustration_svg']);
        $c['hashtags'] = array_values(array_map(static fn($t) => '#' . ltrim(trim((string) $t), '#'), $c['hashtags'] ?? []));
        $c['warnings'] = array_values(array_map('strval', $c['warnings'] ?? []));
        return [$c, $svgs];
    }

    /**
     * Imports a file of packages: {"packages": [{date, model?, content}]}, one
     * package {date, model?, content}, or (with $topicId) a bare content.
     * Each package = a new version of its topic, slides rendered and stored.
     * Returns [{date, ok, version?, errors, warnings}].
     */
    public static function import(array $doc, ?int $topicId = null): array
    {
        if (isset($doc['packages']) && is_array($doc['packages'])) {
            $items = $doc['packages'];
        } elseif (isset($doc['content'])) {
            $items = [$doc];
        } else {
            $items = [['content' => $doc]];
        }
        $always = self::settings()['countries_always_included'];
        $report = [];
        foreach ($items as $item) {
            $date = is_array($item) ? (string) ($item['date'] ?? '') : '';
            $topic = $topicId !== null ? self::topic($topicId) : (DailyClock::isValidDate($date) ? self::topicByDate($date) : null);
            $label = $topic['date'] ?? ($date !== '' ? $date : '?');
            if ($topic === null) {
                $report[] = ['date' => $label, 'ok' => false, 'errors' => ['No topic on this date (create it first).'], 'warnings' => []];
                continue;
            }
            if ($topicId !== null && $date !== '' && $date !== $topic['date']) {
                $report[] = ['date' => $label, 'ok' => false, 'errors' => ["This package is for {$date}, not for this topic ({$topic['date']})."], 'warnings' => []];
                continue;
            }
            $content = is_array($item['content'] ?? null) ? $item['content'] : null;
            if ($content === null) {
                $report[] = ['date' => $label, 'ok' => false, 'errors' => ['"content" is missing.'], 'warnings' => []];
                continue;
            }
            [$errors, $warn] = self::validate($content, $always);
            if ($errors !== []) {
                $report[] = ['date' => $label, 'ok' => false, 'errors' => $errors, 'warnings' => $warn];
                continue;
            }
            [$content, $svgs] = self::splitSvgs($content);
            $pdo = Database::pdo();
            $stmt = $pdo->prepare("
                INSERT INTO dw_packages (topic_id, version, content, model)
                VALUES (?, COALESCE((SELECT MAX(version) FROM dw_packages WHERE topic_id = ?), 0) + 1, ?::jsonb, ?)
                RETURNING id, version
            ");
            $stmt->execute([$topic['id'], $topic['id'], json_encode($content, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                            mb_substr(trim((string) ($item['model'] ?? 'Claude Code')), 0, 120)]);
            [$pkgId, $version] = $stmt->fetch(PDO::FETCH_NUM);
            $pkg = self::packageById((int) $pkgId);
            foreach (self::slidePlan($content) as $slide) {
                $svg = is_string($svgs[$slide['position']] ?? null) ? $svgs[$slide['position']] : '';
                $art = ['svg' => $svg];
                if ($slide['photo_src'] !== '') {
                    try {
                        $art = ['photo' => self::fetchPhoto($slide['photo_src'])];
                    } catch (InvalidArgumentException | RuntimeException $e) {
                        $warn[] = "Slide {$slide['position']}: photo not used ({$e->getMessage()}).";
                    }
                }
                $res = self::renderSlide($pkg, $slide, $art);
                if ($res !== null && !str_contains($res, 'no picture')) {
                    $warn[] = $res;
                }
            }
            if ($topic['status'] === 'planned') {
                self::setStatus($topic['id'], 'generated');
            }
            $report[] = ['date' => $label, 'ok' => true, 'version' => (int) $version, 'errors' => [], 'warnings' => $warn];
        }
        return $report;
    }

    /**
     * Composes one slide and stores it (the picture + the PNG on R2, a dw_slides
     * row). $art: ['photo' => squared JPEG bytes], ['svg' => markup, '' = none],
     * or null to keep the stored picture. Returns a warning or null.
     */
    public static function renderSlide(array $pkg, array $slide, ?array $art = null): ?string
    {
        $pos  = (int) $slide['position'];
        $name = DwSlides::fileName($pos, $slide['kind'], $slide['country'] ?? null);
        $stmt = Database::pdo()->prepare("SELECT * FROM dw_slides WHERE package_id = ? AND position = ?");
        $stmt->execute([$pkg['id'], $pos]);
        $old = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;

        $warning  = null;
        $photo    = null;
        $clean    = null;
        $photoUrl = $old['photo_url'] ?? null;
        $svgUrl   = $old['svg_url'] ?? null;
        if ($art === null) {
            // Never redraw without the stored picture: the slide stays as it is.
            $missing = null;
            if ($photoUrl !== null) {
                $photo = self::fetch($photoUrl);
                $missing = $photo === null ? 'photo' : null;
            } elseif ($svgUrl !== null) {
                $clean = DwSlides::sanitizeSvg((string) self::fetch($svgUrl));
                $missing = $clean === null ? 'illustration' : null;
            }
            if ($missing !== null) {
                $error = "the stored {$missing} could not be read, the slide was not redrawn";
                Database::pdo()->prepare("UPDATE dw_slides SET error = ? WHERE id = ?")->execute([$error, $old['id']]);
                return "Slide {$pos}: not saved: {$error}";
            }
        } elseif (isset($art['photo'])) {
            $photo = $art['photo'];
        } else {
            $svg = trim((string) ($art['svg'] ?? ''));
            $clean = $svg === '' ? null : DwSlides::sanitizeSvg($svg);
            if ($svg !== '' && $clean === null) {
                $warning = "Slide {$pos}: the illustration is not a usable SVG, plain background used.";
            }
        }
        if ($photo === null && $clean === null && $warning === null) {
            $warning = "Slide {$pos}: no picture, plain background used.";
        }

        $error = null;
        $pngUrl = $old['png_url'] ?? null;
        try {
            if ($art !== null) {
                $photoUrl = $photo !== null ? self::store($pkg, $name, 'jpg', $photo, 'image/jpeg') : null;
                $svgUrl = $clean !== null ? self::store($pkg, $name, 'svg', $clean, 'image/svg+xml') : null;
            }
            $png = DwSlides::toPng(DwSlides::compose($slide, $clean, $photo));
            $pngUrl = self::store($pkg, $name, 'png', $png, 'image/png');
        } catch (Throwable $e) {
            $error = $e->getMessage();
            $warning = "Slide {$pos}: not saved: {$error}";
            if ($art !== null) {
                [$photoUrl, $svgUrl] = [$old['photo_url'] ?? null, $old['svg_url'] ?? null];
            }
        }

        Database::pdo()->prepare("
            INSERT INTO dw_slides (package_id, position, kind, svg_url, photo_url, png_url, fallback, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (package_id, position) DO UPDATE SET kind = EXCLUDED.kind, svg_url = EXCLUDED.svg_url,
                photo_url = EXCLUDED.photo_url, png_url = EXCLUDED.png_url, fallback = EXCLUDED.fallback, error = EXCLUDED.error
        ")->execute([$pkg['id'], $pos, $slide['kind'], $svgUrl, $photoUrl, $pngUrl,
                     $photoUrl === null && $svgUrl === null ? 'true' : 'false', $error]);

        foreach ([['svg_url', $svgUrl], ['photo_url', $photoUrl], ['png_url', $pngUrl]] as [$col, $now]) {
            if (($old[$col] ?? null) !== null && $old[$col] !== $now) {
                self::deleteFile($old[$col]);
            }
        }
        return $warning;
    }

    /** Text fields that can be edited on a package, and the slide they redraw. */
    public static function editTarget(array $c, string $path): ?array
    {
        $n = count($c['slides'] ?? []);
        if (preg_match('/^(topic|why_today|caption|ai_disclosure|follow_up_idea|hashtags|warnings)$/', $path)) {
            return ['slide' => null];
        }
        $onScreen = ['on_screen_text', 'question', 'country', 'flag', 'photo_credit', 'photo_url'];
        $pic = 'illustration_brief|photo_credit|photo_url';
        if (preg_match("/^hook\\.(on_screen_text|{$pic})$/", $path, $m)) {
            return ['slide' => in_array($m[1], $onScreen, true) ? 1 : null, 'photo' => $m[1] === 'photo_url'];
        }
        if (preg_match("/^outro\\.(question|{$pic})$/", $path, $m)) {
            return ['slide' => in_array($m[1], $onScreen, true) ? $n + 2 : null, 'photo' => $m[1] === 'photo_url'];
        }
        if (preg_match("/^slides\\.(\\d+)\\.(country|flag|on_screen_text|caption_detail|source_url|{$pic})$/", $path, $m)
            && (int) $m[1] < $n) {
            return ['slide' => in_array($m[2], $onScreen, true) ? (int) $m[1] + 2 : null, 'photo' => $m[2] === 'photo_url'];
        }
        return null;
    }

    /** Saves one edited field; redraws its slide when it is on screen. Returns {slide?: {position, png_url}, warning?}. */
    public static function updateField(int $packageId, string $path, string $value): array
    {
        $pkg = self::packageById($packageId);
        if ($pkg === null) {
            throw new InvalidArgumentException('Unknown package.');
        }
        $target = self::editTarget($pkg['content'], $path);
        if ($target === null) {
            throw new InvalidArgumentException('This field cannot be edited.');
        }
        $value = trim(str_replace("\r\n", "\n", $value));
        $art = null;
        if (!empty($target['photo'])) {
            if ($value !== '' && !self::photoSourceOk($value)) {
                throw new InvalidArgumentException('The photo must be an image file on https://upload.wikimedia.org.');
            }
            $art = $value === '' ? ['svg' => ''] : ['photo' => self::fetchPhoto($value)];
        }
        $c = $pkg['content'];
        if ($path === 'hashtags' || $path === 'warnings') {
            $list = array_values(array_filter(array_map('trim', preg_split($path === 'hashtags' ? '/[\s,]+/u' : '/\n+/u', $value)), static fn($v) => $v !== ''));
            $c[$path] = $path === 'hashtags' ? array_map(static fn($t) => '#' . ltrim($t, '#'), $list) : $list;
        } else {
            $ref = &$c;
            foreach (explode('.', $path) as $k) {
                $ref = &$ref[ctype_digit($k) ? (int) $k : $k];
            }
            $ref = $value;
            unset($ref);
        }
        Database::pdo()->prepare("UPDATE dw_packages SET content = ?::jsonb WHERE id = ?")
            ->execute([json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $packageId]);
        $pkg['content'] = $c;

        $out = [];
        if ($target['slide'] !== null) {
            $slide = self::slidePlan($c)[$target['slide'] - 1];
            $warning = self::renderSlide($pkg, $slide, $art);
            $row = array_values(array_filter(self::slides($packageId), static fn($s) => (int) $s['position'] === $target['slide']))[0] ?? null;
            $out['slide'] = ['position' => $target['slide'], 'png_url' => $row['png_url'] ?? null];
            if ($warning !== null && str_contains($warning, 'not saved')) {
                $out['warning'] = $warning;
            }
        }
        return $out;
    }

    /**
     * New picture for one slide: a Commons photo URL, an uploaded photo, or an
     * SVG (all empty = plain background). A credit, when given, replaces the
     * slide's photo_credit. Returns a warning or null.
     */
    public static function replaceArt(int $packageId, int $position, string $photoUrl, ?string $photoBytes, string $svg, string $credit): ?string
    {
        $pkg = self::packageById($packageId);
        $plan = $pkg !== null ? self::slidePlan($pkg['content']) : [];
        if (!isset($plan[$position - 1])) {
            throw new InvalidArgumentException('Unknown slide.');
        }
        $photoUrl = trim($photoUrl);
        if ($photoUrl !== '') {
            if (!self::photoSourceOk($photoUrl)) {
                throw new InvalidArgumentException('The photo must be an image file on https://upload.wikimedia.org.');
            }
            $art = ['photo' => self::fetchPhoto($photoUrl)];
        } elseif ($photoBytes !== null) {
            $art = ['photo' => DwSlides::squarePhoto($photoBytes)];
            $photoUrl = 'uploaded';
        } else {
            $art = ['svg' => $svg];
        }
        if (isset($art['photo']) && trim($credit) === '' && $plan[$position - 1]['credit'] === '') {
            throw new InvalidArgumentException('A photo needs its credit (author and license).');
        }
        $c = $pkg['content'];
        $ref = &self::part($c, $position);
        $ref['photo_url'] = $photoUrl;
        if (trim($credit) !== '' || !isset($art['photo'])) {
            $ref['photo_credit'] = trim($credit);
        }
        unset($ref);
        Database::pdo()->prepare("UPDATE dw_packages SET content = ?::jsonb WHERE id = ?")
            ->execute([json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $packageId]);
        $pkg['content'] = $c;
        return self::renderSlide($pkg, self::slidePlan($c)[$position - 1], $art);
    }

    /** The content part (hook, a country, the outro) of slide $position, by reference. */
    private static function &part(array &$c, int $position): array
    {
        $n = count($c['slides'] ?? []);
        if ($position === 1) {
            return $c['hook'];
        }
        if ($position === $n + 2) {
            return $c['outro'];
        }
        return $c['slides'][$position - 2];
    }

    /** Builds the ZIP of a package's slides (01_hook.png …) in a temp file; returns its path. */
    public static function zip(int $packageId): string
    {
        $pkg = self::packageById($packageId);
        if ($pkg === null) {
            throw new InvalidArgumentException('Unknown package.');
        }
        $plan = self::slidePlan($pkg['content']);
        $path = tempnam(sys_get_temp_dir(), 'dwzip');
        $zip = new ZipArchive();
        if ($zip->open($path, ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Could not create the ZIP.');
        }
        $missing = [];
        foreach (self::slides($packageId) as $s) {
            $p = $plan[(int) $s['position'] - 1] ?? null;
            $bytes = $s['png_url'] ? self::fetch($s['png_url']) : null;
            if ($p !== null && $bytes !== null) {
                $zip->addFromString(DwSlides::fileName((int) $s['position'], $p['kind'], $p['country'] ?? null), $bytes);
            } else {
                $missing[] = (int) $s['position'];
            }
        }
        $count = $zip->numFiles;
        $zip->close();
        if ($count === 0 || $missing !== []) {
            @unlink($path);
            throw new RuntimeException('Could not read slide(s) ' . implode(', ', $missing ?: ['all']) . ' from storage: redraw them, then download again.');
        }
        return $path;
    }

    /** The full caption to paste: caption, hashtags, disclosure. */
    public static function fullCaption(array $c): string
    {
        return trim(trim((string) ($c['caption'] ?? '')) . "\n\n" . implode(' ', $c['hashtags'] ?? [])
            . "\n\n" . trim((string) ($c['ai_disclosure'] ?? '')));
    }

    // ── Video (tools/promo: npm run worlds) ─────────────────────────────────

    /** What the video is made from: the topic, its latest package and slides, or null. */
    public static function videoData(string $date): ?array
    {
        $topic = self::topicByDate($date);
        $pkg = $topic !== null ? self::package($topic['id']) : null;
        if ($pkg === null) {
            return null;
        }
        $slides = [];
        foreach (self::slides($pkg['id']) as $r) {
            $slides[(int) $r['position']] = ['photoUrl' => $r['photo_url'], 'pngUrl' => $r['png_url'], 'svgUrl' => $r['svg_url']];
        }
        $plan = array_map(static fn($p) => $p + ($slides[$p['position']] ?? []), self::slidePlan($pkg['content']));
        return ['date' => $topic['date'], 'title' => $topic['title'], 'version' => $pkg['version'],
                'content' => $pkg['content'], 'slides' => $plan, 'videoUrl' => $pkg['video_url'] ?? null];
    }

    /** A presigned upload for a package's video: {key, putUrl, url}. */
    public static function videoUpload(string $date, int $version): array
    {
        $topic = self::topicByDate($date);
        $pkg = $topic !== null ? self::package($topic['id'], $version) : null;
        if ($pkg === null) {
            throw new InvalidArgumentException('No package ' . $version . ' on ' . $date);
        }
        $key = sprintf('dw/%d/v%d/video-%s.mp4', $topic['id'], $version, bin2hex(random_bytes(6)));
        return ['key' => $key, 'putUrl' => R2Uploader::presignPut($key, 'video/mp4'), 'url' => R2Uploader::publicUrl($key)];
    }

    /** Saves the uploaded video on its package (the previous one is deleted). */
    public static function saveVideo(string $date, int $version, string $url): void
    {
        $topic = self::topicByDate($date);
        $pkg = $topic !== null ? self::package($topic['id'], $version) : null;
        if ($pkg === null) {
            throw new InvalidArgumentException('No package ' . $version . ' on ' . $date);
        }
        $prefix = rtrim((string) getenv('R2_PUBLIC_URL'), '/') . sprintf('/dw/%d/v%d/video-', $topic['id'], $version);
        if (!str_starts_with($url, $prefix) || !str_ends_with($url, '.mp4')) {
            throw new InvalidArgumentException('Not a video upload of this package: ' . $url);
        }
        Database::pdo()->prepare("UPDATE dw_packages SET video_url = ?, video_at = now() WHERE id = ?")->execute([$url, $pkg['id']]);
        if (!empty($pkg['video_url']) && $pkg['video_url'] !== $url) {
            self::deleteFile($pkg['video_url']);
        }
    }

    // ── Files (R2) ───────────────────────────────────────────────────────────

    /** A Commons photo, downloaded and squared for a slide (JPEG bytes). */
    public static function fetchPhoto(string $url): string
    {
        if (!self::photoSourceOk($url)) {
            throw new InvalidArgumentException('not an image file on upload.wikimedia.org');
        }
        $ch = curl_init(trim($url));
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXFILESIZE => 25 * 1024 * 1024, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            // Wikimedia refuses requests without a descriptive User-Agent.
            CURLOPT_USERAGENT => 'HiladsWorlds/1.0 (https://hilads.live; Different Worlds slides)']);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if (!is_string($body) || $code !== 200) {
            throw new RuntimeException("the photo could not be downloaded (HTTP {$code})");
        }
        return DwSlides::squarePhoto($body);
    }

    private static function store(array $pkg, string $name, string $ext, string $bytes, string $mime): string
    {
        $key = sprintf('dw/%d/v%d/%s-%s.%s', $pkg['topic_id'], $pkg['version'], pathinfo($name, PATHINFO_FILENAME), bin2hex(random_bytes(4)), $ext);
        $tmp = tempnam(sys_get_temp_dir(), 'dw');
        file_put_contents($tmp, $bytes);
        try {
            return R2Uploader::put($tmp, $key, $mime);
        } finally {
            @unlink($tmp);
        }
    }

    private static function deleteFile(string $url): void
    {
        $key = self::key($url);
        if ($key !== null) {
            try {
                R2Uploader::delete($key);
            } catch (Throwable $e) {
                error_log('[hilads] dw delete failed: ' . $e->getMessage());
            }
        }
    }

    /** The R2 key of one of our dw/ files, or null. */
    public static function key(string $url): ?string
    {
        $base = rtrim((string) getenv('R2_PUBLIC_URL'), '/') . '/';
        return $base !== '/' && str_starts_with($url, $base . 'dw/') ? substr($url, strlen($base)) : null;
    }

    private static function fetch(string $url): ?string
    {
        if (self::key($url) === null) {
            return null;
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_FOLLOWLOCATION => false]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return is_string($body) && $code === 200 ? $body : null;
    }
}
