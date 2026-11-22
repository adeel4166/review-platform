-- Rollback of 20270401000000_product_images. Manual (Prisma has no down migrations).
-- Precondition: PRODUCT_IMAGE media rows are removed first (they cannot satisfy reviewId NOT NULL); their public objects must be
-- demoted/deleted by the worker (media.demote) BEFORE this runs, or the bytes are orphaned in the public store.
DROP TABLE `product_images`;
DELETE FROM `media_processing_logs` WHERE `assetId` IN (SELECT `id` FROM `media_assets` WHERE `purpose` = 'PRODUCT_IMAGE');
DELETE FROM `media_assets` WHERE `purpose` = 'PRODUCT_IMAGE';
ALTER TABLE `media_assets` DROP CHECK `chk_media_purpose_owner`;
ALTER TABLE `media_assets` MODIFY `reviewId` VARCHAR(191) NOT NULL;
ALTER TABLE `media_assets` DROP COLUMN `purpose`;
