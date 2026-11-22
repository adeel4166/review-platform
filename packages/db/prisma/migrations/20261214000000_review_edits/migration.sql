-- DropForeignKey
ALTER TABLE `moderation_cases` DROP FOREIGN KEY `moderation_cases_reviewId_fkey`;

-- DropForeignKey
ALTER TABLE `moderation_cases` DROP FOREIGN KEY `moderation_cases_sellerReplyId_fkey`;

-- DropIndex
DROP INDEX `moderation_cases_reviewId_version_key` ON `moderation_cases`;

-- DropIndex
DROP INDEX `moderation_cases_sellerReplyId_version_key` ON `moderation_cases`;

-- AlterTable
ALTER TABLE `review_revisions` ADD COLUMN `incentive` ENUM('NONE', 'FREE_PRODUCT', 'DISCOUNT', 'PAYMENT', 'OTHER') NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE `moderation_cases` ADD COLUMN `openReportKey` VARCHAR(40) NULL,
    ADD COLUMN `reportCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `reportWeight` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `seq` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `trigger` ENUM('SUBMISSION', 'EDIT', 'USER_REPORT') NOT NULL DEFAULT 'SUBMISSION',
    MODIFY `state` ENUM('PENDING', 'AI_REVIEW', 'NEEDS_HUMAN', 'APPROVED', 'REJECTED', 'SUPERSEDED') NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE `media_assets` ADD COLUMN `attachedInVersion` INTEGER NULL,
    ADD COLUMN `detachedInVersion` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `moderation_cases_openReportKey_key` ON `moderation_cases`(`openReportKey`);

-- CreateIndex
CREATE INDEX `moderation_cases_trigger_state_reportWeight_idx` ON `moderation_cases`(`trigger`, `state`, `reportWeight`);

-- CreateIndex
CREATE UNIQUE INDEX `moderation_cases_reviewId_version_trigger_seq_key` ON `moderation_cases`(`reviewId`, `version`, `trigger`, `seq`);

-- CreateIndex
CREATE UNIQUE INDEX `moderation_cases_sellerReplyId_version_trigger_seq_key` ON `moderation_cases`(`sellerReplyId`, `version`, `trigger`, `seq`);

-- AddForeignKey
ALTER TABLE `moderation_cases` ADD CONSTRAINT `moderation_cases_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `reviews`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Existing media belongs to the review version current at upload time (MVP media is PENDING-only).
UPDATE `media_assets` m JOIN `reviews` r ON r.`id` = m.`reviewId` SET m.`attachedInVersion` = r.`currentVersion` WHERE m.`attachedInVersion` IS NULL;

-- Hand-written CHECK constraints (m4-m5-spec 12.4)
ALTER TABLE `moderation_cases` ADD CONSTRAINT `chk_case_report_key` CHECK (`openReportKey` IS NULL OR (`trigger` = 'USER_REPORT' AND `state` = 'NEEDS_HUMAN'));
ALTER TABLE `moderation_cases` ADD CONSTRAINT `chk_case_seq` CHECK (`trigger` = 'USER_REPORT' OR `seq` = 1);
ALTER TABLE `media_assets` ADD CONSTRAINT `chk_media_versions` CHECK (`detachedInVersion` IS NULL OR (`attachedInVersion` IS NOT NULL AND `detachedInVersion` > `attachedInVersion`));
