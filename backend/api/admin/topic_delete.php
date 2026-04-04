<?php

declare(strict_types=1);

admin_require_login();
csrf_verify();

$pdo = Database::pdo();

// Verify topic exists
$stmt = $pdo->prepare("
    SELECT ct.channel_id, ct.title, c.status
    FROM channel_topics ct
    JOIN channels c ON c.id = ct.channel_id
    WHERE ct.channel_id = :id
");
$stmt->execute([':id' => $topicId]);
$topic = $stmt->fetch();

if (!$topic) {
    flash_set('error', 'Topic not found.');
    admin_redirect('/admin/topics');
}

if ($topic['status'] === 'deleted') {
    flash_set('error', 'Topic is already deleted.');
    admin_redirect('/admin/topics');
}

TopicRepository::adminDelete($topicId);

error_log('[admin] topic deleted: ' . $topicId . ' (' . $topic['title'] . ')');
flash_set('success', 'Topic "' . $topic['title'] . '" deleted.');

admin_redirect('/admin/topics');
