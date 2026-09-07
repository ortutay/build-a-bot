PRAGMA foreign_keys=OFF;--> statement-breakpoint
DELETE FROM `items`;--> statement-breakpoint
DELETE FROM `results`;--> statement-breakpoint
DELETE FROM `runs`;--> statement-breakpoint
DELETE FROM `scripts`;--> statement-breakpoint
DROP TABLE `scripts`;--> statement-breakpoint
DROP TABLE `data_sources`;--> statement-breakpoint
DROP TABLE `services`;--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`key` text NOT NULL UNIQUE,
	`username` text NOT NULL UNIQUE
);--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`key` text NOT NULL UNIQUE,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	CONSTRAINT `fk_services_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`),
	CONSTRAINT `services_account_id_name_unique` UNIQUE(`account_id`,`name`)
);--> statement-breakpoint
CREATE TABLE `data_services` (
	`service_id` text PRIMARY KEY,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`item_schema` text NOT NULL,
	CONSTRAINT `fk_data_services_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`)
);--> statement-breakpoint
CREATE TABLE `data_sources` (
	`id` text PRIMARY KEY,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`key` text NOT NULL UNIQUE,
	`data_service_id` text NOT NULL,
	`url` text NOT NULL,
	CONSTRAINT `fk_data_sources_data_service_id_data_services_service_id_fk` FOREIGN KEY (`data_service_id`) REFERENCES `data_services`(`service_id`),
	CONSTRAINT `data_sources_data_service_id_url_unique` UNIQUE(`data_service_id`,`url`)
);--> statement-breakpoint
CREATE TABLE `scripts` (
	`id` text PRIMARY KEY,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`service_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`build_input` text,
	`exports` text NOT NULL,
	`vm_context` text NOT NULL,
	`modules` text NOT NULL,
	`tools` text NOT NULL,
	CONSTRAINT `fk_scripts_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`),
	CONSTRAINT `scripts_service_id_name_unique` UNIQUE(`service_id`,`name`)
);--> statement-breakpoint
PRAGMA foreign_keys=ON;
