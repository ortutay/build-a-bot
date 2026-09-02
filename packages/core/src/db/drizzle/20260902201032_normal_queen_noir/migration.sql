CREATE TABLE `data_sources` (
	`id` text PRIMARY KEY,
	`url` text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE `results` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT `fk_results_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`)
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY,
	`script_id` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text,
	`input` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	CONSTRAINT `fk_runs_script_id_scripts_id_fk` FOREIGN KEY (`script_id`) REFERENCES `scripts`(`id`)
);
--> statement-breakpoint
ALTER TABLE `scripts` ADD `build_input` text;
