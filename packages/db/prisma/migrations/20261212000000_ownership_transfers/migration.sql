-- M3b-05: delayed two-party ownership changes (m3b-spec 3, 6.5). Additive. NOT applied without an approved DB_MIGRATION proposal.
CREATE TABLE `seller_ownership_transfers` (
    `id` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `kind` ENUM('ADD_OWNER', 'TRANSFER', 'REMOVE_OWNER') NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `initiatorId` VARCHAR(191) NOT NULL,
    `targetUserId` VARCHAR(191) NOT NULL,
    `initiatorOutcome` ENUM('REMAIN_OWNER', 'BECOME_MANAGER', 'BECOME_RESPONDER', 'REMOVED') NOT NULL DEFAULT 'REMAIN_OWNER',
    `targetOutcome` ENUM('REMAIN_OWNER', 'BECOME_MANAGER', 'BECOME_RESPONDER', 'REMOVED') NULL,
    `openKey` VARCHAR(32) NULL,
    `executeAfter` DATETIME(3) NOT NULL,
    `acceptBy` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `endReason` ENUM('CANCELLED_BY_INITIATOR', 'CANCELLED_BY_OWNER', 'CANCELLED_BY_TARGET', 'CANCELLED_BY_LINK', 'CANCELLED_BY_STAFF', 'CANCELLED_MEMBERSHIP_CHANGED', 'INITIATOR_NOT_OWNER', 'TARGET_NOT_ELIGIBLE', 'TWO_FACTOR_MISSING', 'SELLER_BLOCKED', 'LAST_OWNER') NULL,
    `endedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `seller_ownership_transfers_openKey_key`(`openKey`),
    INDEX `seller_ownership_transfers_sellerId_createdAt_idx`(`sellerId`, `createdAt`),
    INDEX `seller_ownership_transfers_status_executeAfter_idx`(`status`, `executeAfter`),
    INDEX `seller_ownership_transfers_status_acceptBy_idx`(`status`, `acceptBy`),
    INDEX `seller_ownership_transfers_targetUserId_status_idx`(`targetUserId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `seller_transfer_cancel_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `transferId` VARCHAR(191) NOT NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NULL,
    `sentAt` DATETIME(3) NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `seller_transfer_cancel_tokens_tokenHash_key`(`tokenHash`),
    UNIQUE INDEX `seller_transfer_cancel_tokens_transferId_recipientId_key`(`transferId`, `recipientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `seller_ownership_transfers_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `sellers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `seller_ownership_transfers_initiatorId_fkey` FOREIGN KEY (`initiatorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `seller_ownership_transfers_targetUserId_fkey` FOREIGN KEY (`targetUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `seller_ownership_transfers_endedById_fkey` FOREIGN KEY (`endedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `seller_transfer_cancel_tokens` ADD CONSTRAINT `seller_transfer_cancel_tokens_transferId_fkey` FOREIGN KEY (`transferId`) REFERENCES `seller_ownership_transfers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `seller_transfer_cancel_tokens` ADD CONSTRAINT `seller_transfer_cancel_tokens_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_parties` CHECK (`initiatorId` <> `targetUserId`);
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_initiator_outcome` CHECK ((`kind` = 'TRANSFER') = (`initiatorOutcome` <> 'REMAIN_OWNER'));
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_target_outcome` CHECK (((`kind` = 'REMOVE_OWNER') = (`targetOutcome` IS NOT NULL)) AND (`targetOutcome` IS NULL OR `targetOutcome` <> 'REMAIN_OWNER'));
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_open_key` CHECK ((`status` IN ('PENDING','ACCEPTED')) = (`openKey` IS NOT NULL) AND (`openKey` IS NULL OR `openKey` = `sellerId`));
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_accepted` CHECK (`status` NOT IN ('ACCEPTED','COMPLETED') OR `acceptedAt` IS NOT NULL);
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_ended` CHECK ((`status` IN ('COMPLETED','CANCELLED','EXPIRED','FAILED')) = (`endedAt` IS NOT NULL));
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_end_reason` CHECK ((`status` IN ('CANCELLED','FAILED')) = (`endReason` IS NOT NULL));
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_delay` CHECK (TIMESTAMPDIFF(SECOND, `createdAt`, `executeAfter`) >= 259200 AND `acceptBy` > `executeAfter`);
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_completed_after_delay` CHECK (`status` <> 'COMPLETED' OR `endedAt` >= `executeAfter`);
ALTER TABLE `seller_transfer_cancel_tokens` ADD CONSTRAINT `chk_tct_sent` CHECK ((`sentAt` IS NULL OR `tokenHash` IS NOT NULL) AND (`usedAt` IS NULL OR `tokenHash` IS NOT NULL));
