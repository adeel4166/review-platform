-- M3b-07 (task #57): seller replies. The only non-additive M3b step (m3b-spec §6.1): moderation_cases gains a subject arc and
-- its reviewId FK changes CASCADE -> RESTRICT (MySQL ER 3823 forbids a CHECK on a column with a cascading FK).
-- NOT applied by the implementing task: needs an approved DB_MIGRATION proposal.

ALTER TABLE `moderation_cases` DROP FOREIGN KEY `moderation_cases_reviewId_fkey`;

ALTER TABLE `moderation_cases`
    ADD COLUMN `subjectType` ENUM('REVIEW', 'SELLER_REPLY') NOT NULL DEFAULT 'REVIEW',
    ADD COLUMN `sellerReplyId` VARCHAR(191) NULL,
    MODIFY `reviewId` VARCHAR(191) NULL;

CREATE TABLE `seller_replies` (
    `id` VARCHAR(191) NOT NULL,
    `reviewId` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED', 'REMOVED', 'DELETED') NOT NULL DEFAULT 'PENDING',
    `publishedAt` DATETIME(3) NULL,
    `editedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `seller_replies_sellerId_createdAt_idx`(`sellerId`, `createdAt`),
    INDEX `seller_replies_status_createdAt_idx`(`status`, `createdAt`),
    UNIQUE INDEX `seller_replies_reviewId_sellerId_key`(`reviewId`, `sellerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `moderation_cases_sellerReplyId_version_key` ON `moderation_cases`(`sellerReplyId`, `version`);

ALTER TABLE `moderation_cases` ADD CONSTRAINT `moderation_cases_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `reviews`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `moderation_cases` ADD CONSTRAINT `moderation_cases_sellerReplyId_fkey` FOREIGN KEY (`sellerReplyId`) REFERENCES `seller_replies`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `seller_replies` ADD CONSTRAINT `seller_replies_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `reviews`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `seller_replies` ADD CONSTRAINT `seller_replies_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `sellers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `seller_replies` ADD CONSTRAINT `seller_replies_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `seller_replies` ADD CONSTRAINT `seller_replies_deletedById_fkey` FOREIGN KEY (`deletedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `seller_replies` ADD CONSTRAINT `chk_reply_body_len` CHECK (CHAR_LENGTH(`body`) BETWEEN 1 AND 1500);
ALTER TABLE `seller_replies` ADD CONSTRAINT `chk_reply_deleted` CHECK ((`status` = 'DELETED') = (`deletedAt` IS NOT NULL));
ALTER TABLE `seller_replies` ADD CONSTRAINT `chk_reply_published` CHECK (`status` <> 'PUBLISHED' OR `publishedAt` IS NOT NULL);
ALTER TABLE `seller_replies` ADD CONSTRAINT `chk_reply_version` CHECK (`version` >= 1);
ALTER TABLE `moderation_cases` ADD CONSTRAINT `chk_case_subject` CHECK (((`subjectType` = 'REVIEW') = (`reviewId` IS NOT NULL)) AND ((`subjectType` = 'SELLER_REPLY') = (`sellerReplyId` IS NOT NULL)));
