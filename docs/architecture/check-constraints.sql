-- =============================================================================
-- Review Platform: CHECK constraints that Prisma cannot express (DRAFT)
-- =============================================================================
-- Requires MySQL 8.0.16+ (CHECK constraints are enforced from 8.0.16).
-- The scaffold task appends these to the initial migration's migration.sql
-- (`prisma migrate dev --create-only`, then edit). Rationale: ADR-0004 §3.
--
-- MySQL rule: a column used in a CHECK constraint cannot also be used in a
-- foreign key with CASCADE / SET NULL / SET DEFAULT actions (ER 3823). Every
-- arc FK below is therefore declared `onDelete: Restrict, onUpdate: Restrict`
-- in schema.draft.prisma. Do not change those actions without dropping the CHECK.
--
-- In MySQL a boolean expression evaluates to 0/1, so summing
-- `(col IS NOT NULL)` counts the non-null arc members.
--
-- Table names are the snake_case @@map names (ADR-0010), not Prisma model names.
-- =============================================================================

-- ---------- exactly one target ----------

ALTER TABLE `comments` ADD CONSTRAINT `chk_comment_one_target`
  CHECK ((`reviewId` IS NOT NULL) + (`postId` IS NOT NULL) = 1);

ALTER TABLE `likes` ADD CONSTRAINT `chk_like_one_target`
  CHECK ((`postId` IS NOT NULL) + (`commentId` IS NOT NULL) = 1);

ALTER TABLE `follows` ADD CONSTRAINT `chk_follow_one_target`
  CHECK ((`followedUserId` IS NOT NULL) + (`followedSellerId` IS NOT NULL)
       + (`followedProductId` IS NOT NULL) = 1);

-- NOTE: "cannot follow/block yourself" is enforced in the application layer,
-- NOT here: followerId / blockerId / blockedId carry ON DELETE CASCADE FKs and
-- MySQL rejects CHECKs on such columns (ER 3823).

ALTER TABLE `reports` ADD CONSTRAINT `chk_report_one_target`
  CHECK ((`reviewId` IS NOT NULL) + (`commentId` IS NOT NULL) + (`postId` IS NOT NULL)
       + (`sellerReplyId` IS NOT NULL) + (`reportedUserId` IS NOT NULL)
       + (`sellerId` IS NOT NULL) + (`productId` IS NOT NULL)
       + (`mediaAssetId` IS NOT NULL) = 1);

ALTER TABLE `moderation_cases` ADD CONSTRAINT `chk_case_one_target`
  CHECK ((`reviewId` IS NOT NULL) + (`commentId` IS NOT NULL) + (`postId` IS NOT NULL)
       + (`sellerReplyId` IS NOT NULL) + (`targetUserId` IS NOT NULL)
       + (`sellerId` IS NOT NULL) + (`productId` IS NOT NULL)
       + (`mediaAssetId` IS NOT NULL) = 1);

ALTER TABLE `appeals` ADD CONSTRAINT `chk_appeal_one_target`
  CHECK ((`enforcementActionId` IS NOT NULL) + (`caseId` IS NOT NULL)
       + (`purchaseProofId` IS NOT NULL) + (`ownershipClaimId` IS NOT NULL) = 1);

ALTER TABLE `enforcement_actions` ADD CONSTRAINT `chk_enforcement_one_subject`
  CHECK ((`subjectUserId` IS NOT NULL) + (`subjectSellerId` IS NOT NULL) = 1);

ALTER TABLE `trust_signals` ADD CONSTRAINT `chk_trust_signal_one_subject`
  CHECK ((`subjectUserId` IS NOT NULL) + (`subjectSellerId` IS NOT NULL) = 1);

ALTER TABLE `trust_score_snapshots` ADD CONSTRAINT `chk_trust_score_one_subject`
  CHECK ((`subjectUserId` IS NOT NULL) + (`subjectSellerId` IS NOT NULL) = 1);

-- ---------- at most one attachment (unattached = upload in progress / avatar / logo) ----------

ALTER TABLE `media_assets` ADD CONSTRAINT `chk_media_at_most_one_parent`
  CHECK ((`reviewId` IS NOT NULL) + (`postId` IS NOT NULL) + (`productId` IS NOT NULL)
       + (`purchaseProofId` IS NOT NULL) + (`ownershipClaimId` IS NOT NULL)
       + (`appealId` IS NOT NULL) <= 1);

