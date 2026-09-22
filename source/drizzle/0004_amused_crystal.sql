CREATE TABLE `reviewer_access_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`created_by_email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`consumed_session_id` text,
	`invalidated_at` integer,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reviewer_access_codes_hash` ON `reviewer_access_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `idx_reviewer_access_codes_active` ON `reviewer_access_codes` (`expires_at`,`consumed_at`,`invalidated_at`);--> statement-breakpoint
CREATE TABLE `reviewer_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`display_name` text DEFAULT 'María' NOT NULL,
	`created_from_code_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reviewer_sessions_token_hash` ON `reviewer_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_reviewer_sessions_active` ON `reviewer_sessions` (`expires_at`,`revoked_at`);