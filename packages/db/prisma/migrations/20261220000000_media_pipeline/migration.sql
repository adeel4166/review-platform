-- M5-01 media pipeline (m4-m5-spec 10.1, ADR-0023). Additive only.
ALTER TABLE `media_assets`
    ADD COLUMN `kind` ENUM('IMAGE', 'VIDEO') NOT NULL DEFAULT 'IMAGE',
    ADD COLUMN `bucket` ENUM('INGEST', 'PRIVATE', 'PUBLIC') NOT NULL DEFAULT 'INGEST',
    ADD COLUMN `sha256` VARCHAR(64) NULL,
    ADD COLUMN `virusScannedAt` DATETIME(3) NULL,
    ADD COLUMN `metadataStripped` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `moderationClearedAt` DATETIME(3) NULL,
    ADD COLUMN `promotedAt` DATETIME(3) NULL,
    ADD COLUMN `videoKey` VARCHAR(255) NULL,
    ADD COLUMN `posterKey` VARCHAR(255) NULL;

-- Existing READY rows already live in the private bucket (MVP variants).
UPDATE `media_assets` SET `bucket` = 'PRIVATE' WHERE `status` = 'READY';

CREATE TABLE `media_processing_logs` (
    `id` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `step` VARCHAR(32) NOT NULL,
    `outcome` VARCHAR(32) NOT NULL,
    `engineVersion` VARCHAR(64) NULL,
    `signatureVersion` VARCHAR(32) NULL,
    `detail` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `media_processing_logs_assetId_createdAt_idx`(`assetId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `banned_media_hashes` (
    `sha256` VARCHAR(64) NOT NULL,
    `reason` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`sha256`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `media_processing_logs` ADD CONSTRAINT `media_processing_logs_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `media_assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- MED-037: a public object requires scan, metadata strip and a moderation clearance, enforced by the database.
ALTER TABLE `media_assets` ADD CONSTRAINT `chk_media_public_bucket`
  CHECK (`bucket` <> 'PUBLIC'
     OR (`status` = 'READY' AND `virusScannedAt` IS NOT NULL
         AND `metadataStripped` = 1 AND `moderationClearedAt` IS NOT NULL AND `promotedAt` IS NOT NULL));
