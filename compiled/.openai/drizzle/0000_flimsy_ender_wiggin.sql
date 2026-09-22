CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_slug` text NOT NULL,
	`title_snapshot` text NOT NULL,
	`image_snapshot` text NOT NULL,
	`price_pyg` integer NOT NULL,
	`due_now_pyg` integer NOT NULL,
	`balance_later_pyg` integer NOT NULL,
	`sale_mode` text NOT NULL,
	`deposit_percent` integer NOT NULL,
	`pickup_available_date` text,
	`item_status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_order_items_order_id` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_order_items_product_id` ON `order_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`hold_token` text NOT NULL,
	`status` text NOT NULL,
	`buyer_name` text,
	`buyer_whatsapp` text,
	`buyer_email` text,
	`pickup_acknowledged` integer NOT NULL,
	`delayed_pickup_acknowledged` integer NOT NULL,
	`deposit_terms_acknowledged` integer NOT NULL,
	`total_value_pyg` integer NOT NULL,
	`due_now_pyg` integer NOT NULL,
	`balance_later_pyg` integer NOT NULL,
	`hold_expires_at` integer,
	`transfer_declared_at` integer,
	`payment_confirmed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orders_reference` ON `orders` (`reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orders_hold_token` ON `orders` (`hold_token`);--> statement-breakpoint
CREATE INDEX `idx_orders_status_created` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`tags_json` text NOT NULL,
	`description` text NOT NULL,
	`condition` text NOT NULL,
	`condition_notes` text NOT NULL,
	`known_defects` text NOT NULL,
	`images_json` text NOT NULL,
	`asking_price_pyg` integer NOT NULL,
	`original_price_pyg` integer,
	`sale_mode` text NOT NULL,
	`pickup_available_date` text,
	`deposit_percent` integer NOT NULL,
	`requires_vehicle` integer NOT NULL,
	`requires_loading_help` integer NOT NULL,
	`logistics_notes_json` text NOT NULL,
	`status` text NOT NULL,
	`featured` integer NOT NULL,
	`date_listed` text NOT NULL,
	`last_price_change` text,
	`needs_review` integer NOT NULL,
	`admin_price_floor_pyg` integer,
	`market_estimate_pyg` integer,
	`recommended_fast_sale_price_pyg` integer,
	`pricing_confidence` text,
	`pricing_research` text,
	`internal_notes` text,
	`is_demo` integer NOT NULL,
	`hold_token` text,
	`hold_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_slug` ON `products` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_products_public_status` ON `products` (`status`,`category`);--> statement-breakpoint
CREATE INDEX `idx_products_hold_expiry` ON `products` (`status`,`hold_expires_at`);