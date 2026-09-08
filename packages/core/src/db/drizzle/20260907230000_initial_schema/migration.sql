PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE IF EXISTS `items`;--> statement-breakpoint
DROP TABLE IF EXISTS `results`;--> statement-breakpoint
DROP TABLE IF EXISTS `runs`;--> statement-breakpoint
DROP TABLE IF EXISTS `scripts`;--> statement-breakpoint
DROP TABLE IF EXISTS `data_sources`;--> statement-breakpoint
DROP TABLE IF EXISTS `data_services`;--> statement-breakpoint
DROP TABLE IF EXISTS `services`;--> statement-breakpoint
DROP TABLE IF EXISTS `accounts`;--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`username` text NOT NULL UNIQUE
);--> statement-breakpoint
CREATE TABLE `data_services` (
	`id` text PRIMARY KEY,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`item_schema` text NOT NULL,
	CONSTRAINT `fk_data_services_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`),
	CONSTRAINT `data_services_account_id_name_unique` UNIQUE(`account_id`,`name`)
);--> statement-breakpoint
CREATE TABLE `data_sources` (
	`id` text PRIMARY KEY,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`data_service_id` text NOT NULL,
	`url` text NOT NULL,
	CONSTRAINT `fk_data_sources_data_service_id_data_services_id_fk` FOREIGN KEY (`data_service_id`) REFERENCES `data_services`(`id`),
	CONSTRAINT `data_sources_data_service_id_url_unique` UNIQUE(`data_service_id`,`url`)
);--> statement-breakpoint
CREATE TABLE `scripts` (
	`id` text PRIMARY KEY,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`data_service_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`build_input` text,
	`exports` text NOT NULL,
	`vm_context` text NOT NULL,
	`modules` text NOT NULL,
	`tools` text NOT NULL,
	CONSTRAINT `fk_scripts_data_service_id_data_services_id_fk` FOREIGN KEY (`data_service_id`) REFERENCES `data_services`(`id`),
	CONSTRAINT `scripts_data_service_id_name_unique` UNIQUE(`data_service_id`,`name`)
);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY,
	`script_id` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text,
	`input` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	CONSTRAINT `fk_runs_script_id_scripts_id_fk` FOREIGN KEY (`script_id`) REFERENCES `scripts`(`id`)
);--> statement-breakpoint
CREATE TABLE `results` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT `fk_results_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`)
);--> statement-breakpoint
CREATE TABLE `items` (
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
);--> statement-breakpoint
PRAGMA foreign_keys=ON;
