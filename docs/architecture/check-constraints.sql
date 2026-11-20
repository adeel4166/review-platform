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
-- =============================================================================

-- ---------- exactly one target ----------

ALTER TABLE `Comment` ADD CONSTRAINT `chk_comment_one_target`
  CHECK ((`reviewId` IS NOT NULL) + (`postId` IS NOT NULL) = 1);

ALTER TABLE `Like` ADD CONSTRAINT `chk_like_one_target`
  CHECK ((`postId` IS NOT NULL) + (`commentId` IS NOT NULL) = 1);

ALTER TABLE `Follow` ADD CONSTRAINT `chk_follow_one_target`
  CHECK ((`followedUserId` IS NOT NULL) + (`followedSellerId` IS NOT NULL)
       + (`followedProductId` IS NOT NULL) = 1);

-- NOTE: "cannot follow/block yourself" is enforced in the application layer,
-- NOT here: followerId / blockerId / blockedId carry ON DELETE CASCADE FKs and
-- MySQL rejects CHECKs on such columns (ER 3823).

ALTER TABLE `Report` ADD CONSTRAINT `chk_report_one_target`
  CHECK ((`reviewId` IS NOT NULL) + (`commentId` IS NOT NULL) + (`postId` IS NOT NULL)
       + (`sellerReplyId` IS NOT NULL) + (`reportedUserId` IS NOT NULL)
       + (`sellerId` IS NOT NULL) + (`productId` IS NOT NULL)
       + (`mediaAssetId` IS NOT NULL) = 1);

ALTER TABLE `ModerationCase` ADD CONSTRAINT `chk_case_one_target`
  CHECK ((`reviewId` IS NOT NULL) + (`commentId` IS NOT NULL) + (`postId` IS NOT NULL)
       + (`sellerReplyId` IS NOT NULL) + (`targetUserId` IS NOT NULL)
       + (`sellerId` IS NOT NULL) + (`productId` IS NOT NULL)
       + (`mediaAssetId` IS NOT NULL) = 1);

ALTER TABLE `Appeal` ADD CONSTRAINT `chk_appeal_one_target`
  CHECK ((`enforcementActionId` IS NOT NULL) + (`caseId` IS NOT NULL)
       + (`purchaseProofId` IS NOT NULL) + (`ownershipClaimId` IS NOT NULL) = 1);

ALTER TABLE `EnforcementAction` ADD CONSTRAINT `chk_enforcement_one_subject`
  CHECK ((`subjectUserId` IS NOT NULL) + (`subjectSellerId` IS NOT NULL) = 1);

ALTER TABLE `TrustSignal` ADD CONSTRAINT `chk_trust_signal_one_subject`
  CHECK ((`subjectUserId` IS NOT NULL) + (`subjectSellerId` IS NOT NULL) = 1);

ALTER TABLE `TrustScoreSnapshot` ADD CONSTRAINT `chk_trust_score_one_subject`
  CHECK ((`subjectUserId` IS NOT NULL) + (`subjectSellerId` IS NOT NULL) = 1);

-- ---------- at most one attachment (unattached = upload in progress / avatar / logo) ----------

ALTER TABLE `MediaAsset` ADD CONSTRAINT `chk_media_at_most_one_parent`
  CHECK ((`reviewId` IS NOT NULL) + (`postId` IS NOT NULL) + (`productId` IS NOT NULL)
       + (`purchaseProofId` IS NOT NULL) + (`ownershipClaimId` IS NOT NULL)
       + (`appealId` IS NOT NULL) <= 1);

-- Sensitive purposes must live in the private bucket.
ALTER TABLE `MediaAsset` ADD CONSTRAINT `chk_media_sensitive_private`
  CHECK (`purpose` NOT IN ('PURCHASE_PROOF', 'OWNERSHIP_EVIDENCE', 'APPEAL_EVIDENCE')
         OR `visibility` = 'PRIVATE');

-- ---------- value ranges ----------

ALTER TABLE `Review` ADD CONSTRAINT `chk_review_rating`
  CHECK (`rating` BETWEEN 1 AND 5);

ALTER TABLE `ReviewRevision` ADD CONSTRAINT `chk_review_revision_rating`
  CHECK (`rating` BETWEEN 1 AND 5);

ALTER TABLE `TrustScoreSnapshot` ADD CONSTRAINT `chk_trust_score_range`
  CHECK (`score` BETWEEN 0 AND 100);

-- productId FK is declared Restrict/Restrict for this reason (products are never hard-deleted).
ALTER TABLE `SellerOwnershipClaim` ADD CONSTRAINT `chk_claim_product_scope`
  CHECK ((`scope` = 'PRODUCT') = (`productId` IS NOT NULL));

-- ---------- M1.2: moderation pipeline and media storage (task #19) ----------
-- None of these columns carry FKs, so ER 3823 does not apply.
-- NULL lane / NULL score makes the expression UNKNOWN, which a CHECK accepts.

-- A HOLD-lane case must carry its auto-reject deadline (moderation-pipeline.md §4).
ALTER TABLE `ModerationCase` ADD CONSTRAINT `chk_case_hold_expiry`
  CHECK (`lane` <> 'HOLD' OR `holdExpiresAt` IS NOT NULL);

-- A POST_REVIEW-lane case must carry its 24 h SLA deadline.
ALTER TABLE `ModerationCase` ADD CONSTRAINT `chk_case_post_review_due`
  CHECK (`lane` <> 'POST_REVIEW' OR `postReviewDueAt` IS NOT NULL);

ALTER TABLE `ModerationCase` ADD CONSTRAINT `chk_case_ai_score_range`
  CHECK (`aiScore` BETWEEN 0 AND 1);

ALTER TABLE `ModerationDecision` ADD CONSTRAINT `chk_decision_confidence_range`
  CHECK (`confidence` BETWEEN 0 AND 1);

-- Only assets intended to be public may ever sit in the public bucket. Together with
-- chk_media_sensitive_private this keeps evidence out of public storage (media-pipeline.md §4.4).
ALTER TABLE `MediaAsset` ADD CONSTRAINT `chk_media_public_bucket`
  CHECK (`bucket` <> 'PUBLIC' OR `visibility` = 'PUBLIC');