-- Sensitive purposes must live in the private bucket.
ALTER TABLE `media_assets` ADD CONSTRAINT `chk_media_sensitive_private`
  CHECK (`purpose` NOT IN ('PURCHASE_PROOF', 'OWNERSHIP_EVIDENCE', 'APPEAL_EVIDENCE')
         OR `visibility` = 'PRIVATE');

-- ---------- value ranges ----------

ALTER TABLE `reviews` ADD CONSTRAINT `chk_review_rating`
  CHECK (`rating` BETWEEN 1 AND 5);

ALTER TABLE `review_revisions` ADD CONSTRAINT `chk_review_revision_rating`
  CHECK (`rating` BETWEEN 1 AND 5);

ALTER TABLE `trust_score_snapshots` ADD CONSTRAINT `chk_trust_score_range`
  CHECK (`score` BETWEEN 0 AND 100);

-- productId FK is declared Restrict/Restrict for this reason (products are never hard-deleted).
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_product_scope`
  CHECK ((`scope` = 'PRODUCT') = (`productId` IS NOT NULL));

-- ---------- M1.2: moderation pipeline and media storage (task #19) ----------
-- None of these columns carry FKs, so ER 3823 does not apply.
-- NULL lane / NULL score makes the expression UNKNOWN, which a CHECK accepts.

-- A HOLD-lane case must carry its auto-reject deadline (moderation-pipeline.md §4).
ALTER TABLE `moderation_cases` ADD CONSTRAINT `chk_case_hold_expiry`
  CHECK (`lane` <> 'HOLD' OR `holdExpiresAt` IS NOT NULL);

-- A POST_REVIEW-lane case must carry its 24 h SLA deadline.
ALTER TABLE `moderation_cases` ADD CONSTRAINT `chk_case_post_review_due`
  CHECK (`lane` <> 'POST_REVIEW' OR `postReviewDueAt` IS NOT NULL);

ALTER TABLE `moderation_cases` ADD CONSTRAINT `chk_case_ai_score_range`
  CHECK (`aiScore` BETWEEN 0 AND 1);

ALTER TABLE `moderation_decisions` ADD CONSTRAINT `chk_decision_confidence_range`
  CHECK (`confidence` BETWEEN 0 AND 1);

-- Only assets intended to be public may ever sit in the public bucket. Together with
-- chk_media_sensitive_private this keeps evidence out of public storage (media-pipeline.md §4.4).
ALTER TABLE `media_assets` ADD CONSTRAINT `chk_media_public_bucket`
  CHECK (`bucket` <> 'PUBLIC' OR `visibility` = 'PUBLIC');

-- ---------- verified-buyer label consistency (ADR-0008, task #24) ----------
-- The label fields are set and cleared together: granted by exactly one VERIFIED
-- PurchaseProof, and cleared together on revocation (VERIFIED_LABEL_REVOKED).
-- Allowed because reviews.verifiedProofId uses ON DELETE/UPDATE RESTRICT.
ALTER TABLE `reviews` ADD CONSTRAINT `chk_review_verified_label`
  CHECK ((`verifiedProofId` IS NULL) = (`verifiedPurchaseAt` IS NULL)
     AND (`verifiedProofId` IS NULL) = (`verificationMethod` IS NULL));

-- ---------- M3: sellers, ownership claims, invitations, email tokens (task #44) ----------
-- Authoritative list and migration placement: docs/architecture/m3-sellers-spec.md §2.4 / §2.6.
-- The draft chk_claim_product_scope above is kept unchanged (SEL-012). Every FK column used below is
-- declared onDelete/onUpdate Restrict in the M3 schema plan (ER 3823).

ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_product_method`
  CHECK (`scope` <> 'PRODUCT' OR `method` IN ('DOCUMENT', 'MARKETPLACE'));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_domain_method`
  CHECK (`method` NOT IN ('DNS_TXT', 'META_TAG', 'BUSINESS_EMAIL_DOMAIN') OR `domain` IS NOT NULL);
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_challenge`
  CHECK (`method` NOT IN ('DNS_TXT', 'META_TAG', 'MARKETPLACE')
         OR (`challengeValue` IS NOT NULL AND `challengeExpiresAt` IS NOT NULL));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_marketplace_url`
  CHECK (`method` <> 'MARKETPLACE' OR `evidenceUrl` IS NOT NULL);
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_approvals`
  CHECK (`requiredApprovals` BETWEEN 1 AND 2);
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_verified_fields`
  CHECK (`status` <> 'VERIFIED'
         OR (`verifiedAt` IS NOT NULL AND `verifiedUntil` IS NOT NULL AND `verifiedUntil` > `verifiedAt`));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_ended`
  CHECK ((`status` IN ('REJECTED', 'EXPIRED', 'REVOKED', 'WITHDRAWN')) = (`endedAt` IS NOT NULL));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_end_reason`
  CHECK ((`status` IN ('EXPIRED', 'REVOKED')) = (`endReason` IS NOT NULL));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_grace`
  CHECK ((`graceEndsAt` IS NULL) = (`reverifyFailingSince` IS NULL)
     AND (`graceEndsAt` IS NULL OR `status` = 'VERIFIED'));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_contested`
  CHECK (`status` <> 'CONTESTED'
         OR (`conflictClaimId` IS NOT NULL AND `contestResponseDueAt` IS NOT NULL AND `requiredApprovals` = 2));
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_active_key`
  CHECK ((`status` IN ('PENDING', 'CONTESTED', 'VERIFIED')) = (`activeKey` IS NOT NULL));
