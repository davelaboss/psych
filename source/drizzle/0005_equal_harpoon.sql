ALTER TABLE `order_items` ADD `quantity` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `quantity_total` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `quantity_remaining` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `quantity_held` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `quantity_sold` integer DEFAULT 0 NOT NULL;