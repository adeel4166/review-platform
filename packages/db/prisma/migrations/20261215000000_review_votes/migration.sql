-- CreateTable
CREATE TABLE `review_votes` (
    `reviewId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `value` ENUM('HELPFUL', 'NOT_HELPFUL') NOT NULL,
    `ipHash` CHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `review_votes_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`reviewId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `review_votes` ADD CONSTRAINT `review_votes_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `reviews`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_votes` ADD CONSTRAINT `review_votes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
