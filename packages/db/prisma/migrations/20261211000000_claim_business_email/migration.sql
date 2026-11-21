-- M3b-06/M3b-05 prerequisite: BUSINESS_EMAIL_DOMAIN claims (m3b-spec 4.8, 6.5). Additive. NOT applied without an approved DB_MIGRATION proposal.
ALTER TABLE `seller_ownership_claims` ADD COLUMN `businessEmail` VARCHAR(254) NULL;
ALTER TABLE `email_verification_tokens` ADD COLUMN `claimId` VARCHAR(191) NULL;
CREATE INDEX `email_verification_tokens_claimId_idx` ON `email_verification_tokens`(`claimId`);
ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `email_verification_tokens_claimId_fkey` FOREIGN KEY (`claimId`) REFERENCES `seller_ownership_claims`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_business_email_method`
  CHECK (`method` = 'BUSINESS_EMAIL_DOMAIN' OR `businessEmail` IS NULL);
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_business_email_present`
  CHECK (`method` <> 'BUSINESS_EMAIL_DOMAIN' OR `businessEmail` IS NOT NULL OR `endedAt` IS NOT NULL);
ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `chk_evt_claim_binding`
  CHECK ((`purpose` = 'CLAIM_BUSINESS_EMAIL') = (`claimId` IS NOT NULL));
