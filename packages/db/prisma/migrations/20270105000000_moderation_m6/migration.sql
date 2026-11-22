-- M6 moderation (ADR-0025). Step 1 of 2: additive. Legacy columns (state, aiConfidence, aiReasons, decisionReason, decidedById, decidedAt, openReportKey) and enum ModerationState are dropped in a follow-up once call sites use status/lane.
-- AlterTable
ALTER TABLE `moderation_cases` ADD COLUMN `aiReason` VARCHAR(500) NULL,
    ADD COLUMN `aiTopCategory` VARCHAR(64) NULL,
    ADD COLUMN `aiVerdict` ENUM('CLEAN', 'VIOLATION', 'UNSURE') NULL,
    ADD COLUMN `appealableUntil` DATETIME(3) NULL,
    ADD COLUMN `assignedToId` VARCHAR(191) NULL,
    ADD COLUMN `configVersion` VARCHAR(32) NULL,
    ADD COLUMN `contentSnapshot` JSON NULL,
    ADD COLUMN `holdExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `lane` ENUM('HOLD', 'POST_REVIEW', 'REPORTED') NULL,
    ADD COLUMN `leaseExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `legalHold` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `mediaAssetId` VARCHAR(191) NULL,
    ADD COLUMN `openKey` VARCHAR(48) NULL,
    ADD COLUMN `outcome` ENUM('APPROVE', 'RESTRICT', 'REMOVE', 'ESCALATE') NULL,
    ADD COLUMN `postReviewBreachedAt` DATETIME(3) NULL,
    ADD COLUMN `postReviewDueAt` DATETIME(3) NULL,
    ADD COLUMN `priority` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `rescanCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `resolutionCode` VARCHAR(64) NULL,
    ADD COLUMN `resolvedAt` DATETIME(3) NULL,
    ADD COLUMN `slaDueAt` DATETIME(3) NULL,
    ADD COLUMN `status` ENUM('OPEN', 'IN_REVIEW', 'ESCALATED', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    MODIFY `subjectType` ENUM('REVIEW', 'SELLER_REPLY', 'MEDIA') NOT NULL DEFAULT 'REVIEW',
    MODIFY `trigger` ENUM('SUBMISSION', 'EDIT', 'USER_REPORT', 'STAFF_FLAG', 'STAFF_INITIATED') NOT NULL DEFAULT 'SUBMISSION';

-- AlterTable
ALTER TABLE `media_assets` ADD COLUMN `appealId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `enforcement_actions` ADD COLUMN `appealableUntil` DATETIME(3) NULL,
    ADD COLUMN `decisionId` VARCHAR(191) NULL,
    ADD COLUMN `strike` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `moderation_decisions` (
    `id` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `transition` VARCHAR(8) NOT NULL,
    `contentVersion` INTEGER NOT NULL,
    `source` ENUM('AI', 'RULE', 'HUMAN') NOT NULL,
    `moderatorId` VARCHAR(191) NULL,
    `outcome` ENUM('APPROVE', 'RESTRICT', 'REMOVE', 'ESCALATE') NOT NULL,
    `verdict` ENUM('CLEAN', 'VIOLATION', 'UNSURE') NULL,
    `reasonCode` VARCHAR(64) NULL,
    `publicReason` TEXT NULL,
    `publicReasonLocale` VARCHAR(16) NOT NULL DEFAULT 'en',
    `labels` JSON NULL,
    `ruleHits` JSON NULL,
    `rationale` VARCHAR(280) NULL,
    `policyVersion` VARCHAR(32) NOT NULL,
    `configVersion` VARCHAR(32) NULL,
    `aiProvider` VARCHAR(64) NULL,
    `aiModel` VARCHAR(128) NULL,
    `failureCode` VARCHAR(32) NULL,
    `latencyMs` INTEGER NULL,
    `bulkOperationId` VARCHAR(32) NULL,
    `approvalRequestId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL,

    INDEX `moderation_decisions_caseId_createdAt_idx`(`caseId`, `createdAt`),
    INDEX `moderation_decisions_moderatorId_createdAt_idx`(`moderatorId`, `createdAt`),
    INDEX `moderation_decisions_bulkOperationId_idx`(`bulkOperationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appeals` (
    `id` VARCHAR(191) NOT NULL,
    `appellantId` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NULL,
    `enforcementActionId` VARCHAR(191) NULL,
    `purchaseProofId` VARCHAR(191) NULL,
    `ownershipClaimId` VARCHAR(191) NULL,
    `contentVersion` INTEGER NULL,
    `statement` TEXT NOT NULL,
    `status` ENUM('SUBMITTED', 'IN_REVIEW', 'UPHELD', 'OVERTURNED', 'PARTIALLY_OVERTURNED', 'WITHDRAWN') NOT NULL DEFAULT 'SUBMITTED',
    `reviewerId` VARCHAR(191) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `decisionNote` TEXT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `slaDueAt` DATETIME(3) NOT NULL,
    `submittedAt` DATETIME(3) NOT NULL,
    `decidedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `appeals_status_priority_slaDueAt_idx`(`status`, `priority`, `slaDueAt`),
    INDEX `appeals_reviewerId_status_idx`(`reviewerId`, `status`),
    UNIQUE INDEX `appeals_appellantId_caseId_key`(`appellantId`, `caseId`),
    UNIQUE INDEX `appeals_appellantId_enforcementActionId_key`(`appellantId`, `enforcementActionId`),
    UNIQUE INDEX `appeals_appellantId_purchaseProofId_key`(`appellantId`, `purchaseProofId`),
    UNIQUE INDEX `appeals_appellantId_ownershipClaimId_key`(`appellantId`, `ownershipClaimId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `moderation_configs` (
    `id` VARCHAR(191) NOT NULL,
    `version` VARCHAR(32) NOT NULL,
    `status` ENUM('DRAFT', 'SHADOW', 'ACTIVE', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
    `config` JSON NOT NULL,
    `checksum` CHAR(64) NOT NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `activatedById` VARCHAR(191) NULL,
    `approvedById` VARCHAR(191) NULL,
    `activatedAt` DATETIME(3) NULL,
    `retiredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `moderation_configs_version_key`(`version`),
    INDEX `moderation_configs_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staff_approval_requests` (
    `id` VARCHAR(191) NOT NULL,
    `kind` ENUM('CONFIG_ACTIVATION', 'ROLE_GRANT', 'TWO_FACTOR_RESET', 'ENFORCEMENT_OVERTURN_MAJOR', 'BREAK_GLASS_REPEAT') NOT NULL,
    `status` ENUM('PENDING', 'EXECUTED', 'REJECTED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `requestedById` VARCHAR(191) NOT NULL,
    `decidedById` VARCHAR(191) NULL,
    `targetKey` VARCHAR(80) NOT NULL,
    `openKey` VARCHAR(80) NULL,
    `payload` JSON NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `note` VARCHAR(500) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `decidedAt` DATETIME(3) NULL,
    `executedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `staff_approval_requests_openKey_key`(`openKey`),
    INDEX `staff_approval_requests_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `staff_approval_requests_kind_status_idx`(`kind`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `break_glass_accesses` (
    `id` VARCHAR(191) NOT NULL,
    `staffId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(64) NOT NULL,
    `proofId` VARCHAR(191) NOT NULL,
    `fileId` VARCHAR(191) NOT NULL,
    `submitterId` VARCHAR(191) NOT NULL,
    `reasonCode` VARCHAR(32) NOT NULL,
    `reasonText` VARCHAR(500) NOT NULL,
    `approvalRequestId` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL,

    INDEX `break_glass_accesses_staffId_createdAt_idx`(`staffId`, `createdAt`),
    INDEX `break_glass_accesses_submitterId_createdAt_idx`(`submitterId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `moderation_bulk_operations` (
    `id` VARCHAR(191) NOT NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `lane` ENUM('HOLD', 'POST_REVIEW', 'REPORTED') NOT NULL,
    `action` VARCHAR(16) NOT NULL,
    `reasonCode` VARCHAR(64) NULL,
    `publicReason` TEXT NULL,
    `size` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `moderation_bulk_items` (
    `bulkOperationId` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `result` ENUM('PENDING', 'APPLIED', 'SKIPPED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `reason` VARCHAR(32) NULL,

    PRIMARY KEY (`bulkOperationId`, `caseId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `moderation_cases_openKey_key` ON `moderation_cases`(`openKey`);

-- CreateIndex
CREATE INDEX `moderation_cases_lane_status_holdExpiresAt_idx` ON `moderation_cases`(`lane`, `status`, `holdExpiresAt`);

-- CreateIndex
CREATE INDEX `moderation_cases_lane_status_postReviewDueAt_idx` ON `moderation_cases`(`lane`, `status`, `postReviewDueAt`);

-- CreateIndex
CREATE INDEX `moderation_cases_lane_status_priority_createdAt_idx` ON `moderation_cases`(`lane`, `status`, `priority`, `createdAt`);

-- CreateIndex
CREATE INDEX `moderation_cases_assignedToId_status_idx` ON `moderation_cases`(`assignedToId`, `status`);

-- CreateIndex
CREATE INDEX `moderation_cases_status_appealableUntil_idx` ON `moderation_cases`(`status`, `appealableUntil`);

-- CreateIndex
CREATE UNIQUE INDEX `moderation_cases_mediaAssetId_version_trigger_seq_key` ON `moderation_cases`(`mediaAssetId`, `version`, `trigger`, `seq`);

-- AddForeignKey
ALTER TABLE `moderation_cases` ADD CONSTRAINT `moderation_cases_mediaAssetId_fkey` FOREIGN KEY (`mediaAssetId`) REFERENCES `media_assets`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `moderation_cases` ADD CONSTRAINT `moderation_cases_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_appealId_fkey` FOREIGN KEY (`appealId`) REFERENCES `appeals`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `moderation_decisions` ADD CONSTRAINT `moderation_decisions_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `moderation_cases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `moderation_decisions` ADD CONSTRAINT `moderation_decisions_moderatorId_fkey` FOREIGN KEY (`moderatorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `appeals` ADD CONSTRAINT `appeals_appellantId_fkey` FOREIGN KEY (`appellantId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appeals` ADD CONSTRAINT `appeals_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appeals` ADD CONSTRAINT `appeals_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `moderation_cases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `appeals` ADD CONSTRAINT `appeals_enforcementActionId_fkey` FOREIGN KEY (`enforcementActionId`) REFERENCES `enforcement_actions`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `appeals` ADD CONSTRAINT `appeals_purchaseProofId_fkey` FOREIGN KEY (`purchaseProofId`) REFERENCES `purchase_proofs`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `appeals` ADD CONSTRAINT `appeals_ownershipClaimId_fkey` FOREIGN KEY (`ownershipClaimId`) REFERENCES `seller_ownership_claims`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `staff_approval_requests` ADD CONSTRAINT `staff_approval_requests_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `staff_approval_requests` ADD CONSTRAINT `staff_approval_requests_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `break_glass_accesses` ADD CONSTRAINT `break_glass_accesses_staffId_fkey` FOREIGN KEY (`staffId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `break_glass_accesses` ADD CONSTRAINT `break_glass_accesses_proofId_fkey` FOREIGN KEY (`proofId`) REFERENCES `purchase_proofs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `moderation_bulk_items` ADD CONSTRAINT `moderation_bulk_items_bulkOperationId_fkey` FOREIGN KEY (`bulkOperationId`) REFERENCES `moderation_bulk_operations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Back-fill (spec 12.2): legacy state -> status/lane. Pre-launch data only (B-1).
UPDATE `moderation_cases` SET `status` = 'RESOLVED', `outcome` = 'APPROVE', `resolvedAt` = COALESCE(`decidedAt`, `updatedAt`) WHERE `state` = 'APPROVED';
UPDATE `moderation_cases` SET `status` = 'RESOLVED', `outcome` = 'REMOVE', `resolvedAt` = COALESCE(`decidedAt`, `updatedAt`), `appealableUntil` = DATE_ADD(COALESCE(`decidedAt`, `updatedAt`), INTERVAL 30 DAY) WHERE `state` = 'REJECTED';
UPDATE `moderation_cases` SET `status` = 'RESOLVED', `resolutionCode` = 'SUPERSEDED', `resolvedAt` = `updatedAt` WHERE `state` = 'SUPERSEDED';
UPDATE `moderation_cases` SET `status` = 'OPEN', `lane` = 'REPORTED', `slaDueAt` = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 48 HOUR), `openKey` = CONCAT('REPORTED:', `openReportKey`) WHERE `state` = 'NEEDS_HUMAN' AND `trigger` = 'USER_REPORT' AND `openReportKey` IS NOT NULL;
UPDATE `moderation_cases` SET `status` = 'OPEN', `lane` = 'HOLD', `holdExpiresAt` = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 168 HOUR), `openKey` = CONCAT('HOLD:', CASE WHEN `reviewId` IS NOT NULL THEN 'R:' ELSE 'S:' END, COALESCE(`reviewId`, `sellerReplyId`)) WHERE `state` = 'NEEDS_HUMAN' AND `trigger` IN ('SUBMISSION','EDIT');

-- Hand-written CHECK constraints (spec 12.4, ADR-0004/0010).
ALTER TABLE `moderation_cases` ADD CONSTRAINT `chk_case_one_subject` CHECK ((`reviewId` IS NOT NULL) + (`sellerReplyId` IS NOT NULL) + (`mediaAssetId` IS NOT NULL) = 1);
ALTER TABLE `moderation_cases` ADD CONSTRAINT `chk_case_hold_expiry` CHECK (`lane` <> 'HOLD' OR `status` = 'RESOLVED' OR `holdExpiresAt` IS NOT NULL);
ALTER TABLE `moderation_cases` ADD CONSTRAINT `chk_case_post_review_due` CHECK (`lane` <> 'POST_REVIEW' OR `status` = 'RESOLVED' OR `postReviewDueAt` IS NOT NULL);
ALTER TABLE `moderation_cases` ADD CONSTRAINT `chk_case_ai_score` CHECK (`aiScore` IS NULL OR `aiScore` BETWEEN 0 AND 1);
ALTER TABLE `moderation_decisions` ADD CONSTRAINT `chk_decision_human` CHECK ((`source` = 'HUMAN') = (`moderatorId` IS NOT NULL));
ALTER TABLE `appeals` ADD CONSTRAINT `chk_appeal_one_target` CHECK ((`caseId` IS NOT NULL) + (`enforcementActionId` IS NOT NULL) + (`purchaseProofId` IS NOT NULL) + (`ownershipClaimId` IS NOT NULL) = 1);
ALTER TABLE `staff_approval_requests` ADD CONSTRAINT `chk_approval_distinct` CHECK (`decidedById` IS NULL OR `decidedById` <> `requestedById`);
ALTER TABLE `staff_approval_requests` ADD CONSTRAINT `chk_approval_open_key` CHECK ((`status` = 'PENDING') = (`openKey` IS NOT NULL));
ALTER TABLE `break_glass_accesses` ADD CONSTRAINT `chk_break_glass_reason` CHECK (CHAR_LENGTH(`reasonText`) BETWEEN 20 AND 500);
-- chk_case_open_key ((status = 'RESOLVED') = (openKey IS NULL)) is added with the legacy-column drop (step 2): until then legacy
-- cases that never set openKey would violate it. App DB role: INSERT/SELECT only on moderation_decisions and audit_logs.
