-- M8 (ADR-0033, spec 22.2): ErasureRequest. Authored for review; applied only with an approved DB_MIGRATION proposal.
CREATE TABLE `erasure_requests` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL,
    `steps` JSON NOT NULL,
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `erasure_requests_userId_key`(`userId`),
    INDEX `erasure_requests_completedAt_idx`(`completedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `erasure_requests` ADD CONSTRAINT `erasure_requests_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
