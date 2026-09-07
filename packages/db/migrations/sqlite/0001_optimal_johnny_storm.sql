CREATE TABLE `member_instruments` (
	`member_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	PRIMARY KEY(`member_id`, `instrument_id`),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `member_instruments_instrument_id_member_id_idx` ON `member_instruments` (`instrument_id`,`member_id`);