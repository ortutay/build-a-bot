ALTER TABLE `items` ADD COLUMN `last_seen_at` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `items` SET `last_seen_at` = `updated_at`;
