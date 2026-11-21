-- AlterTable
ALTER TABLE `reviews`
    ADD COLUMN `verifiedBuyer` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `verifiedAt` DATETIME(3) NULL,
    ADD COLUMN `verifiedOrderId` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `moderation_cases` (
    `id` VARCHAR(191) NOT NULL,
    `reviewId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `state` ENUM('PENDING', 'AI_REVIEW', 'NEEDS_HUMAN', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `aiScore` DECIMAL(4, 3) NULL,
    `aiConfidence` DECIMAL(4, 3) NULL,
    `aiReasons` JSON NULL,
    `aiProvider` VARCHAR(64) NULL,
    `decisionReason` VARCHAR(500) NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `moderation_cases_reviewId_version_key`(`reviewId`, `version`),
    INDEX `moderation_cases_state_createdAt_idx`(`state`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `actorType` ENUM('USER', 'STAFF', 'AI', 'SYSTEM') NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `action` VARCHAR(64) NOT NULL,
    `entityType` VARCHAR(32) NOT NULL,
    `entityId` VARCHAR(64) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entityType_entityId_id_idx`(`entityType`, `entityId`, `id`),
    INDEX `audit_logs_actorId_createdAt_idx`(`actorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `moderation_cases` ADD CONSTRAINT `moderation_cases_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `reviews`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `moderation_cases` ADD CONSTRAINT `moderation_cases_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
