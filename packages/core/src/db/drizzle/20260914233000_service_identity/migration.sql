ALTER TABLE `data_services` ADD COLUMN `identity` text;--> statement-breakpoint
UPDATE `data_services`
SET `identity` = json_extract(`item_schema`, '$."x-fetchfox-identity"'),
    `item_schema` = json_remove(`item_schema`, '$."x-fetchfox-identity"')
WHERE json_type(`item_schema`, '$."x-fetchfox-identity"') IS NOT NULL;
