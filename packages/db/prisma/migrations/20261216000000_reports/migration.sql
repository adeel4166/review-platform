-- CreateTable
CREATE TABLE `reports` (
    `id` VARCHAR(191) NOT NULL,
    `reporterId` VARCHAR(191) NOT NULL,
    `reason` ENUM('SPAM', 'FAKE_OR_MISLEADING', 'CONFLICT_OF_INTEREST', 'OFF_TOPIC', 'HARASSMENT_OR_HATE', 'SEXUAL_CONTENT', 'VIOLENCE_OR_THREATS', 'PERSONAL_INFORMATION', 'INTELLECTUAL_PROPERTY', 'ILLEGAL_CONTENT', 'IMPERSONATION', 'OTHER') NOT NULL,
    `details` VARCHAR(1000) NULL,
    `status` ENUM('OPEN', 'ACTION_TAKEN', 'NO_ACTION', 'REJECTED') NOT NULL DEFAULT 'OPEN',
    `weight` TINYINT NOT NULL DEFAULT 1,
    `caseId` VARCHAR(191) NULL,
    `reviewId` VARCHAR(191) NULL,
    `sellerReplyId` VARCHAR(191) NULL,
    `ipHash` CHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,
    `resolvedById` VARCHAR(191) NULL,

    INDEX `reports_caseId_status_idx`(`caseId`, `status`),
    INDEX `reports_reporterId_createdAt_idx`(`reporterId`, `createdAt`),
    UNIQUE INDEX `reports_reporterId_reviewId_key`(`reporterId`, `reviewId`),
    UNIQUE INDEX `reports_reporterId_sellerReplyId_key`(`reporterId`, `sellerReplyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `moderation_cases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `reviews`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_sellerReplyId_fkey` FOREIGN KEY (`sellerReplyId`) REFERENCES `seller_replies`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `reports` ADD CONSTRAINT `chk_report_one_target` CHECK ((`reviewId` IS NOT NULL) + (`sellerReplyId` IS NOT NULL) = 1);
ALTER TABLE `reports` ADD CONSTRAINT `chk_report_details_len` CHECK (`details` IS NULL OR CHAR_LENGTH(`details`) BETWEEN 1 AND 1000);
