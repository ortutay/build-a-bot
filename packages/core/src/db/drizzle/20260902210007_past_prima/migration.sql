CREATE TABLE `items` (
	`id` text PRIMARY KEY,
	`source_script_id` text NOT NULL,
	`unique_id` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_items_source_script_id_scripts_id_fk` FOREIGN KEY (`source_script_id`) REFERENCES `scripts`(`id`),
	CONSTRAINT `items_source_script_id_unique_id_unique` UNIQUE(`source_script_id`,`unique_id`)
);
