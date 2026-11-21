-- CreateTable
CREATE TABLE `media_assets` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `reviewId` VARCHAR(191) NOT NULL,
    `status` ENUM('UPLOADING', 'PROCESSING', 'READY', 'FAILED') NOT NULL DEFAULT 'UPLOADING',
    `declaredMime` VARCHAR(64) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `detectedMime` VARCHAR(64) NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `ingestKey` VARCHAR(255) NOT NULL,
    `thumbKey` VARCHAR(255) NULL,
    `mediumKey` VARCHAR(255) NULL,
    `failureReason` VARCHAR(64) NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `media_assets_reviewId_status_idx`(`reviewId`, `status`),
    INDEX `media_assets_ownerId_createdAt_idx`(`ownerId`, `createdAt`),
    INDEX `media_assets_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `reviews`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
