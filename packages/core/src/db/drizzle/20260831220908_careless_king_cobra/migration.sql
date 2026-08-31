CREATE TABLE `scripts` (
	`id` text PRIMARY KEY,
	`service_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`exports` text NOT NULL,
	`context` text NOT NULL,
	`modules` text NOT NULL,
	`tools` text NOT NULL,
	CONSTRAINT `fk_scripts_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`),
	CONSTRAINT `scripts_service_id_name_unique` UNIQUE(`service_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL UNIQUE
);
