CREATE TABLE `inventory_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`item_number` integer,
	`field_name` text NOT NULL,
	`previous_value_json` text,
	`new_value_json` text,
	`actor_role` text NOT NULL,
	`actor_email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_audit_product_created` ON `inventory_audit` (`product_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `inventory_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`payload_json` text NOT NULL,
	`product_count` integer NOT NULL,
	`image_count` integer NOT NULL,
	`created_by_email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_snapshots_label` ON `inventory_snapshots` (`label`);--> statement-breakpoint
ALTER TABLE `products` ADD `seller_confirmed_fields_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
