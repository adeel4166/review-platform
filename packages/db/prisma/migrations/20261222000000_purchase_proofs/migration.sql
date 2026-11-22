-- AlterTable
ALTER TABLE `reviews` ADD COLUMN `verificationMethod` ENUM('RECEIPT_UPLOAD', 'ORDER_CONFIRMATION', 'MARKETPLACE_ORDER_LINK') NULL,
    ADD COLUMN `verifiedProofId` VARCHAR(191) NULL,
    ADD COLUMN `verifiedPurchaseAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `enforcement_actions` ADD COLUMN `subjectReviewId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `purchase_proofs` (
    `id` VARCHAR(191) NOT NULL,
    `reviewId` VARCHAR(191) NOT NULL,
    `submittedById` VARCHAR(191) NOT NULL,
    `method` ENUM('RECEIPT_UPLOAD', 'ORDER_CONFIRMATION', 'MARKETPLACE_ORDER_LINK') NOT NULL,
    `marketplace` ENUM('AMAZON', 'EBAY', 'ETSY', 'OTHER') NULL,
    `status` ENUM('DRAFT', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'WITHDRAWN') NOT NULL DEFAULT 'DRAFT',
    `openKey` VARCHAR(32) NULL,
    `consentVersion` VARCHAR(16) NOT NULL,
    `consentedAt` DATETIME(3) NOT NULL,
    `submittedAt` DATETIME(3) NULL,
    `slaDueAt` DATETIME(3) NULL,
    `filesReadyAt` DATETIME(3) NULL,
    `redactionMode` ENUM('AUTO', 'FULL_MASK') NULL,
    `redactedAt` DATETIME(3) NULL,
    `assessedAt` DATETIME(3) NULL,
    `aiAssessment` JSON NULL,
    `flags` JSON NULL,
    `merchantName` VARCHAR(120) NULL,
    `purchaseDate` DATE NULL,
    `orderReferenceHash` CHAR(64) NULL,
    `orderReferenceKeyId` TINYINT NULL,
    `fileFingerprint` CHAR(64) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `decisionReasonCode` ENUM('UNREADABLE', 'NOT_A_PURCHASE_DOCUMENT', 'PRODUCT_MISMATCH', 'MERCHANT_UNVERIFIABLE', 'DATE_INVALID', 'DUPLICATE_PROOF', 'SUSPECTED_FORGERY', 'OTHER') NULL,
    `decisionNote` VARCHAR(500) NULL,
    `closeReason` ENUM('DRAFT_ABANDONED', 'SLA_EXPIRED', 'NO_VALID_FILES', 'USER_WITHDRAWN') NULL,
    `closedAt` DATETIME(3) NULL,
    `originalPurgedAt` DATETIME(3) NULL,
    `filesDeleteRequestedAt` DATETIME(3) NULL,
    `filesPurgedAt` DATETIME(3) NULL,
    `retainFilesUntil` DATETIME(3) NULL,
    `legalHold` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `purchase_proofs_openKey_key`(`openKey`),
    INDEX `purchase_proofs_status_filesReadyAt_slaDueAt_idx`(`status`, `filesReadyAt`, `slaDueAt`),
    INDEX `purchase_proofs_reviewId_status_idx`(`reviewId`, `status`),
    INDEX `purchase_proofs_submittedById_createdAt_idx`(`submittedById`, `createdAt`),
    INDEX `purchase_proofs_orderReferenceHash_idx`(`orderReferenceHash`),
    INDEX `purchase_proofs_fileFingerprint_idx`(`fileFingerprint`),
    INDEX `purchase_proofs_retainFilesUntil_idx`(`retainFilesUntil`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_proof_files` (
    `id` VARCHAR(191) NOT NULL,
    `proofId` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `status` ENUM('UPLOADING', 'PROCESSING', 'READY', 'REJECTED', 'FAILED', 'PURGED') NOT NULL DEFAULT 'UPLOADING',
    `declaredMime` VARCHAR(64) NOT NULL,
    `detectedMime` VARCHAR(64) NULL,
    `sizeBytes` INTEGER NOT NULL,
    `storageKey` VARCHAR(255) NOT NULL,
    `sha256` CHAR(64) NULL,
    `perceptualHash` VARCHAR(32) NULL,
    `pageCount` TINYINT NULL,
    `isRedacted` BOOLEAN NOT NULL DEFAULT false,
    `derivedFromId` VARCHAR(191) NULL,
    `failureReason` VARCHAR(64) NULL,
    `purgedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `purchase_proof_files_storageKey_key`(`storageKey`),
    INDEX `purchase_proof_files_proofId_status_idx`(`proofId`, `status`),
    INDEX `purchase_proof_files_sha256_idx`(`sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trust_signals` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type` ENUM('MALWARE_UPLOAD', 'DUPLICATE_PROOF_DETECTED', 'VERIFIED_PURCHASE', 'PROOF_REJECTED_FRAUD') NOT NULL,
    `userId` VARCHAR(32) NOT NULL,
    `sourceType` VARCHAR(32) NOT NULL,
    `sourceId` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `trust_signals_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `trust_signals_type_sourceType_sourceId_userId_key`(`type`, `sourceType`, `sourceId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `reviews_verifiedProofId_key` ON `reviews`(`verifiedProofId`);

-- CreateIndex
CREATE INDEX `reviews_productId_status_verifiedPurchaseAt_idx` ON `reviews`(`productId`, `status`, `verifiedPurchaseAt`);

-- CreateIndex
CREATE INDEX `enforcement_actions_subjectReviewId_type_status_idx` ON `enforcement_actions`(`subjectReviewId`, `type`, `status`);

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_verifiedProofId_fkey` FOREIGN KEY (`verifiedProofId`) REFERENCES `purchase_proofs`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `enforcement_actions` ADD CONSTRAINT `enforcement_actions_subjectReviewId_fkey` FOREIGN KEY (`subjectReviewId`) REFERENCES `reviews`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `purchase_proofs` ADD CONSTRAINT `purchase_proofs_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `reviews`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `purchase_proofs` ADD CONSTRAINT `purchase_proofs_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_proofs` ADD CONSTRAINT `purchase_proofs_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `purchase_proof_files` ADD CONSTRAINT `purchase_proof_files_proofId_fkey` FOREIGN KEY (`proofId`) REFERENCES `purchase_proofs`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `purchase_proof_files` ADD CONSTRAINT `purchase_proof_files_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_proof_files` ADD CONSTRAINT `purchase_proof_files_derivedFromId_fkey` FOREIGN KEY (`derivedFromId`) REFERENCES `purchase_proof_files`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Legacy mirror: MVP `true` values have no provenance (D-A1) and are cleared.
UPDATE `reviews` SET `verifiedBuyer` = 0, `verifiedAt` = NULL, `verifiedOrderId` = NULL WHERE `verifiedBuyer` = 1;

-- Hand-written CHECK constraints (m4-m5-spec 12.4)
ALTER TABLE `reviews` ADD CONSTRAINT `chk_review_verified_label` CHECK ((`verifiedPurchaseAt` IS NULL) = (`verificationMethod` IS NULL) AND (`verifiedPurchaseAt` IS NULL) = (`verifiedProofId` IS NULL));
ALTER TABLE `purchase_proofs` ADD CONSTRAINT `chk_proof_open_key` CHECK ((`status` IN ('DRAFT','PENDING') AND `openKey` = `reviewId`) OR (`status` NOT IN ('DRAFT','PENDING') AND `openKey` IS NULL));
ALTER TABLE `purchase_proofs` ADD CONSTRAINT `chk_proof_decision` CHECK ((`status` IN ('VERIFIED','REJECTED')) = (`reviewedById` IS NOT NULL AND `reviewedAt` IS NOT NULL));
ALTER TABLE `purchase_proofs` ADD CONSTRAINT `chk_proof_reject_reason` CHECK (`status` <> 'REJECTED' OR `decisionReasonCode` IS NOT NULL);
ALTER TABLE `purchase_proofs` ADD CONSTRAINT `chk_proof_close` CHECK ((`status` IN ('EXPIRED','WITHDRAWN')) = (`closeReason` IS NOT NULL));
ALTER TABLE `purchase_proofs` ADD CONSTRAINT `chk_proof_marketplace` CHECK ((`method` = 'MARKETPLACE_ORDER_LINK') = (`marketplace` IS NOT NULL));