-- One seller per verified domain (SEL-003): verifiedDomainKey is UNIQUE and only set while VERIFIED.
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_verified_domain_key`
  CHECK (`verifiedDomainKey` IS NULL OR (`status` = 'VERIFIED' AND `verifiedDomainKey` = `domain`));

ALTER TABLE `seller_claim_decisions` ADD CONSTRAINT `chk_claim_decision_source`
  CHECK ((`source` = 'RULE') = (`reviewerId` IS NULL));

-- SEL-011: a VERIFIED seller must point at its verified claim (same-seller via composite FK; scope/status by service).
ALTER TABLE `sellers` ADD CONSTRAINT `chk_seller_verified_claim`
  CHECK (`status` <> 'VERIFIED' OR (`verifiedClaimId` IS NOT NULL AND `verifiedAt` IS NOT NULL));
ALTER TABLE `sellers` ADD CONSTRAINT `chk_seller_verified_pair`
  CHECK ((`verifiedClaimId` IS NULL) = (`verifiedAt` IS NULL)
     AND (`verifiedDomain` IS NULL OR `verifiedClaimId` IS NOT NULL));
ALTER TABLE `sellers` ADD CONSTRAINT `chk_seller_closed`
  CHECK ((`status` = 'CLOSED') = (`closedAt` IS NOT NULL));

ALTER TABLE `seller_invitations` ADD CONSTRAINT `chk_invitation_role`
  CHECK (`role` IN ('MANAGER', 'RESPONDER'));
ALTER TABLE `seller_invitations` ADD CONSTRAINT `chk_invitation_accepted`
  CHECK ((`acceptedAt` IS NULL) = (`acceptedById` IS NULL) AND (`acceptedAt` IS NULL OR `tokenHash` IS NOT NULL));
ALTER TABLE `seller_invitations` ADD CONSTRAINT `chk_invitation_single_end`
  CHECK (NOT (`acceptedAt` IS NOT NULL AND `revokedAt` IS NOT NULL));
ALTER TABLE `seller_invitations` ADD CONSTRAINT `chk_invitation_sent`
  CHECK (`sentAt` IS NULL OR `tokenHash` IS NOT NULL);

ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `chk_evt_claim_purpose`
  CHECK ((`purpose` = 'CLAIM_BUSINESS_EMAIL') = (`claimId` IS NOT NULL));
ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `chk_evt_sent`
  CHECK ((`sentAt` IS NULL OR `tokenHash` IS NOT NULL) AND (`consumedAt` IS NULL OR `tokenHash` IS NOT NULL));
ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `chk_evt_single_end`
  CHECK (NOT (`consumedAt` IS NOT NULL AND `invalidatedAt` IS NOT NULL));

-- Real-schema media arc (M3-07). Replaces chk_media_at_most_one_parent until the other parents exist;
-- requires media_assets.reviewId FK changed from CASCADE to RESTRICT in the same migration.
ALTER TABLE `media_assets` ADD CONSTRAINT `chk_media_parent_by_purpose`
  CHECK (((`purpose` = 'REVIEW_MEDIA') = (`reviewId` IS NOT NULL))
     AND ((`purpose` = 'OWNERSHIP_EVIDENCE') = (`ownershipClaimId` IS NOT NULL)));
-- chk_enforcement_one_subject (above) is applied unchanged with the enforcement_actions migration.

-- =============================================================================
-- M3-04 (task #47): the seller CHECKs (chk_seller_*, chk_invitation_*, chk_claim_*, chk_claim_decision_source,
-- chk_enforcement_one_subject) are applied by migration 20261202000000_sellers_claims_enforcement. Definitions:
-- docs/architecture/m3-sellers-spec.md §2.4. Not expressible in MySQL (service invariant + daily sweeper): SEL-011 "the
-- referenced claim is SELLER-scope and VERIFIED" (recomputeSeller in apps/web/src/server/sellers.ts) and ">= 1 OWNER".
-- =============================================================================

-- =============================================================================
-- M3b (task #54, docs/architecture/m3b-spec.md §6.3). Appended by hand to the four M3b migrations.
-- None of these uses a column carrying a CASCADE / SET NULL FK (MySQL ER 3823).
-- =============================================================================

-- 20261210000000_sessions_two_factor (M3b-04)
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

-- 20261211000000_claim_business_email (M3b-06)
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_business_email_method`
  CHECK (`method` = 'BUSINESS_EMAIL_DOMAIN' OR `businessEmail` IS NULL);
