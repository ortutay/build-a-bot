PRAGMA foreign_keys=OFF;--> statement-breakpoint
INSERT OR IGNORE INTO `data_sources` (`id`, `url`)
SELECT DISTINCT
  'legacy-' || `items`.`source_script_id`,
  'legacy://script/' || `items`.`source_script_id`
FROM `items`
INNER JOIN `scripts` ON `items`.`source_script_id` = `scripts`.`id`
LEFT JOIN `data_sources` ON `scripts`.`name` = 'url:' || `data_sources`.`url`
WHERE `data_sources`.`id` IS NULL;--> statement-breakpoint
CREATE TABLE `__new_items` (
	`id` text PRIMARY KEY,
	`source_script_id` text NOT NULL,
	`data_source_id` text NOT NULL,
	`unique_id` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_items_source_script_id_scripts_id_fk` FOREIGN KEY (`source_script_id`) REFERENCES `scripts`(`id`),
	CONSTRAINT `fk_items_data_source_id_data_sources_id_fk` FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`id`),
	CONSTRAINT `items_source_script_id_data_source_id_unique_id_unique` UNIQUE(`source_script_id`,`data_source_id`,`unique_id`)
);
--> statement-breakpoint
INSERT INTO `__new_items`(`id`, `source_script_id`, `data_source_id`, `unique_id`, `data`, `created_at`, `updated_at`)
SELECT
  `items`.`id`,
  `items`.`source_script_id`,
  COALESCE(`data_sources`.`id`, 'legacy-' || `items`.`source_script_id`),
  `items`.`unique_id`,
  `items`.`data`,
  `items`.`created_at`,
  `items`.`updated_at`
FROM `items`
INNER JOIN `scripts` ON `items`.`source_script_id` = `scripts`.`id`
LEFT JOIN `data_sources` ON `scripts`.`name` = 'url:' || `data_sources`.`url`;--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
