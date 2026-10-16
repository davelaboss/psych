CREATE TABLE `reviewer_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'REVIEWER' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`invited_by_email` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviewer_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`created_by_email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`redeemed_at` integer,
	`redeemed_by_user_id` text,
	`redeemed_by_email` text,
	`revoked_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reviewer_invites_code_hash` ON `reviewer_invites` (`code_hash`);--> statement-breakpoint
CREATE INDEX `idx_reviewer_invites_active` ON `reviewer_invites` (`expires_at`,`redeemed_at`,`revoked_at`);