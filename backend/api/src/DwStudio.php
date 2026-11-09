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
    /** Countries per video (2026-11-07: 5 to 6, about 35 s, 40 at most). */
    public const MIN_COUNTRIES = 5;
    public const MAX_COUNTRIES = 6;

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
        $row['outro_cta'] = trim((string) ($row['outro_cta'] ?? DwSeed::OUTRO_CTA));
        $row['caption_cta'] = trim((string) ($row['caption_cta'] ?? DwSeed::CAPTION_CTA));
        $row['phase'] = (int) $row['phase'];
        $row['countries_always_included'] = json_decode((string) $row['countries_always_included'], true) ?: [];
        return $row;
    }

    /**
     * Saves the settings. When a hilads.live line changed, the unpublished
     * packages follow (applyCtas). Returns that update's report, or null.
     */
    public static function saveSettings(string $system, string $illustration, string $style, int $phase, array $countries,
                                        string $outroCta, string $captionCta): ?array
    {
        if (trim($system) === '' || trim($illustration) === '') {
            throw new InvalidArgumentException('The prompts cannot be empty.');
        }
        [$outroCta, $captionCta] = [trim($outroCta), trim(str_replace(["\r", "\n"], ' ', $captionCta))];
        if ($outroCta === '' || $captionCta === '' || mb_strlen($outroCta) > 60 || mb_strlen($captionCta) > 120) {
            throw new InvalidArgumentException('The outro line (60 characters at most) and the caption line (120 at most) cannot be empty.');
        }
        $before = self::settings();
        if (!in_array($phase, [1, 2, 3], true)) {
            throw new InvalidArgumentException('The phase is 1, 2 or 3.');
        }
        $countries = array_values(array_filter(array_map('trim', $countries), static fn($c) => $c !== ''));
        Database::pdo()->prepare("
            INSERT INTO dw_settings (id, system_prompt, illustration_prompt, visual_style, phase, countries_always_included, outro_cta, caption_cta, updated_at)
            VALUES (1, ?, ?, ?, ?, ?::jsonb, ?, ?, now())
            ON CONFLICT (id) DO UPDATE SET system_prompt = EXCLUDED.system_prompt, illustration_prompt = EXCLUDED.illustration_prompt,
                visual_style = EXCLUDED.visual_style, phase = EXCLUDED.phase,
                countries_always_included = EXCLUDED.countries_always_included,
                outro_cta = EXCLUDED.outro_cta, caption_cta = EXCLUDED.caption_cta, updated_at = now()
        ")->execute([$system, $illustration, trim($style), $phase, json_encode($countries, JSON_UNESCAPED_UNICODE), $outroCta, $captionCta]);
        if ($outroCta !== $before['outro_cta'] || $captionCta !== $before['caption_cta']) {
            return self::applyCtas($before['caption_cta']);
        }
        return null;
    }

    /**
     * The caption with its required ending: "…\n\n<caption_cta>\n<question>".
     * A question or CTA already at the end (also the previous ones, after an
     * edit) is removed first, so the ending is never doubled. Pure.
     */
    public static function fixCaptionEnding(string $caption, string $cta, string $question, array $previous = []): string
    {
        $body = trim(str_replace("\r\n", "\n", $caption));
        $questions = array_values(array_filter(array_map('trim', [$question, ...($previous['questions'] ?? [])])));
        $ctas = array_values(array_filter(array_map('trim', [$cta, ...($previous['ctas'] ?? [])])));
        // Whole endings only (after a space or a line break), the longest first:
        // a new question "Your city?" must not eat the end of an old "…in your city?".
        $strip = static function (string $text, array $endings): string {
            usort($endings, static fn($a, $b) => mb_strlen($b) <=> mb_strlen($a));
            foreach ($endings as $e) {
                $n = mb_strlen($e);
                $at = mb_strlen($text) - $n;
                if ($e !== '' && $at >= 0 && mb_strtolower(mb_substr($text, $at)) === mb_strtolower($e)
                    && ($at === 0 || preg_match('/\s/u', mb_substr($text, $at - 1, 1)))) {
                    return rtrim(mb_substr($text, 0, $at));
                }
            }
            return $text;
        };
        $body = $strip($body, $questions);
        $body = $strip($body, $ctas);
        $body = $strip($body, $questions);   // a caption written "question, then CTA"
        return ($body !== '' ? $body . "\n\n" : '') . trim($cta) . "\n" . trim($question);
    }

    /**
     * Every package of the topics not published yet: caption ending fixed, outro
     * slide redrawn with the current outro line (its picture is kept).
     * {packages, slides, warnings}.
     */
    public static function applyCtas(?string $previousCaptionCta = null): array
    {
        $s = self::settings();
        $rows = Database::pdo()->query("
            SELECT p.id FROM dw_packages p JOIN dw_topics t ON t.id = p.topic_id
            WHERE t.status <> 'published' ORDER BY t.date, p.version
        ")->fetchAll(PDO::FETCH_COLUMN);
        $report = ['packages' => 0, 'slides' => 0, 'warnings' => []];
        foreach ($rows as $id) {
            $pkg = self::packageById((int) $id);
            $c = $pkg['content'];
            $question = self::question($c);
            $fixed = self::fixCaptionEnding((string) ($c['caption'] ?? ''), $s['caption_cta'], $question,
                ['ctas' => array_filter([$previousCaptionCta, DwSeed::CAPTION_CTA])]);
            if ($fixed !== ($c['caption'] ?? '')) {
                $c['caption'] = $fixed;
                Database::pdo()->prepare("UPDATE dw_packages SET content = ?::jsonb WHERE id = ?")
                    ->execute([json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $pkg['id']]);
                $pkg['content'] = $c;
            }
            $report['packages']++;
            if (DwReaction::isReaction($c)) {
                continue;   // no slides: the screen's line is drawn by the video render
            }
            $plan = self::slidePlan($c);
            $warning = self::renderSlide($pkg, end($plan));
            if ($warning !== null && str_contains($warning, 'not saved')) {
                $report['warnings'][] = "Package {$pkg['id']} (v{$pkg['version']}): {$warning}";
            } else {
                $report['slides']++;
            }
        }
        return $report;
    }

    /** The system prompt with {{PHASE}}, {{COUNTRIES_ALWAYS}} and {{CAPTION_CTA}} filled in. */
    public static function systemPrompt(array $s): string
    {
        $countries = $s['countries_always_included'] ?: ['Vietnam'];
        return strtr($s['system_prompt'], ['{{PHASE}}' => (string) $s['phase'], '{{COUNTRIES_ALWAYS}}' => implode(', ', $countries),
                                           '{{CAPTION_CTA}}' => $s['caption_cta'] ?? DwSeed::CAPTION_CTA]);
    }

    /** The reaction format's prompt (topics whose format is "reaction") with its placeholders filled in. */
    public static function reactionPrompt(array $s): string
    {
        $countries = $s['countries_always_included'] ?: ['Vietnam'];
        return strtr(DwSeed::REACTION_PROMPT, ['{{COUNTRIES_ALWAYS}}' => implode(', ', $countries),
                                               '{{CAPTION_CTA}}' => $s['caption_cta'] ?? DwSeed::CAPTION_CTA]);
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
            SELECT t.*, (SELECT MAX(version) FROM dw_packages p WHERE p.topic_id = t.id) AS versions,
                   -- Video topics: the latest version's content (the admin counts its clips).
                   CASE WHEN t.visual_mode = 'video'
                        THEN (SELECT content FROM dw_packages p WHERE p.topic_id = t.id ORDER BY version DESC LIMIT 1) END AS latest_content
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
        $r['visual_mode'] = ($r['visual_mode'] ?? 'image') === 'video' ? 'video' : 'image';
        $r['format'] = ($r['format'] ?? 'slides') === 'reaction' ? 'reaction' : 'slides';
        if (isset($r['latest_content'])) {
            $plan = self::slidePlan(json_decode((string) $r['latest_content'], true) ?: []);
            $r['clip_count'] = count(array_filter($plan, static fn($p) => $p['clip'] !== null));
            $r['slide_count'] = count($plan);
            unset($r['latest_content']);
        }
        return $r;
    }

    /** Validated topic fields from a form: [date, title, notes|null, type, needs_date_check, visual_mode, format]. */
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
        // image: the photos; video: a stock clip behind each slide of the video (DwClips).
        $mode = ($in['visual_mode'] ?? 'image') === 'video' ? 'video' : 'image';
        // slides: the slides video; reaction: one screen, a reaction clip over a ranking (DwReaction).
        $format = ($in['format'] ?? 'slides') === 'reaction' ? 'reaction' : 'slides';
        return [$date, $title, $notes === '' ? null : $notes, $type, !empty($in['needs_date_check']), $mode, $format];
    }

    public static function createTopic(array $in): int
    {
        [$date, $title, $notes, $type, $check, $mode, $format] = self::topicInput($in);
        if (self::topicByDate($date) !== null) {
            throw new InvalidArgumentException("There is already a topic on {$date}.");
        }
        $stmt = Database::pdo()->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, visual_mode, format) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id");
        $stmt->execute([$date, $title, $notes, $type, $check ? 'true' : 'false', $mode, $format]);
        return (int) $stmt->fetchColumn();
    }

    public static function updateTopic(int $id, array $in): void
    {
        [$date, $title, $notes, $type, $check, $mode, $format] = self::topicInput($in);
        $other = self::topicByDate($date);
        if ($other !== null && $other['id'] !== $id) {
            throw new InvalidArgumentException("There is already a topic on {$date}: {$other['title']}.");
        }
        Database::pdo()->prepare("
            UPDATE dw_topics SET date = ?, title = ?, notes = ?, type = ?, needs_date_check = ?, visual_mode = ?, format = ?, updated_at = now() WHERE id = ?
        ")->execute([$date, $title, $notes, $type, $check ? 'true' : 'false', $mode, $format, $id]);
    }

    /** Deletes the topic, its packages and slides, and their files on R2 (best effort). */
    public static function deleteTopic(int $id): void
    {
        $stmt = Database::pdo()->prepare("
            SELECT s.svg_url, s.png_url, s.photo_url, p.video_url, p.still_url, p.still2_url, p.content->'clip'->>'url' AS clip_url
            FROM dw_packages p LEFT JOIN dw_slides s ON s.package_id = p.id WHERE p.topic_id = ?
        ");
        $stmt->execute([$id]);
        $urls = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            array_push($urls, $r['svg_url'], $r['png_url'], $r['photo_url'], $r['video_url'], $r['still_url'], $r['still2_url'], $r['clip_url']);
        }
        $urls = array_unique(array_filter($urls));
        Database::pdo()->prepare("DELETE FROM dw_topics WHERE id = ?")->execute([$id]);
        foreach (array_filter($urls) as $url) {
            self::deleteFile($url);
        }
    }

    /**
     * Deletes the versions of $packageId's topic older than it, with their slides,
     * photos and video on R2 (best effort): only the latest version is kept.
     * Returns how many versions were deleted.
     */
    public static function pruneOlderVersions(int $packageId): int
    {
        $pkg = self::packageById($packageId);
        if ($pkg === null) {
            return 0;
        }
        $pdo = Database::pdo();
        $stmt = $pdo->prepare("
            SELECT p.id, p.video_url, p.still_url, p.still2_url, p.content->'clip'->>'url' AS clip_url, s.svg_url, s.png_url, s.photo_url
            FROM dw_packages p LEFT JOIN dw_slides s ON s.package_id = p.id
            WHERE p.topic_id = ? AND p.version < ?
        ");
        $stmt->execute([$pkg['topic_id'], $pkg['version']]);
        $ids = [];
        $urls = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $ids[(int) $r['id']] = true;
            array_push($urls, $r['video_url'], $r['still_url'], $r['still2_url'], $r['clip_url'], $r['svg_url'], $r['png_url'], $r['photo_url']);
        }
        if ($ids === []) {
            return 0;
        }
        // A file the kept version still uses (the same R2 clip) stays.
        $urls = array_diff($urls, array_filter([$pkg['video_url'] ?? null, $pkg['still_url'] ?? null, $pkg['still2_url'] ?? null, $pkg['content']['clip']['url'] ?? null]));
        $pdo->prepare("DELETE FROM dw_packages WHERE topic_id = ? AND version < ?")->execute([$pkg['topic_id'], $pkg['version']]);
        foreach (array_unique(array_filter($urls)) as $url) {
            self::deleteFile($url);
        }
        return count($ids);
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
            SELECT t.date::text AS date, t.title, t.notes, t.type, t.needs_date_check, t.status, t.visual_mode, t.format,
                   (SELECT MAX(version) FROM dw_packages p WHERE p.topic_id = t.id) AS versions
            FROM dw_topics t WHERE t.date BETWEEN ?::date AND ?::date + ?::int ORDER BY t.date
        ");
        $today = DailyClock::currentDate();
        $stmt->execute([$today, $today, $days]);
        $topics = array_map(static fn($r) => [
            'date' => $r['date'], 'title' => $r['title'], 'notes' => $r['notes'], 'type' => $r['type'],
            'needs_date_check' => filter_var($r['needs_date_check'], FILTER_VALIDATE_BOOLEAN),
            'status' => $r['status'], 'versions' => (int) $r['versions'],
            // video: also a Commons clip where one fits (the system prompt's clip rule).
            'visual_mode' => $r['visual_mode'] ?? 'image',
            // reaction: one screen, written with reaction_prompt instead of system_prompt.
            'format' => $r['format'] ?? 'slides',
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));
        return [
            '_note' => 'Different Worlds by Hilads brief, exported ' . gmdate('Y-m-d H:i') . ' UTC. For each topic, write a package '
                . '(the system prompt\'s JSON, plus "illustration_svg" next to every "illustration_brief", drawn with the illustration '
                . 'prompt) and import it in Admin › Worlds. File: {"packages": [{"date": "YYYY-MM-DD", "model": "...", "content": {...}}]}.',
            'system_prompt'       => self::systemPrompt($s),
            'reaction_prompt'     => self::reactionPrompt($s),
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
     * The slides a content gives, in order: [{position, kind, text, detail, country?, flag?,
     * brief, credit, photo_src, clip|null}]. 1 = hook, then one per country, then the outro.
     * text = the headline (big), detail = the smaller line under it (the context, the twist,
     * the hook's kicker); older packages give on_screen_text and a country's on_screen_note.
     */
    public static function slidePlan(array $c): array
    {
        $pic = static fn(array $part) => ['brief' => (string) ($part['illustration_brief'] ?? ''),
            'credit' => (string) ($part['photo_credit'] ?? ''), 'photo_src' => (string) ($part['photo_url'] ?? ''),
            'clip' => DwClips::ofPart($part)];
        $plan = [['position' => 1, 'kind' => 'hook', 'text' => self::headline($c['hook'] ?? []), 'detail' => self::detail($c['hook'] ?? [])] + $pic($c['hook'] ?? [])];
        foreach (array_values($c['slides'] ?? []) as $i => $s) {
            $plan[] = ['position' => $i + 2, 'kind' => 'country', 'text' => self::headline($s), 'detail' => self::detail($s),
                       'country' => (string) ($s['country'] ?? ''), 'flag' => (string) ($s['flag'] ?? '')] + $pic($s);
        }
        $plan[] = ['position' => count($plan) + 1, 'kind' => 'outro', 'text' => (string) ($c['outro']['question'] ?? ''), 'detail' => ''] + $pic($c['outro'] ?? []);
        return $plan;
    }

    /** A hook's or a country's big line: its headline, else (older packages) its on_screen_text. */
    public static function headline(array $part): string
    {
        $h = trim((string) ($part['headline'] ?? ''));
        return $h !== '' ? $h : trim((string) ($part['on_screen_text'] ?? ''));
    }

    /** Its smaller line: the detail, else (older packages, a country) its on_screen_note. */
    public static function detail(array $part): string
    {
        return trim((string) (array_key_exists('headline', $part) || array_key_exists('detail', $part) ? ($part['detail'] ?? '') : ($part['on_screen_note'] ?? '')));
    }

    /** Words of an on-screen line, emoji-only tokens left out (the slides don't draw them). */
    public static function screenWords(string $s): int
    {
        return self::words(DwSlides::plain($s));
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
        if (self::headline(is_array($c['hook'] ?? null) ? $c['hook'] : []) === '') {
            $errors[] = 'The hook has no headline.';
        }
        if (!is_string($c['outro']['question'] ?? null) || trim($c['outro']['question']) === '') {
            $errors[] = 'The outro has no question.';
        }
        $slides = $c['slides'] ?? null;
        if (!is_array($slides) || !array_is_list($slides)) {
            $errors[] = '"slides" must be a list.';
            $slides = [];
        } elseif (count($slides) < self::MIN_COUNTRIES || count($slides) > self::MAX_COUNTRIES) {
            $errors[] = 'There must be ' . self::MIN_COUNTRIES . ' to ' . self::MAX_COUNTRIES . ' countries (' . count($slides) . ').';
        }
        $countries = [];
        foreach ($slides as $i => $s) {
            $n = $i + 1;
            foreach (['country', 'flag', 'caption_detail', 'source_url'] as $f) {
                if (!is_string($s[$f] ?? null) || trim($s[$f]) === '') {
                    $errors[] = "Country {$n}: \"{$f}\" is missing.";
                }
            }
            if (self::headline(is_array($s) ? $s : []) === '') {
                $errors[] = "Country {$n}: \"headline\" is missing.";
            }
            if (is_string($s['source_url'] ?? null) && !preg_match('#^https?://\S+$#', trim($s['source_url']))) {
                $errors[] = "Country {$n}: source_url is not a URL.";
            }
            if (is_string($s['flag'] ?? null) && DwSlides::flagFile($s['flag']) === null) {
                $warn[] = "Country {$n}: no flag image for \"{$s['flag']}\" (the slide shows the name only).";
            }
            if (is_array($s)) {
                array_push($warn, ...self::lineWarnings($s, "Country {$n} (" . ($s['country'] ?? '?') . ')'));
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
        if (is_array($c['hook'] ?? null)) {
            array_push($warn, ...self::lineWarnings($c['hook'], 'The hook'));
        }
        if (is_string($c['outro']['question'] ?? null) && self::words($c['outro']['question']) > 12) {
            $warn[] = 'The outro question is ' . self::words($c['outro']['question']) . ' words (max 12).';
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
            $clip = is_string($part['clip_url'] ?? null) ? trim($part['clip_url']) : '';
            if ($clip !== '' && !DwClips::sourceOk($clip)) {
                $errors[] = ucfirst($label) . ': clip_url must be a video file (webm, ogv, mp4) on https://upload.wikimedia.org.';
            }
            if ($clip !== '' && trim((string) ($part['clip_credit'] ?? '')) === '') {
                $errors[] = ucfirst($label) . ': the clip needs a clip_credit (author and license).';
            }
            if (isset($part['clip_start']) && (!is_numeric($part['clip_start']) || $part['clip_start'] < 0)) {
                $errors[] = ucfirst($label) . ': clip_start must be a number of seconds.';
            }
        }
        if ($errors === []) {
            array_push($warn, ...self::readWarnings($c));
        }
        return [$errors, $warn];
    }

    /**
     * How long a slide shows in the video, in seconds (tools/promo/src/worldsTiming.js, keep both
     * the same): the hook 3.5 and the outro 4, fixed; a country 4 to 5 from its text.
     */
    private const READ = ['hook' => [3.5, 3.5], 'country' => [4.0, 5.0], 'outro' => [4.0, 4.0]];
    public const MAX_VIDEO_SECONDS = 40;

    /** The seconds a slide's text needs (headline + detail; the outro's question), uncapped. */
    public static function readSeconds(array $slide): float
    {
        // The hook reads a little faster (a short punchy kicker, up to ~12 words in its 3.5 s).
        $perWord = ($slide['kind'] ?? '') === 'hook' ? 0.16 : 0.21;
        return round(1.6 + $perWord * (self::screenWords((string) ($slide['text'] ?? '')) + self::screenWords((string) ($slide['detail'] ?? ''))), 1);
    }

    /** A slide's length in the video: its reading time within its kind's range. */
    public static function slideSeconds(array $slide): float
    {
        [$min, $max] = self::READ[$slide['kind'] ?? 'country'] ?? self::READ['country'];
        return round(min($max, max($min, self::readSeconds($slide))), 1);
    }

    /** A package's video length, in seconds. */
    public static function videoSeconds(array $content): float
    {
        return round(array_sum(array_map([self::class, 'slideSeconds'], self::slidePlan($content))), 1);
    }

    /**
     * Text a slide can't be read in its time (the slide isn't made longer: its detail is shortened
     * or dropped instead), and a video over 40 s.
     */
    public static function readWarnings(array $content): array
    {
        $warn = [];
        foreach (self::slidePlan($content) as $s) {
            if ($s['kind'] === 'outro') continue;
            [, $max] = self::READ[$s['kind']];
            if (($need = self::readSeconds($s)) > $max + 0.05) {
                $label = $s['kind'] === 'hook' ? 'The hook' : 'Country ' . ($s['position'] - 1) . ' (' . ($s['country'] ?? '') . ')';
                $warn[] = "{$label}: its text needs {$need} s to read, the slide lasts {$max} s: shorten or drop its detail.";
            }
        }
        if (($total = self::videoSeconds($content)) > self::MAX_VIDEO_SECONDS) {
            $warn[] = "The video lasts {$total} s (max " . self::MAX_VIDEO_SECONDS . ' s).';
        }
        return $warn;
    }

    /** Word-count warnings of a hook or a country: headline max 6, detail max 10 (older packages: text 12, note 6). */
    public static function lineWarnings(array $part, string $label): array
    {
        $warn = [];
        if (array_key_exists('headline', $part)) {
            if (($w = self::screenWords((string) $part['headline'])) > 6) {
                $warn[] = "{$label}: the headline is {$w} words (max 6).";
            }
            if (($w = self::screenWords((string) ($part['detail'] ?? ''))) > 10) {
                $warn[] = "{$label}: the detail is {$w} words (max 10).";
            }
            return $warn;
        }
        if (($w = self::screenWords((string) ($part['on_screen_text'] ?? ''))) > 12) {
            $warn[] = "{$label}: the on-screen text is {$w} words (max 12).";
        }
        if (($w = self::screenWords((string) ($part['on_screen_note'] ?? ''))) > 6) {
            $warn[] = "{$label}: the on-screen note is {$w} words (max 6).";
        }
        return $warn;
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
     * Returns [{date, ok, version?, package_id?, slides?, errors, warnings}].
     * $render false: the version is created but its slides are left to
     * renderPlannedSlide(), one request each (the topic page's progress bar);
     * a package with drawn illustrations is still rendered here.
     */
    public static function import(array $doc, ?int $topicId = null, bool $render = true): array
    {
        if (isset($doc['packages']) && is_array($doc['packages'])) {
            $items = $doc['packages'];
        } elseif (isset($doc['content'])) {
            $items = [$doc];
        } else {
            $items = [['content' => $doc]];
        }
        $settings = self::settings();
        $always = $settings['countries_always_included'];
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
            if (($item['mode'] ?? null) === 'text') {
                $report[] = ['date' => $label] + self::importText($topic, is_array($item['content'] ?? null) ? $item['content'] : []);
                continue;
            }
            $content = is_array($item['content'] ?? null) ? $item['content'] : null;
            if ($content === null) {
                $report[] = ['date' => $label, 'ok' => false, 'errors' => ['"content" is missing.'], 'warnings' => []];
                continue;
            }
            if (DwReaction::isReaction($content) !== ($topic['format'] === 'reaction')) {
                $report[] = ['date' => $label, 'ok' => false, 'warnings' => [], 'errors' => [$topic['format'] === 'reaction'
                    ? 'This topic is in the reaction format: its package needs "format": "reaction" (the brief\'s reaction_prompt).'
                    : 'This package is in the reaction format: switch the topic\'s format to reaction first.']];
                continue;
            }
            if ($topic['format'] === 'reaction') {
                $report[] = ['date' => $label] + self::importReaction($topic, $content, (string) ($item['model'] ?? 'Claude Code'), $always);
                continue;
            }
            [$errors, $warn] = self::validate($content, $always);
            if ($errors !== []) {
                $report[] = ['date' => $label, 'ok' => false, 'errors' => $errors, 'warnings' => $warn];
                continue;
            }
            [$content, $svgs] = self::splitSvgs($content);
            $fixed = self::fixCaptionEnding((string) $content['caption'], $settings['caption_cta'], (string) $content['outro']['question']);
            if ($fixed !== trim((string) $content['caption'])) {
                $warn[] = 'The caption did not end with the hilads.live line and the question: its ending was fixed.';
            }
            $content['caption'] = $fixed;
            $pdo = Database::pdo();
            $stmt = $pdo->prepare("
                INSERT INTO dw_packages (topic_id, version, content, model, brief)
                VALUES (?, COALESCE((SELECT MAX(version) FROM dw_packages WHERE topic_id = ?), 0) + 1, ?::jsonb, ?, ?::jsonb)
                RETURNING id, version
            ");
            // The topic's title and notes it was made from: a later change asks for a new package (briefChanged).
            $stmt->execute([$topic['id'], $topic['id'], json_encode($content, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                            mb_substr(trim((string) ($item['model'] ?? 'Claude Code')), 0, 120), json_encode(self::briefOf($topic), JSON_UNESCAPED_UNICODE)]);
            [$pkgId, $version] = $stmt->fetch(PDO::FETCH_NUM);
            $pkg = self::packageById((int) $pkgId);
            $plan = self::slidePlan($content);
            // Drawn illustrations exist only in the file: those packages are rendered now.
            $rendered = $render || array_filter($svgs, static fn($v) => is_string($v) && trim($v) !== '') !== [];
            if ($rendered) {
                foreach ($plan as $slide) {
                    $svg = is_string($svgs[$slide['position']] ?? null) ? $svgs[$slide['position']] : '';
                    array_push($warn, ...self::renderFromSource($pkg, $slide, $svg));
                }
            }
            if ($topic['visual_mode'] === 'video') {
                // A clip only where it shows the slide's exact subject: the others show their photo, as intended.
                $none = array_filter($plan, static fn($p) => $p['clip'] === null);
                if (count($none) === count($plan)) {
                    $warn[] = 'Video mode: no clip, every slide shows its 📷 photo.';
                } elseif ($none !== []) {
                    $warn[] = 'Video mode: 📷 photo on slide' . (count($none) > 1 ? 's ' : ' ') . implode(', ', array_column($none, 'position')) . ', 🎬 clip on the others.';
                }
            }
            if ($topic['status'] === 'planned') {
                self::setStatus($topic['id'], 'generated');
            }
            // Rendered now: the older versions go (else after the last slide, import_done).
            if ($rendered && ($gone = self::pruneOlderVersions((int) $pkgId)) > 0) {
                $warn[] = "The older version" . ($gone > 1 ? 's were' : ' was') . " deleted, with its slides and video.";
            }
            $report[] = ['date' => $label, 'ok' => true, 'version' => (int) $version, 'package_id' => (int) $pkgId,
                         'slides' => $rendered ? 0 : count($plan), 'errors' => [], 'warnings' => $warn];
        }
        return $report;
    }

    /** What a package is made from: the topic's title and notes. */
    public static function briefOf(array $topic): array
    {
        return ['title' => trim((string) $topic['title']), 'notes' => trim((string) ($topic['notes'] ?? ''))];
    }

    /**
     * Why $pkg no longer matches its topic's title or notes, or null. A package keeps the
     * title and notes it was made from (dw_packages.brief). One imported before that
     * (2026-11-06) is judged by what it carries: its "topic" is the title it was made with,
     * so a topic renamed in the calendar (DwSeed::TOPICS) changed after it only when the
     * package doesn't carry the new title; a topic still titled as in the calendar changed
     * after it when its notes differ from the calendar's.
     */
    public static function briefChanged(array $topic, array $pkg): ?string
    {
        $now = self::briefOf($topic);
        $then = is_string($pkg['brief'] ?? null) ? json_decode($pkg['brief'], true) : null;
        if (is_array($then)) {
            $what = ['title' => $now['title'] !== trim((string) ($then['title'] ?? '')), 'notes' => $now['notes'] !== trim((string) ($then['notes'] ?? ''))];
        } else {
            $made = trim((string) ($pkg['content']['topic'] ?? ''));
            $seed = null;
            foreach (DwSeed::TOPICS as [$d, $title, , , $notes]) {
                if ($d === $topic['date']) {
                    $seed = ['title' => trim($title), 'notes' => trim((string) $notes)];
                }
            }
            if ($seed !== null && $now['title'] === $seed['title']) {
                $what = ['notes' => $now['notes'] !== $seed['notes']];
            } else {
                $what = ['title' => $made !== '' && $now['title'] !== $made];
            }
        }
        $what = array_keys(array_filter($what));
        return $what === [] ? null : 'The ' . implode(' and ', $what) . ' changed after this package was made: prepare a new package (text, photos and clips).';
    }

    /**
     * A text update (mode "text"): the two-level text of the hook and each country
     * ({hook: {headline, detail}, slides: [{country, headline, detail}]}, the countries
     * in the order to show them) written into the topic's latest version in place,
     * its slides redrawn with their stored photos; clips, outro and caption kept.
     * Not for a published topic, nor one whose title or notes changed since (briefChanged).
     * Returns {ok, errors, warnings, version?, package_id?, skipped?, slides: 0}.
     */
    public static function importText(array $topic, array $text): array
    {
        $no = static fn(array $errors, array $warn = [], bool $skipped = false) => ['ok' => false, 'skipped' => $skipped, 'errors' => $errors, 'warnings' => $warn];
        if ($topic['status'] === 'published') {
            return $no(['Published: left as it is.'], [], true);
        }
        $pkg = self::package($topic['id']);
        if ($pkg === null) {
            return $no(['No package yet: import a full package first.']);
        }
        if (($why = self::briefChanged($topic, $pkg)) !== null) {
            return $no([$why], [], true);
        }
        $c = $pkg['content'];
        $old = array_values($c['slides'] ?? []);
        $byCountry = [];
        foreach ($old as $i => $s) {
            $byCountry[mb_strtolower(trim((string) ($s['country'] ?? '')))] = $i;
        }
        $hook = is_array($text['hook'] ?? null) ? $text['hook'] : [];
        $rows = is_array($text['slides'] ?? null) && array_is_list($text['slides']) ? $text['slides'] : [];
        $errors = [];
        if (trim((string) ($hook['headline'] ?? '')) === '') {
            $errors[] = 'The hook has no headline.';
        }
        $order = [];
        foreach ($rows as $n => $row) {
            $key = mb_strtolower(trim((string) ($row['country'] ?? '')));
            if (!isset($byCountry[$key])) {
                $errors[] = 'Country ' . ($n + 1) . ' ("' . ($row['country'] ?? '') . '") is not in version ' . $pkg['version'] . '.';
            } elseif (in_array($byCountry[$key], $order, true)) {
                $errors[] = '"' . $row['country'] . '" appears twice.';
            } elseif (trim((string) ($row['headline'] ?? '')) === '') {
                $errors[] = '"' . $row['country'] . '" has no headline.';
            } else {
                $order[] = $byCountry[$key];
            }
        }
        // A country left out is dropped with its slide (5 to 6 countries since 2026-11-07).
        if ($errors === [] && (count($order) < self::MIN_COUNTRIES || count($order) > self::MAX_COUNTRIES)) {
            $errors[] = 'There must be ' . self::MIN_COUNTRIES . ' to ' . self::MAX_COUNTRIES . ' countries (' . count($order) . ').';
        }
        $dropped = array_values(array_diff(array_keys($old), $order));
        if ($errors !== []) {
            return $no($errors);
        }

        $line = static fn(array $part, array $in) => ['headline' => trim((string) $in['headline']), 'detail' => trim((string) ($in['detail'] ?? ''))]
            + array_diff_key($part, ['on_screen_text' => 1, 'on_screen_note' => 1, 'headline' => 1, 'detail' => 1]);
        $c['hook'] = $line($c['hook'] ?? [], $hook);
        $c['slides'] = array_map(static fn($i, $row) => $line($old[$i], $row), $order, $rows);
        $warn = self::lineWarnings($c['hook'], 'The hook');
        foreach ($c['slides'] as $n => $s) {
            array_push($warn, ...self::lineWarnings($s, 'Country ' . ($n + 1) . ' (' . $s['country'] . ')'));
        }
        array_push($warn, ...self::readWarnings($c));

        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare("UPDATE dw_packages SET content = ?::jsonb WHERE id = ?")
                ->execute([json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $pkg['id']]);
            if ($order !== array_keys($old)) {
                // The countries' slides move with their pictures: out of the way first (unique positions), then in place;
                // the outro follows the last country; a dropped country's slide goes.
                $n = count($old);
                $pdo->prepare("UPDATE dw_slides SET position = position + 1000 WHERE package_id = ? AND position BETWEEN 2 AND ?")->execute([$pkg['id'], $n + 2]);
                $move = $pdo->prepare("UPDATE dw_slides SET position = ? WHERE package_id = ? AND position = ?");
                foreach ($order as $to => $from) {
                    $move->execute([$to + 2, $pkg['id'], $from + 1002]);
                }
                $move->execute([count($order) + 2, $pkg['id'], $n + 1002]);
                $pdo->prepare("DELETE FROM dw_slides WHERE package_id = ? AND position >= 1000")->execute([$pkg['id']]);
                if ($dropped !== []) {
                    $warn[] = 'Dropped: ' . implode(', ', array_map(static fn($i) => (string) $old[$i]['country'], $dropped)) . '.';
                }
                if (array_values(array_intersect(array_keys($old), $order)) !== $order) {
                    $warn[] = 'Countries reordered: ' . implode(', ', array_column($c['slides'], 'country')) . '.';
                }
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        $pkg['content'] = $c;
        // Every slide but the outro is redrawn with its stored picture (the outro too when it moved).
        $redraw = self::slidePlan($c);
        if ($dropped === []) {
            $redraw = array_slice($redraw, 0, -1);
        }
        foreach ($redraw as $slide) {
            if (($w = self::renderSlide($pkg, $slide)) !== null && !str_contains($w, 'no picture')) {
                $warn[] = $w;
            }
        }
        $warn[] = 'Text updated in version ' . $pkg['version'] . ', pictures and clips kept: render the video again.';
        return ['ok' => true, 'text' => true, 'skipped' => false, 'version' => $pkg['version'], 'package_id' => $pkg['id'], 'slides' => 0, 'errors' => [], 'warnings' => $warn];
    }

    /** Renders slide $position of a package imported without its slides (import(…, false)): its warnings. */
    public static function renderPlannedSlide(int $packageId, int $position): array
    {
        $pkg = self::packageById($packageId);
        $slide = $pkg !== null ? (self::slidePlan($pkg['content'])[$position - 1] ?? null) : null;
        if ($slide === null) {
            throw new InvalidArgumentException('Unknown slide.');
        }
        return self::renderFromSource($pkg, $slide, '');
    }

    /** One slide from its package source: the photo downloaded from Commons (else $svg, else plain). Its warnings. */
    private static function renderFromSource(array $pkg, array $slide, string $svg): array
    {
        $warn = [];
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
        return $warn;
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
        if ($slide['kind'] === 'outro' && !isset($slide['cta'])) {
            $slide['cta'] = self::settings()['outro_cta'];
        }
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
        if (DwReaction::isReaction($c)) {
            // The reaction screen has no slides: its text and rows are saved, the video render draws them.
            return preg_match('/^(headline|detail|source|source_url|value_label|data_year|data_years|clip_query|outro_question|card_bg|headline_accent)$/', $path) ? ['slide' => null] : null;
        }
        $onScreen = ['headline', 'detail', 'on_screen_text', 'on_screen_note', 'question', 'country', 'flag', 'photo_credit', 'photo_url'];
        $pic = 'illustration_brief|photo_credit|photo_url';
        if (preg_match("/^hook\\.(headline|detail|on_screen_text|{$pic})$/", $path, $m)) {
            return ['slide' => in_array($m[1], $onScreen, true) ? 1 : null, 'photo' => $m[1] === 'photo_url'];
        }
        if (preg_match("/^outro\\.(question|{$pic})$/", $path, $m)) {
            return ['slide' => in_array($m[1], $onScreen, true) ? $n + 2 : null, 'photo' => $m[1] === 'photo_url'];
        }
        if (preg_match("/^slides\\.(\\d+)\\.(country|flag|headline|detail|on_screen_text|on_screen_note|caption_detail|source_url|{$pic})$/", $path, $m)
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
            $keys = explode('.', $path);
            $field = array_pop($keys);
            $ref = &$c;
            foreach ($keys as $k) {
                $ref = &$ref[ctype_digit($k) ? (int) $k : $k];
            }
            if ($field === 'headline' || $field === 'detail') {
                // The two-level text replaces an older package's on_screen_text / on_screen_note on that slide.
                $ref['headline'] = self::headline($ref);
                $ref['detail'] = self::detail($ref);
                unset($ref['on_screen_text'], $ref['on_screen_note']);
            }
            $ref[$field] = $value;
            unset($ref);
        }
        $out = [];
        if ($path === 'data_year') {
            if (!ctype_digit($value) || (int) $value < 1950 || (int) $value > (int) gmdate('Y')) {
                throw new InvalidArgumentException('The year of the data, e.g. 2024.');
            }
            $c['data_year'] = (int) $value;
        }
        if ($path === 'card_bg' && $value !== '' && !DwReaction::cardBgOk($value)) {
            throw new InvalidArgumentException('The card color: ' . implode(', ', DwReaction::CARD_THEMES) . ' or a light #rrggbb.');
        }
        if ($path === 'headline_accent' && $value !== '' && mb_stripos((string) ($c['headline'] ?? ''), $value) === false) {
            throw new InvalidArgumentException('The orange words must be words of the headline, as written there.');
        }
        if (($path === 'card_bg' || $path === 'headline_accent') && $value === '') {
            unset($c[$path]);
        }
        if ($path === 'caption' || $path === 'outro.question' || $path === 'outro_question') {
            // The caption always ends with the hilads.live line, then the (current) question.
            $c['caption'] = self::fixCaptionEnding((string) ($c['caption'] ?? ''), self::settings()['caption_cta'],
                self::question($c), ['questions' => [self::question($pkg['content'])]]);
            $out['caption'] = $c['caption'];
        }
        Database::pdo()->prepare("UPDATE dw_packages SET content = ?::jsonb WHERE id = ?")
            ->execute([json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $packageId]);
        $pkg['content'] = $c;

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
    // ── Video clips (topics in video mode) ───────────────────────────────────

    /**
     * Sets slide $position's clip (a video file on Commons, the second it starts
     * at, its credit), or removes it ($url empty: the photo). Saved in the
     * package, like the photo; the next video render uses it.
     */
    public static function replaceClip(int $packageId, int $position, string $url, float $start, string $credit): string
    {
        $pkg = self::packageById($packageId);
        if ($pkg === null || !isset(self::slidePlan($pkg['content'])[$position - 1])) {
            throw new InvalidArgumentException('Unknown slide.');
        }
        $url = trim($url);
        $c = $pkg['content'];
        $ref = &self::part($c, $position);
        if ($url === '') {
            unset($ref['clip_url'], $ref['clip_start'], $ref['clip_credit']);
        } else {
            if (!DwClips::sourceOk($url)) {
                throw new InvalidArgumentException('The clip must be a video file (webm, ogv, mp4) on https://upload.wikimedia.org.');
            }
            if (trim($credit) === '') {
                throw new InvalidArgumentException('A clip needs its credit (author and license).');
            }
            $ref['clip_url'] = DwClips::clean($url);
            $ref['clip_start'] = max(0, round($start, 1));
            $ref['clip_credit'] = trim($credit);
        }
        unset($ref);
        Database::pdo()->prepare("UPDATE dw_packages SET content = ?::jsonb WHERE id = ?")
            ->execute([json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $packageId]);
        return $url === '' ? "Slide {$position}: photo used." : "Slide {$position}: clip saved (render the video again).";
    }

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

    /** The question the caption ends with: the outro's (slides) or outro_question (reaction). Pure. */
    public static function question(array $c): string
    {
        return (string) (DwReaction::isReaction($c) ? ($c['outro_question'] ?? '') : ($c['outro']['question'] ?? ''));
    }

    /**
     * The full caption to paste: the caption's text, the AI disclosure, the
     * hilads.live line, the question, then the hashtags. Pure.
     */
    public static function fullCaption(array $c, string $cta): string
    {
        $question = trim(self::question($c));
        $caption = self::fixCaptionEnding((string) ($c['caption'] ?? ''), $cta, $question);
        $body = trim(mb_substr($caption, 0, mb_strlen($caption) - mb_strlen(trim($cta) . "\n" . $question)));
        $parts = [$body, trim((string) ($c['ai_disclosure'] ?? '')), trim($cta) . "\n" . $question, implode(' ', $c['hashtags'] ?? [])];
        return implode("\n\n", array_filter($parts, static fn($p) => $p !== ''));
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
        if ($topic['format'] === 'reaction') {
            return self::reactionVideoData($topic, $pkg);
        }
        $slides = [];
        foreach (self::slides($pkg['id']) as $r) {
            $slides[(int) $r['position']] = ['photoUrl' => $r['photo_url'], 'pngUrl' => $r['png_url'], 'svgUrl' => $r['svg_url']];
        }
        // The clips play only in video mode (a package keeps them when its topic switches back).
        $video = $topic['visual_mode'] === 'video';
        $cta = self::settings()['outro_cta'];
        $plan = array_map(static fn($p) => ['clip' => $video ? $p['clip'] : null] + $p + ($slides[$p['position']] ?? []) + ($p['kind'] === 'outro' ? ['cta' => $cta] : []),
            self::slidePlan($pkg['content']));
        return ['date' => $topic['date'], 'title' => $topic['title'], 'version' => $pkg['version'], 'visualMode' => $topic['visual_mode'],
                'status' => $topic['status'], 'briefChanged' => self::briefChanged($topic, $pkg),
                'content' => $pkg['content'], 'slides' => $plan, 'videoUrl' => $pkg['video_url'] ?? null];
    }

    /** A presigned upload for a package's video, its screen as a PNG ($kind png) or its own reaction clip ($kind clip): {key, putUrl, url}. */
    public static function videoUpload(string $date, int $version, string $kind = 'video'): array
    {
        // png: the (first) PNG; png2: the reaction format's second PNG (its closing slide); clip: our own reaction clip.
        $kind = in_array($kind, ['png', 'png2', 'clip'], true) ? $kind : 'video';
        $topic = self::topicByDate($date);
        $pkg = $topic !== null ? self::package($topic['id'], $version) : null;
        if ($pkg === null) {
            throw new InvalidArgumentException('No package ' . $version . ' on ' . $date);
        }
        $png = $kind === 'png' || $kind === 'png2';
        $key = sprintf('dw/%d/v%d/%s-%s.%s', $topic['id'], $version, $kind === 'png2' ? 'still2' : ($png ? 'still' : $kind), bin2hex(random_bytes(6)), $png ? 'png' : 'mp4');
        return ['key' => $key, 'putUrl' => R2Uploader::presignPut($key, $png ? 'image/png' : 'video/mp4'), 'url' => R2Uploader::publicUrl($key)];
    }

    /** Saves the uploaded video (or PNG) on its package (the previous one is deleted). */
    public static function saveVideo(string $date, int $version, string $url): void
    {
        $png = str_ends_with($url, '.png');
        $second = $png && str_contains($url, '/still2-');   // the reaction format's second PNG (its closing slide)
        $topic = self::topicByDate($date);
        $pkg = $topic !== null ? self::package($topic['id'], $version) : null;
        if ($pkg === null) {
            throw new InvalidArgumentException('No package ' . $version . ' on ' . $date);
        }
        $prefix = rtrim((string) getenv('R2_PUBLIC_URL'), '/') . sprintf('/dw/%d/v%d/%s-', $topic['id'], $version, $second ? 'still2' : ($png ? 'still' : 'video'));
        if (!str_starts_with($url, $prefix) || !(str_ends_with($url, '.mp4') || $png)) {
            throw new InvalidArgumentException('Not a video upload of this package: ' . $url);
        }
        $col = $second ? 'still2_url' : ($png ? 'still_url' : 'video_url');
        Database::pdo()->prepare($png ? "UPDATE dw_packages SET {$col} = ? WHERE id = ?" : "UPDATE dw_packages SET video_url = ?, video_at = now() WHERE id = ?")
            ->execute([$url, $pkg['id']]);
        if (!empty($pkg[$col]) && $pkg[$col] !== $url) {
            self::deleteFile($pkg[$col]);
        }
    }

    // ── Reaction format (DwReaction, DwPixabay) ──────────────────────────────

    /**
     * Imports a reaction package as a new version of its topic: checked, its clip ({pixabay_id})
     * looked up on Pixabay and copied to R2; without a clip (or when Pixabay fails) it is
     * imported anyway and flagged ("Find another clip" in the admin). {ok, version?, package_id?, slides: 0, errors, warnings}.
     */
    public static function importReaction(array $topic, array $content, string $model, array $highlight): array
    {
        [$errors, $warn] = DwReaction::validate($content, $highlight);
        if ($errors !== []) {
            return ['ok' => false, 'errors' => $errors, 'warnings' => $warn];
        }
        $content = DwReaction::normalize($content);
        $want = (int) ($content['clip']['pixabay_id'] ?? 0);
        unset($content['clip']);
        $fixed = self::fixCaptionEnding((string) $content['caption'], self::settings()['caption_cta'], $content['outro_question']);
        if ($fixed !== trim((string) $content['caption'])) {
            $warn[] = 'The caption did not end with the hilads.live line and the question: its ending was fixed.';
        }
        $content['caption'] = $fixed;
        $stmt = Database::pdo()->prepare("
            INSERT INTO dw_packages (topic_id, version, content, model, brief)
            VALUES (?, COALESCE((SELECT MAX(version) FROM dw_packages WHERE topic_id = ?), 0) + 1, ?::jsonb, ?, ?::jsonb)
            RETURNING id, version
        ");
        $stmt->execute([$topic['id'], $topic['id'], json_encode($content, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                        mb_substr(trim($model), 0, 120), json_encode(self::briefOf($topic), JSON_UNESCAPED_UNICODE)]);
        [$pkgId, $version] = $stmt->fetch(PDO::FETCH_NUM);
        if ($want > 0) {
            try {
                $clip = self::setReactionClip((int) $pkgId, $want);
                if ($clip['ai_generated']) {
                    $warn[] = 'The clip is AI-generated: turn on the AI label when you publish.';
                }
            } catch (InvalidArgumentException | RuntimeException $e) {
                $warn[] = "No clip: Pixabay video {$want} not used ({$e->getMessage()}): find one in the admin.";
            }
        } else {
            $warn[] = 'No clip: find one in the admin ("Find another clip").';
        }
        if ($topic['status'] === 'planned') {
            self::setStatus($topic['id'], 'generated');
        }
        if (($gone = self::pruneOlderVersions((int) $pkgId)) > 0) {
            $warn[] = 'The older version' . ($gone > 1 ? 's were' : ' was') . ' deleted, with its clip and video.';
        }
        return ['ok' => true, 'version' => (int) $version, 'package_id' => (int) $pkgId, 'slides' => 0, 'errors' => [], 'warnings' => $warn];
    }

    /** Sets a reaction package's clip: Pixabay video $pixabayId, copied to R2 (the old copy deleted). The stored clip. */
    public static function setReactionClip(int $packageId, int $pixabayId): array
    {
        $pkg = self::packageById($packageId);
        if ($pkg === null || !DwReaction::isReaction($pkg['content'])) {
            throw new InvalidArgumentException('Unknown reaction package.');
        }
        $hit = DwPixabay::byId($pixabayId);
        if ($hit === null) {
            throw new InvalidArgumentException("no Pixabay video {$pixabayId}");
        }
        $url = self::store($pkg, "clip-{$hit['id']}", 'mp4', DwPixabay::download($hit['url']), 'video/mp4');
        $c = $pkg['content'];
        $old = (string) ($c['clip']['url'] ?? '');
        $c['clip'] = DwReaction::clipOf($hit, $url);
        Database::pdo()->prepare("UPDATE dw_packages SET content = ?::jsonb WHERE id = ?")
            ->execute([json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $packageId]);
        if ($old !== '' && $old !== $url) {
            self::deleteFile($old);
        }
        return $c['clip'];
    }

    /**
     * Sets a reaction package's clip to one of our own (made elsewhere, e.g. an AI video), already
     * uploaded to R2 by tools/promo (videoUpload(…, 'clip')): {source: "upload", url, credit (an admin
     * note, no credit on the screen), ai_generated}. The old copy is deleted. The stored clip.
     */
    public static function saveUploadedClip(string $date, int $version, string $url, string $credit, bool $ai): array
    {
        $topic = self::topicByDate($date);
        $pkg = $topic !== null ? self::package($topic['id'], $version) : null;
        if ($pkg === null || !DwReaction::isReaction($pkg['content'])) {
            throw new InvalidArgumentException('No reaction package ' . $version . ' on ' . $date);
        }
        $prefix = rtrim((string) getenv('R2_PUBLIC_URL'), '/') . sprintf('/dw/%d/v%d/clip-', $topic['id'], $version);
        if (!str_starts_with($url, $prefix) || !str_ends_with($url, '.mp4')) {
            throw new InvalidArgumentException('Not a clip upload of this package: ' . $url);
        }
        $credit = trim($credit);   // a note for the admin (not shown on the screen)
        if (mb_strlen($credit) > 80) {
            throw new InvalidArgumentException('The clip note is 80 characters at most.');
        }
        $c = $pkg['content'];
        $old = (string) ($c['clip']['url'] ?? '');
        $c['clip'] = ['source' => 'upload', 'url' => $url, 'credit' => $credit, 'ai_generated' => $ai];
        Database::pdo()->prepare("UPDATE dw_packages SET content = ?::jsonb WHERE id = ?")
            ->execute([json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $pkg['id']]);
        if ($old !== '' && $old !== $url) {
            self::deleteFile($old);
        }
        return $c['clip'];
    }

    /** Marks a reaction package's clip as AI-generated or not (the admin's checkbox; Pixabay's tags set it first). */
    public static function setClipAi(int $packageId, bool $ai): void
    {
        $pkg = self::packageById($packageId);
        if ($pkg === null || !isset($pkg['content']['clip'])) {
            throw new InvalidArgumentException('This package has no clip.');
        }
        $c = $pkg['content'];
        $c['clip']['ai_generated'] = $ai;
        Database::pdo()->prepare("UPDATE dw_packages SET content = ?::jsonb WHERE id = ?")
            ->execute([json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $packageId]);
    }

    /** Saves a reaction package's edited rows (the admin's table). Returns the warnings. */
    public static function saveRows(int $packageId, array $rows): array
    {
        $pkg = self::packageById($packageId);
        if ($pkg === null || !DwReaction::isReaction($pkg['content'])) {
            throw new InvalidArgumentException('Unknown reaction package.');
        }
        $rows = array_values(array_filter($rows, static fn($r) => is_array($r) && trim((string) ($r['country'] ?? '')) !== ''));
        $rows = array_map(static fn($r) => ['rank' => (int) ($r['rank'] ?? 0), 'country' => (string) $r['country'], 'flag' => (string) ($r['flag'] ?? ''),
            'value' => is_numeric($r['value'] ?? null) ? (float) $r['value'] : null, 'unit' => (string) ($r['unit'] ?? ''),
            'gap_before' => !empty($r['gap_before']), 'highlight' => !empty($r['highlight'])], $rows);
        [$errors, $warn] = DwReaction::checkRows($rows, self::settings()['countries_always_included']);
        if ($errors !== []) {
            throw new InvalidArgumentException(implode(' ', $errors));
        }
        $c = DwReaction::normalize(['rows' => $rows] + $pkg['content']);
        Database::pdo()->prepare("UPDATE dw_packages SET content = ?::jsonb WHERE id = ?")
            ->execute([json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $packageId]);
        return $warn;
    }

    /** What the reaction video is made from (tools/promo: Reaction.jsx). */
    private static function reactionVideoData(array $topic, array $pkg): array
    {
        $c = $pkg['content'];
        $clip = $c['clip'] ?? null;
        return ['date' => $topic['date'], 'title' => $topic['title'], 'version' => $pkg['version'], 'format' => 'reaction',
                'status' => $topic['status'], 'briefChanged' => self::briefChanged($topic, $pkg), 'content' => $c,
                'screen' => [
                    'headline' => (string) ($c['headline'] ?? ''), 'detail' => (string) ($c['detail'] ?? ''),
                    'rows' => $c['rows'] ?? [], 'source' => DwReaction::sourceLine($c),
                    'highlight' => self::settings()['countries_always_included'],
                    'clip' => $clip !== null ? ['url' => $clip['url'], 'credit' => DwReaction::clipCredit($clip)] : null,
                    'seconds' => DwReaction::VIDEO_SECONDS, 'valueFormat' => $c['value_format'] ?? null,
                    'question' => trim((string) ($c['outro_question'] ?? '')) ?: null,
                    'cardBg' => $c['card_bg'] ?? null, 'accent' => $c['headline_accent'] ?? null,
                ],
                'videoUrl' => $pkg['video_url'] ?? null, 'stillUrl' => $pkg['still_url'] ?? null, 'still2Url' => $pkg['still2_url'] ?? null];
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
