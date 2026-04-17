-- Add thumbnail photo URL column to users table.
-- Populated at upload time for images uploaded after this migration.
-- NULL for existing users until they re-upload their profile photo.
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_thumb_photo_url TEXT;
