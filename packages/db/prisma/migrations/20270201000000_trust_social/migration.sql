-- M7 trust, social, comparison (m6-m8-spec 21.2). Additive; messaging tables are intentionally absent (SCOPE-001, Phase 2).

-- Lane / trigger for vote-anomaly INTEGRITY cases
ALTER TABLE `moderation_cases`
    MODIFY `lane` ENUM('HOLD', 'POST_REVIEW', 'REPORTED', 'INTEGRITY') NULL,
    MODIFY `trigger` ENUM('SUBMISSION', 'EDIT', 'USER_REPORT', 'STAFF_FLAG', 'STAFF_INITIATED', 'VOTE_ANOMALY') NOT NULL DEFAULT 'SUBMISSION';

-- Trust signals v2
ALTER TABLE `trust_signals`
    MODIFY `type` ENUM('MALWARE_UPLOAD', 'DUPLICATE_PROOF_DETECTED', 'VERIFIED_PURCHASE', 'PROOF_REJECTED_FRAUD', 'REVIEW_PUBLISHED', 'REVIEW_REMOVED', 'HELPFUL_VOTE_RECEIVED', 'NOT_HELPFUL_VOTE_RECEIVED', 'REPORT_UPHELD', 'REPORT_REJECTED', 'CONTENT_ACTIONED_AGAINST', 'ENFORCEMENT_ACTION', 'APPEAL_OVERTURNED', 'SELLER_REPLY_PUBLISHED', 'SELLER_REPLY_REMOVED', 'VELOCITY_ANOMALY', 'NEAR_DUPLICATE_TEXT', 'LINKED_ACCOUNT_SUSPECTED') NOT NULL,
    MODIFY `userId` VARCHAR(32) NULL,
    ADD COLUMN `sellerId` VARCHAR(32) NULL,
    ADD COLUMN `subjectKey` VARCHAR(40) NULL,
    ADD COLUMN `value` DECIMAL(8, 2) NOT NULL DEFAULT 1,
    ADD COLUMN `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `voidedAt` DATETIME(3) NULL;
UPDATE `trust_signals` SET `subjectKey` = CONCAT('U:', `userId`), `occurredAt` = `createdAt` WHERE `subjectKey` IS NULL;
CREATE UNIQUE INDEX `trust_signals_type_sourceType_sourceId_subjectKey_key` ON `trust_signals`(`type`, `sourceType`, `sourceId`, `subjectKey`);
CREATE INDEX `trust_signals_subjectKey_occurredAt_idx` ON `trust_signals`(`subjectKey`, `occurredAt`);
ALTER TABLE `trust_signals` ADD CONSTRAINT `chk_trust_signal_subject` CHECK (
    (`userId` IS NOT NULL) + (`sellerId` IS NOT NULL) = 1
    AND (`subjectKey` IS NULL OR `subjectKey` = CONCAT('U:', `userId`) OR `subjectKey` = CONCAT('S:', `sellerId`)));

-- Cached scores
ALTER TABLE `users`
    ADD COLUMN `trustScore` DECIMAL(5, 2) NULL,
    ADD COLUMN `trustBand` ENUM('NEW', 'LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'NEW',
    ADD COLUMN `trustComputedAt` DATETIME(3) NULL,
    ADD COLUMN `handleChangedAt` DATETIME(3) NULL;
ALTER TABLE `sellers`
    ADD COLUMN `trustScore` DECIMAL(5, 2) NULL,
    ADD COLUMN `trustBand` ENUM('NEW', 'LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'LOW',
    ADD COLUMN `trustComputedAt` DATETIME(3) NULL;

-- Votes, reviews, products
ALTER TABLE `review_votes`
    ADD COLUMN `weight` DECIMAL(3, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `frozen` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `review_votes` ADD CONSTRAINT `chk_vote_weight` CHECK (`weight` BETWEEN 0 AND 1.5);
ALTER TABLE `reviews`
    ADD COLUMN `helpfulWeighted` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `votesFrozenAt` DATETIME(3) NULL,
    ADD COLUMN `aggregateExcludedAt` DATETIME(3) NULL;
CREATE INDEX `reviews_productId_createdAt_idx` ON `reviews`(`productId`, `createdAt`);
ALTER TABLE `products`
    ADD COLUMN `verifiedRatingAverage` DECIMAL(3, 2) NULL,
    ADD COLUMN `verifiedRatingCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `ratingHistogram` JSON NULL,
    ADD COLUMN `aggregateComputedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `trust_score_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `subjectUserId` VARCHAR(32) NULL,
    `subjectSellerId` VARCHAR(32) NULL,
    `score` DECIMAL(5, 2) NOT NULL,
    `band` ENUM('NEW', 'LOW', 'MEDIUM', 'HIGH') NOT NULL,
    `algorithmVersion` VARCHAR(32) NOT NULL,
    `components` JSON NOT NULL,
    `computedAt` DATETIME(3) NOT NULL,

    INDEX `trust_score_snapshots_subjectUserId_computedAt_idx`(`subjectUserId`, `computedAt`),
    INDEX `trust_score_snapshots_subjectSellerId_computedAt_idx`(`subjectSellerId`, `computedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `trust_score_snapshots` ADD CONSTRAINT `chk_snapshot_one_subject` CHECK ((`subjectUserId` IS NOT NULL) + (`subjectSellerId` IS NOT NULL) = 1);

CREATE TABLE `review_fingerprints` (
    `reviewId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `minhash` VARBINARY(512) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`reviewId`, `version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `review_lsh_buckets` (
    `band` TINYINT NOT NULL,
    `bucket` CHAR(16) NOT NULL,
    `reviewId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,

    INDEX `review_lsh_buckets_reviewId_idx`(`reviewId`),
    PRIMARY KEY (`band`, `bucket`, `reviewId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `product_bursts` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `lastReviewAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `reviewCount` INTEGER NOT NULL,
    `lowTrustCount` INTEGER NOT NULL,

    INDEX `product_bursts_productId_endsAt_idx`(`productId`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `follows` (
    `id` VARCHAR(191) NOT NULL,
    `followerId` VARCHAR(191) NOT NULL,
    `targetType` ENUM('USER', 'SELLER', 'PRODUCT') NOT NULL,
    `followedUserId` VARCHAR(191) NULL,
    `followedSellerId` VARCHAR(191) NULL,
    `followedProductId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `follows_followerId_followedUserId_key`(`followerId`, `followedUserId`),
    UNIQUE INDEX `follows_followerId_followedSellerId_key`(`followerId`, `followedSellerId`),
    UNIQUE INDEX `follows_followerId_followedProductId_key`(`followerId`, `followedProductId`),
    INDEX `follows_followedUserId_idx`(`followedUserId`),
    INDEX `follows_followedSellerId_idx`(`followedSellerId`),
    INDEX `follows_followedProductId_idx`(`followedProductId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- chk_follow_one_target (exactly one followed* column, matching targetType) is NOT a DB CHECK: MySQL 8 error 3823 forbids
-- CHECKs on columns used by an FK with ON DELETE CASCADE. Enforced where follows are written (apps/web/src/server/social.ts).
-- chk_follow_not_self is NOT a DB CHECK: MySQL 8 (error 3823) forbids CHECKs on columns used by an FK with ON DELETE CASCADE,
-- and the cascade is required for account erasure. Enforced in app code: packages/core/src/social.ts (SELF_FOLLOW).

CREATE TABLE `user_blocks` (
    `blockerId` VARCHAR(191) NOT NULL,
    `blockedId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_blocks_blockedId_idx`(`blockedId`),
    PRIMARY KEY (`blockerId`, `blockedId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- chk_block_not_self: same MySQL 3823 limitation (ON DELETE CASCADE FKs); enforced in apps/web/src/server/social.ts (self_block).

CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `type` ENUM('CONTENT_HELD', 'CONTENT_REJECTED', 'CONTENT_REMOVED', 'CONTENT_RESTORED', 'MEDIA_REJECTED', 'APPEAL_RECEIVED', 'APPEAL_DECIDED', 'ENFORCEMENT_ISSUED', 'SECURITY_ALERT', 'PROOF_VERIFIED', 'PROOF_REJECTED', 'VERIFIED_LABEL_REVOKED', 'REVIEW_PUBLISHED', 'REVIEW_VOTED_HELPFUL', 'SELLER_REPLIED', 'NEW_FOLLOWER', 'FOLLOWED_PRODUCT_REVIEWED', 'REPORT_RESOLVED', 'CLAIM_VERIFIED', 'CLAIM_REJECTED', 'SYSTEM_ANNOUNCEMENT') NOT NULL,
    `entityType` VARCHAR(50) NULL,
    `entityId` VARCHAR(191) NULL,
    `data` JSON NULL,
    `groupKey` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NULL,
    `emailedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_recipientId_createdAt_idx`(`recipientId`, `createdAt`),
    INDEX `notifications_recipientId_readAt_idx`(`recipientId`, `readAt`),
    UNIQUE INDEX `notifications_recipientId_groupKey_key`(`recipientId`, `groupKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notification_preferences` (
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('CONTENT_HELD', 'CONTENT_REJECTED', 'CONTENT_REMOVED', 'CONTENT_RESTORED', 'MEDIA_REJECTED', 'APPEAL_RECEIVED', 'APPEAL_DECIDED', 'ENFORCEMENT_ISSUED', 'SECURITY_ALERT', 'PROOF_VERIFIED', 'PROOF_REJECTED', 'VERIFIED_LABEL_REVOKED', 'REVIEW_PUBLISHED', 'REVIEW_VOTED_HELPFUL', 'SELLER_REPLIED', 'NEW_FOLLOWER', 'FOLLOWED_PRODUCT_REVIEWED', 'REPORT_RESOLVED', 'CLAIM_VERIFIED', 'CLAIM_REJECTED', 'SYSTEM_ANNOUNCEMENT') NOT NULL,
    `channel` ENUM('IN_APP', 'EMAIL') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`userId`, `type`, `channel`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `follows` ADD CONSTRAINT `follows_followerId_fkey` FOREIGN KEY (`followerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `follows` ADD CONSTRAINT `follows_followedUserId_fkey` FOREIGN KEY (`followedUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `user_blocks` ADD CONSTRAINT `user_blocks_blockerId_fkey` FOREIGN KEY (`blockerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `user_blocks` ADD CONSTRAINT `user_blocks_blockedId_fkey` FOREIGN KEY (`blockedId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
