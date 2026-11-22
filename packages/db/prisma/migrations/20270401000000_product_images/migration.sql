-- V3-04 (ADR-0034 D11): product images. Authored for review; applied only with an approved DB_MIGRATION proposal.
-- Reversible: see down.sql in this directory (Prisma does not run it; operators run it by hand, then `prisma migrate resolve --rolled-back`).

-- media_assets: purpose + nullable reviewId (backward compatible for readers; existing rows default to REVIEW).
ALTER TABLE `media_assets` ADD COLUMN `purpose` ENUM('REVIEW', 'PRODUCT_IMAGE') NOT NULL DEFAULT 'REVIEW';
ALTER TABLE `media_assets` MODIFY `reviewId` VARCHAR(191) NULL;
ALTER TABLE `media_assets` ADD CONSTRAINT `chk_media_purpose_owner`
  CHECK ((`purpose` = 'REVIEW' AND `reviewId` IS NOT NULL)
      OR (`purpose` = 'PRODUCT_IMAGE' AND `reviewId` IS NULL AND `kind` = 'IMAGE'));

CREATE TABLE `product_images` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `mediaAssetId` VARCHAR(191) NOT NULL,
    `publicId` VARCHAR(255) NULL,
    `format` VARCHAR(8) NOT NULL DEFAULT 'webp',
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `dominantColor` CHAR(7) NULL,
    `alt` VARCHAR(250) NOT NULL,
    `position` SMALLINT NOT NULL DEFAULT 0,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `primaryProductId` VARCHAR(191) GENERATED ALWAYS AS (CASE WHEN `isPrimary` THEN `productId` END) STORED NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `product_images_mediaAssetId_key`(`mediaAssetId`),
    UNIQUE INDEX `product_images_primaryProductId_key`(`primaryProductId`),
    INDEX `product_images_productId_publishedAt_position_idx`(`productId`, `publishedAt`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `product_images` ADD CONSTRAINT `product_images_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_mediaAssetId_fkey` FOREIGN KEY (`mediaAssetId`) REFERENCES `media_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `product_images` ADD CONSTRAINT `chk_product_images_position` CHECK (`position` BETWEEN 0 AND 11);
ALTER TABLE `product_images` ADD CONSTRAINT `chk_product_images_alt` CHECK (CHAR_LENGTH(TRIM(`alt`)) > 0);
ALTER TABLE `product_images` ADD CONSTRAINT `chk_product_images_published`
  CHECK (`publishedAt` IS NULL OR (`publicId` IS NOT NULL AND `width` > 0 AND `height` > 0));
ALTER TABLE `product_images` ADD CONSTRAINT `chk_product_images_color`
  CHECK (`dominantColor` IS NULL OR `dominantColor` REGEXP '^#[0-9a-f]{6}$');
