-- AlterTable
ALTER TABLE `products` ADD COLUMN `sellerId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `sellers` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `nameSkeleton` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `websiteUrl` VARCHAR(2048) NULL,
    `countryCode` CHAR(2) NULL,
    `status` ENUM('UNVERIFIED', 'PENDING_VERIFICATION', 'VERIFIED', 'SUSPENDED', 'CLOSED') NOT NULL DEFAULT 'UNVERIFIED',
    `verifiedClaimId` VARCHAR(191) NULL,
    `verifiedDomain` VARCHAR(253) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `nameReviewFlag` BOOLEAN NOT NULL DEFAULT false,
    `closedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sellers_slug_key`(`slug`),
    INDEX `sellers_status_idx`(`status`),
    INDEX `sellers_nameSkeleton_idx`(`nameSkeleton`),
    UNIQUE INDEX `sellers_verifiedClaimId_id_key`(`verifiedClaimId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seller_members` (
    `sellerId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'MANAGER', 'RESPONDER') NOT NULL,
    `invitationId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `seller_members_invitationId_key`(`invitationId`),
    INDEX `seller_members_userId_idx`(`userId`),
    INDEX `seller_members_sellerId_role_idx`(`sellerId`, `role`),
    PRIMARY KEY (`sellerId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seller_invitations` (
    `id` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `role` ENUM('OWNER', 'MANAGER', 'RESPONDER') NOT NULL,
    `tokenHash` CHAR(64) NULL,
    `invitedById` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `sentAt` DATETIME(3) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `acceptedById` VARCHAR(191) NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `seller_invitations_tokenHash_key`(`tokenHash`),
    INDEX `seller_invitations_sellerId_email_idx`(`sellerId`, `email`),
    INDEX `seller_invitations_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seller_ownership_claims` (
    `id` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `scope` ENUM('SELLER', 'PRODUCT') NOT NULL,
    `productId` VARCHAR(191) NULL,
    `method` ENUM('DNS_TXT', 'META_TAG', 'BUSINESS_EMAIL_DOMAIN', 'DOCUMENT', 'MARKETPLACE') NOT NULL,
    `status` ENUM('PENDING', 'VERIFIED', 'REJECTED', 'CONTESTED', 'EXPIRED', 'REVOKED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
    `domain` VARCHAR(253) NULL,
    `challengeValue` VARCHAR(64) NULL,
    `challengeExpiresAt` DATETIME(3) NULL,
    `evidenceUrl` VARCHAR(2048) NULL,
    `requiresHumanReview` BOOLEAN NOT NULL DEFAULT false,
    `humanReviewReason` VARCHAR(32) NULL,
    `requiredApprovals` INTEGER NOT NULL DEFAULT 1,
    `conflictClaimId` VARCHAR(191) NULL,
    `contestResponseDueAt` DATETIME(3) NULL,
    `infoRequestedAt` DATETIME(3) NULL,
    `checkAttempts` INTEGER NOT NULL DEFAULT 0,
    `lastCheckAt` DATETIME(3) NULL,
    `lastCheckOutcome` ENUM('PASS', 'NOT_FOUND', 'MISMATCH', 'FETCH_BLOCKED', 'FETCH_ERROR', 'DNS_ERROR') NULL,
    `nextCheckAt` DATETIME(3) NULL,
    `spotCheckRequired` BOOLEAN NOT NULL DEFAULT false,
    `spotCheckedAt` DATETIME(3) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verifiedUntil` DATETIME(3) NULL,
    `renewalRequestedAt` DATETIME(3) NULL,
    `reverifyFailingSince` DATETIME(3) NULL,
    `graceEndsAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `endReason` ENUM('CHALLENGE_TIMEOUT', 'INFO_TIMEOUT', 'VALIDITY_ENDED', 'REVERIFY_FAILED', 'CONTEST_LOST', 'SPOT_CHECK_FAILED', 'STAFF_REVOKED') NULL,
    `activeKey` VARCHAR(320) NULL,
    `verifiedDomainKey` VARCHAR(253) NULL,
    `submittedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `seller_ownership_claims_challengeValue_key`(`challengeValue`),
    UNIQUE INDEX `seller_ownership_claims_activeKey_key`(`activeKey`),
    UNIQUE INDEX `seller_ownership_claims_verifiedDomainKey_key`(`verifiedDomainKey`),
    INDEX `seller_ownership_claims_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `seller_ownership_claims_sellerId_status_idx`(`sellerId`, `status`),
    INDEX `seller_ownership_claims_status_nextCheckAt_idx`(`status`, `nextCheckAt`),
    INDEX `seller_ownership_claims_status_graceEndsAt_idx`(`status`, `graceEndsAt`),
    INDEX `seller_ownership_claims_status_verifiedUntil_idx`(`status`, `verifiedUntil`),
    INDEX `seller_ownership_claims_domain_idx`(`domain`),
    INDEX `seller_ownership_claims_productId_idx`(`productId`),
    UNIQUE INDEX `seller_ownership_claims_id_sellerId_key`(`id`, `sellerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seller_claim_decisions` (
    `id` VARCHAR(191) NOT NULL,
    `claimId` VARCHAR(191) NOT NULL,
    `source` ENUM('RULE', 'STAFF') NOT NULL,
    `reviewerId` VARCHAR(191) NULL,
    `outcome` ENUM('APPROVE', 'REJECT', 'REQUEST_INFO', 'RENEW', 'SPOT_CHECK_PASS', 'SPOT_CHECK_FAIL', 'REVOKE') NOT NULL,
    `reasonCode` VARCHAR(64) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `seller_claim_decisions_claimId_createdAt_idx`(`claimId`, `createdAt`),
    INDEX `seller_claim_decisions_reviewerId_createdAt_idx`(`reviewerId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enforcement_actions` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('WARNING', 'CONTENT_REMOVAL', 'POSTING_RESTRICTION', 'VOTING_RESTRICTION', 'VERIFIED_LABEL_REVOKED', 'SUSPENSION', 'BAN', 'SELLER_REPLY_RESTRICTION', 'SELLER_SUSPENSION') NOT NULL,
    `status` ENUM('ACTIVE', 'EXPIRED', 'REVOKED', 'OVERTURNED') NOT NULL DEFAULT 'ACTIVE',
    `subjectUserId` VARCHAR(191) NULL,
    `subjectSellerId` VARCHAR(191) NULL,
    `caseId` VARCHAR(191) NULL,
    `reasonCode` VARCHAR(64) NOT NULL,
    `publicReason` TEXT NOT NULL,
    `publicReasonLocale` VARCHAR(16) NOT NULL DEFAULT 'en',
    `internalNote` TEXT NULL,
    `issuedById` VARCHAR(191) NULL,
    `startsAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endsAt` DATETIME(3) NULL,
    `revokedById` VARCHAR(191) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `enforcement_actions_subjectUserId_status_idx`(`subjectUserId`, `status`),
    INDEX `enforcement_actions_subjectSellerId_status_idx`(`subjectSellerId`, `status`),
    INDEX `enforcement_actions_status_endsAt_idx`(`status`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `products_sellerId_idx` ON `products`(`sellerId`);

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `sellers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sellers` ADD CONSTRAINT `sellers_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sellers` ADD CONSTRAINT `sellers_verifiedClaimId_id_fkey` FOREIGN KEY (`verifiedClaimId`, `id`) REFERENCES `seller_ownership_claims`(`id`, `sellerId`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `seller_members` ADD CONSTRAINT `seller_members_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `sellers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seller_members` ADD CONSTRAINT `seller_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seller_members` ADD CONSTRAINT `seller_members_invitationId_fkey` FOREIGN KEY (`invitationId`) REFERENCES `seller_invitations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seller_invitations` ADD CONSTRAINT `seller_invitations_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `sellers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `seller_invitations` ADD CONSTRAINT `seller_invitations_invitedById_fkey` FOREIGN KEY (`invitedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `seller_invitations` ADD CONSTRAINT `seller_invitations_acceptedById_fkey` FOREIGN KEY (`acceptedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `seller_invitations` ADD CONSTRAINT `seller_invitations_revokedById_fkey` FOREIGN KEY (`revokedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `seller_ownership_claims_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `sellers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `seller_ownership_claims_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `seller_ownership_claims_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `seller_ownership_claims_conflictClaimId_fkey` FOREIGN KEY (`conflictClaimId`) REFERENCES `seller_ownership_claims`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `seller_claim_decisions` ADD CONSTRAINT `seller_claim_decisions_claimId_fkey` FOREIGN KEY (`claimId`) REFERENCES `seller_ownership_claims`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `seller_claim_decisions` ADD CONSTRAINT `seller_claim_decisions_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `enforcement_actions` ADD CONSTRAINT `enforcement_actions_subjectUserId_fkey` FOREIGN KEY (`subjectUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `enforcement_actions` ADD CONSTRAINT `enforcement_actions_subjectSellerId_fkey` FOREIGN KEY (`subjectSellerId`) REFERENCES `sellers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `enforcement_actions` ADD CONSTRAINT `enforcement_actions_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `moderation_cases`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enforcement_actions` ADD CONSTRAINT `enforcement_actions_issuedById_fkey` FOREIGN KEY (`issuedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enforcement_actions` ADD CONSTRAINT `enforcement_actions_revokedById_fkey` FOREIGN KEY (`revokedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- CHECK constraints (MySQL 8.0.16+; spec §2.4). None uses a column carrying a CASCADE / SET NULL FK (ER 3823).
-- SEL-011: a seller is VERIFIED only with a verified claim reference. The claim being SELLER-scope and VERIFIED is a
-- service invariant (recomputeSeller) plus the daily consistency sweeper; the composite FK pins the claim to this seller.
ALTER TABLE `sellers` ADD CONSTRAINT `chk_seller_verified_claim`
  CHECK (`status` <> 'VERIFIED' OR (`verifiedClaimId` IS NOT NULL AND `verifiedAt` IS NOT NULL));
ALTER TABLE `sellers` ADD CONSTRAINT `chk_seller_verified_pair`
  CHECK ((`verifiedClaimId` IS NULL) = (`verifiedAt` IS NULL) AND (`verifiedDomain` IS NULL OR `verifiedClaimId` IS NOT NULL));
ALTER TABLE `sellers` ADD CONSTRAINT `chk_seller_closed`
  CHECK ((`status` = 'CLOSED') = (`closedAt` IS NOT NULL));

-- SEL-007 / SEL-017: no invitation grants OWNER; single use; a token exists before it is sent or accepted.
ALTER TABLE `seller_invitations` ADD CONSTRAINT `chk_invitation_role` CHECK (`role` IN ('MANAGER','RESPONDER'));
ALTER TABLE `seller_invitations` ADD CONSTRAINT `chk_invitation_accepted`
  CHECK ((`acceptedAt` IS NULL) = (`acceptedById` IS NULL) AND (`acceptedAt` IS NULL OR `tokenHash` IS NOT NULL));
ALTER TABLE `seller_invitations` ADD CONSTRAINT `chk_invitation_single_end`
  CHECK (NOT (`acceptedAt` IS NOT NULL AND `revokedAt` IS NOT NULL));
ALTER TABLE `seller_invitations` ADD CONSTRAINT `chk_invitation_sent` CHECK (`sentAt` IS NULL OR `tokenHash` IS NOT NULL);

ALTER TABLE `enforcement_actions` ADD CONSTRAINT `chk_enforcement_one_subject`
  CHECK ((`subjectUserId` IS NOT NULL) + (`subjectSellerId` IS NOT NULL) = 1);

ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_product_scope` CHECK ((`scope` = 'PRODUCT') = (`productId` IS NOT NULL));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_product_method` CHECK (`scope` <> 'PRODUCT' OR `method` IN ('DOCUMENT','MARKETPLACE'));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_domain_method` CHECK (`method` NOT IN ('DNS_TXT','META_TAG','BUSINESS_EMAIL_DOMAIN') OR `domain` IS NOT NULL);
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_challenge` CHECK (`method` NOT IN ('DNS_TXT','META_TAG','MARKETPLACE') OR (`challengeValue` IS NOT NULL AND `challengeExpiresAt` IS NOT NULL));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_marketplace_url` CHECK (`method` <> 'MARKETPLACE' OR `evidenceUrl` IS NOT NULL);
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_approvals` CHECK (`requiredApprovals` BETWEEN 1 AND 2);
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_verified_fields` CHECK (`status` <> 'VERIFIED' OR (`verifiedAt` IS NOT NULL AND `verifiedUntil` IS NOT NULL AND `verifiedUntil` > `verifiedAt`));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_ended` CHECK ((`status` IN ('REJECTED','EXPIRED','REVOKED','WITHDRAWN')) = (`endedAt` IS NOT NULL));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_end_reason` CHECK ((`status` IN ('EXPIRED','REVOKED')) = (`endReason` IS NOT NULL));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_grace` CHECK ((`graceEndsAt` IS NULL) = (`reverifyFailingSince` IS NULL) AND (`graceEndsAt` IS NULL OR `status` = 'VERIFIED'));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_contested` CHECK (`status` <> 'CONTESTED' OR (`conflictClaimId` IS NOT NULL AND `contestResponseDueAt` IS NOT NULL AND `requiredApprovals` = 2));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_active_key` CHECK ((`status` IN ('PENDING','CONTESTED','VERIFIED')) = (`activeKey` IS NOT NULL));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_verified_domain_key` CHECK (`verifiedDomainKey` IS NULL OR (`status` = 'VERIFIED' AND `verifiedDomainKey` = `domain`));
ALTER TABLE `seller_claim_decisions` ADD CONSTRAINT `chk_claim_decision_source` CHECK ((`source` = 'RULE') = (`reviewerId` IS NULL));
