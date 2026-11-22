-- V3-06 (ADR-0034 D12): AI review summaries. Authored for review; applied only with an approved DB_MIGRATION proposal.
-- Reversible: see down.sql in this directory (operators run it by hand, then `prisma migrate resolve --rolled-back`).
CREATE TABLE `product_review_summaries` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `language` VARCHAR(16) NOT NULL DEFAULT 'en',
    `status` ENUM('READY', 'HIDDEN', 'FAILED') NOT NULL DEFAULT 'READY',
    `pros` JSON NOT NULL,
    `cons` JSON NOT NULL,
    `summary` VARCHAR(600) NOT NULL,
    `sourceReviewCount` INTEGER NOT NULL,
    `sourceReviewIds` JSON NOT NULL,
    `inputHash` CHAR(64) NOT NULL,
    `model` VARCHAR(64) NOT NULL,
    `promptSha256` CHAR(64) NOT NULL,
    `generatedAt` DATETIME(3) NOT NULL,
    `hiddenAt` DATETIME(3) NULL,
    `hiddenReason` VARCHAR(32) NULL,
    `hiddenById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `product_review_summaries_productId_language_key`(`productId`, `language`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `product_review_summaries` ADD CONSTRAINT `product_review_summaries_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `product_review_summaries` ADD CONSTRAINT `product_review_summaries_hiddenById_fkey` FOREIGN KEY (`hiddenById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `product_review_summaries` ADD CONSTRAINT `chk_product_review_summaries_count` CHECK (`sourceReviewCount` >= 5);
ALTER TABLE `product_review_summaries` ADD CONSTRAINT `chk_product_review_summaries_hidden` CHECK ((`status` = 'HIDDEN') = (`hiddenAt` IS NOT NULL));
