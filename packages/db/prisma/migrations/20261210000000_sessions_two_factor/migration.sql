-- CreateTable
CREATE TABLE `user_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `secondFactorPending` BOOLEAN NOT NULL DEFAULT false,
    `pendingExpiresAt` DATETIME(3) NULL,
    `twoFactorFailures` INTEGER NOT NULL DEFAULT 0,
    `secondFactorVerifiedAt` DATETIME(3) NULL,
    `secondFactorMethod` VARCHAR(16) NULL,
    `authTime` DATETIME(3) NOT NULL,
    `reauthenticatedAt` DATETIME(3) NULL,
    `successorId` VARCHAR(191) NULL,
    `successorClaimedAt` DATETIME(3) NULL,
    `absoluteExpiresAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `revokeReason` VARCHAR(32) NULL,
    `ipHash` CHAR(64) NULL,
    `userAgent` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_sessions_successorId_key`(`successorId`),
    INDEX `user_sessions_userId_revokedAt_idx`(`userId`, `revokedAt`),
    INDEX `user_sessions_absoluteExpiresAt_idx`(`absoluteExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `two_factor_totps` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `secretCiphertext` VARBINARY(255) NULL,
    `keyId` VARCHAR(64) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `lastUsedStep` BIGINT NULL,
    `pendingSecretCiphertext` VARBINARY(255) NULL,
    `pendingKeyId` VARCHAR(64) NULL,
    `pendingExpiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `two_factor_totps_userId_key`(`userId`),
    INDEX `two_factor_totps_pendingExpiresAt_idx`(`pendingExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recovery_codes` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `keyId` VARCHAR(64) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `recovery_codes_userId_codeHash_key`(`userId`, `codeHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_sessions` ADD CONSTRAINT `user_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `user_sessions` ADD CONSTRAINT `user_sessions_successorId_fkey` FOREIGN KEY (`successorId`) REFERENCES `user_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `two_factor_totps` ADD CONSTRAINT `two_factor_totps_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `recovery_codes` ADD CONSTRAINT `recovery_codes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK constraints (mirrored in docs/architecture/check-constraints.sql)
ALTER TABLE `user_sessions` ADD CONSTRAINT `chk_session_pending`
  CHECK ((`secondFactorPending` = 1) = (`pendingExpiresAt` IS NOT NULL));
ALTER TABLE `user_sessions` ADD CONSTRAINT `chk_session_pending_verified`
  CHECK (NOT (`secondFactorPending` = 1 AND `secondFactorVerifiedAt` IS NOT NULL));
ALTER TABLE `user_sessions` ADD CONSTRAINT `chk_session_failures`
  CHECK (`twoFactorFailures` BETWEEN 0 AND 5);
ALTER TABLE `user_sessions` ADD CONSTRAINT `chk_session_method`
  CHECK ((`secondFactorVerifiedAt` IS NULL) = (`secondFactorMethod` IS NULL));
ALTER TABLE `two_factor_totps` ADD CONSTRAINT `chk_totp_active`
  CHECK (((`secretCiphertext` IS NULL) = (`confirmedAt` IS NULL))
     AND ((`secretCiphertext` IS NULL) = (`keyId` IS NULL))
     AND (`lastUsedStep` IS NULL OR `confirmedAt` IS NOT NULL));
ALTER TABLE `two_factor_totps` ADD CONSTRAINT `chk_totp_pending`
  CHECK (((`pendingSecretCiphertext` IS NULL) = (`pendingExpiresAt` IS NULL))
     AND ((`pendingSecretCiphertext` IS NULL) = (`pendingKeyId` IS NULL)));
ALTER TABLE `two_factor_totps` ADD CONSTRAINT `chk_totp_not_empty`
  CHECK (`secretCiphertext` IS NOT NULL OR `pendingSecretCiphertext` IS NOT NULL);