ALTER TABLE `seller_ownership_claims` ADD CONSTRAINT `chk_claim_business_email_present`
  CHECK (`method` <> 'BUSINESS_EMAIL_DOMAIN' OR `businessEmail` IS NOT NULL OR `endedAt` IS NOT NULL);

-- 20261212000000_ownership_transfers (M3b-05)
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_parties`
  CHECK (`initiatorId` <> `targetUserId`);
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_initiator_outcome`
  CHECK ((`kind` = 'TRANSFER') = (`initiatorOutcome` <> 'REMAIN_OWNER'));
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_target_outcome`
  CHECK (((`kind` = 'REMOVE_OWNER') = (`targetOutcome` IS NOT NULL))
     AND (`targetOutcome` IS NULL OR `targetOutcome` <> 'REMAIN_OWNER'));
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_open_key`
  CHECK (((`status` IN ('PENDING','ACCEPTED')) = (`openKey` IS NOT NULL))
     AND (`openKey` IS NULL OR `openKey` = `sellerId`));
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_accepted`
  CHECK (`status` NOT IN ('ACCEPTED','COMPLETED') OR `acceptedAt` IS NOT NULL);
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_ended`
  CHECK ((`status` IN ('COMPLETED','CANCELLED','EXPIRED','FAILED')) = (`endedAt` IS NOT NULL));
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_end_reason`
  CHECK ((`status` IN ('CANCELLED','FAILED')) = (`endReason` IS NOT NULL));
-- O-6 hard floor: no configuration can shorten the 72 h delay (259200 s).
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_delay`
  CHECK (TIMESTAMPDIFF(SECOND, `createdAt`, `executeAfter`) >= 259200 AND `acceptBy` > `executeAfter`);
ALTER TABLE `seller_ownership_transfers` ADD CONSTRAINT `chk_transfer_completed_after_delay`
  CHECK (`status` <> 'COMPLETED' OR `endedAt` >= `executeAfter`);
ALTER TABLE `seller_transfer_cancel_tokens` ADD CONSTRAINT `chk_tct_sent`
  CHECK ((`sentAt` IS NULL OR `tokenHash` IS NOT NULL) AND (`usedAt` IS NULL OR `tokenHash` IS NOT NULL));

-- 20261213000000_seller_replies (M3b-07). Requires moderation_cases.reviewId FK changed CASCADE -> RESTRICT first.
ALTER TABLE `seller_replies` ADD CONSTRAINT `chk_reply_body_len`
  CHECK (CHAR_LENGTH(`body`) BETWEEN 1 AND 1500);
ALTER TABLE `seller_replies` ADD CONSTRAINT `chk_reply_deleted`
  CHECK ((`status` = 'DELETED') = (`deletedAt` IS NOT NULL));
ALTER TABLE `seller_replies` ADD CONSTRAINT `chk_reply_published`
  CHECK (`status` <> 'PUBLISHED' OR `publishedAt` IS NOT NULL);
ALTER TABLE `seller_replies` ADD CONSTRAINT `chk_reply_version`
  CHECK (`version` >= 1);
ALTER TABLE `moderation_cases` ADD CONSTRAINT `chk_case_subject`
  CHECK (((`subjectType` = 'REVIEW') = (`reviewId` IS NOT NULL))
     AND ((`subjectType` = 'SELLER_REPLY') = (`sellerReplyId` IS NOT NULL)));
