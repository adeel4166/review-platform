-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `emailVerifiedAt` DATETIME(3) NULL,
    `passwordHash` VARCHAR(255) NULL,
    `handle` VARCHAR(32) NOT NULL,
    `displayName` VARCHAR(64) NOT NULL,
    `bio` TEXT NULL,
    `locale` VARCHAR(16) NULL,
    `timeZone` VARCHAR(64) NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'BANNED', 'DEACTIVATED', 'DELETED') NOT NULL DEFAULT 'ACTIVE',
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_handle_key`(`handle`),
    INDEX `users_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('MODERATOR', 'SENIOR_MODERATOR', 'ADMIN', 'SUPER_ADMIN') NOT NULL,
    `grantedById` VARCHAR(191) NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reason` VARCHAR(255) NULL,

    INDEX `user_roles_role_idx`(`role`),
    PRIMARY KEY (`userId`, `role`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `categories_slug_key`(`slug`),
    INDEX `categories_parentId_position_idx`(`parentId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(160) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `brandName` VARCHAR(120) NULL,
    `description` TEXT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `gtin` VARCHAR(14) NULL,
    `mpn` VARCHAR(64) NULL,
    `specs` JSON NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'MERGED', 'ARCHIVED', 'REMOVED') NOT NULL DEFAULT 'PENDING',
    `mergedIntoId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `ratingAverage` DECIMAL(3, 2) NULL,
    `ratingCount` INTEGER NOT NULL DEFAULT 0,
    `reviewCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_slug_key`(`slug`),
    UNIQUE INDEX `products_gtin_key`(`gtin`),
    INDEX `products_categoryId_status_idx`(`categoryId`, `status`),
    INDEX `products_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviews` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `rating` TINYINT NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `body` TEXT NOT NULL,
    `incentive` ENUM('NONE', 'FREE_PRODUCT', 'DISCOUNT', 'PAYMENT', 'OTHER') NOT NULL DEFAULT 'NONE',
    `language` VARCHAR(16) NULL,
    `status` ENUM('PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED', 'REMOVED', 'DELETED') NOT NULL DEFAULT 'PENDING',
    `currentVersion` INTEGER NOT NULL DEFAULT 1,
    `publishedVersion` INTEGER NULL,
    `helpfulCount` INTEGER NOT NULL DEFAULT 0,
    `notHelpfulCount` INTEGER NOT NULL DEFAULT 0,
    `commentCount` INTEGER NOT NULL DEFAULT 0,
    `publishedAt` DATETIME(3) NULL,
    `editedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `reviews_productId_status_publishedAt_idx`(`productId`, `status`, `publishedAt`),
    INDEX `reviews_authorId_createdAt_idx`(`authorId`, `createdAt`),
    INDEX `reviews_status_createdAt_idx`(`status`, `createdAt`),
    UNIQUE INDEX `reviews_productId_authorId_key`(`productId`, `authorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `review_revisions` (
    `id` VARCHAR(191) NOT NULL,
    `reviewId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `rating` TINYINT NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `body` TEXT NOT NULL,
    `editorId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'HELD', 'APPROVED', 'REJECTED', 'SUPERSEDED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `review_revisions_reviewId_version_key`(`reviewId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(100) NOT NULL,
    `aggregateId` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `publishedAt` DATETIME(3) NULL,

    INDEX `outbox_events_publishedAt_id_idx`(`publishedAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_grantedById_fkey` FOREIGN KEY (`grantedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_mergedIntoId_fkey` FOREIGN KEY (`mergedIntoId`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_revisions` ADD CONSTRAINT `review_revisions_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `reviews`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_revisions` ADD CONSTRAINT `review_revisions_editorId_fkey` FOREIGN KEY (`editorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK constraints Prisma cannot express (docs/architecture/check-constraints.sql)
ALTER TABLE `reviews` ADD CONSTRAINT `chk_review_rating` CHECK (`rating` BETWEEN 1 AND 5);
ALTER TABLE `review_revisions` ADD CONSTRAINT `chk_review_revision_rating` CHECK (`rating` BETWEEN 1 AND 5);
