-- ============================================================================
-- Provisional participants — a first-time participant with no identity yet.
--
-- Governs: Addendum 02 v1.1 §2, §3, §5, §14.
--
-- WHAT CHANGED. §2 corrects the front door: "Do not require full name, email
-- verification, or a magic-link round trip before a first-time participant can
-- answer this question and begin." §3.1 then says a first-time participant may
-- proceed with "Keep Going Without Saving" and only supply identity if they
-- later choose "Save My Progress".
--
-- So a participant row must now be creatable BEFORE any name is known. The
-- original schema could not express that: `participants.first_name` and
-- `last_name` were NOT NULL, which silently encoded the old assumption that
-- identity is collected first. That assumption is exactly what this addendum
-- overturns, so the constraint has to move with it.
--
-- WHY NULLABLE NAMES ARE SAFE HERE. Every existing reader already treats the
-- name as possibly-absent — the GHL sync declares `first_name: string | null`
-- and falls back, and the reveal's name resolution does `?.trim()` — so this
-- loosens a write constraint without changing any read path. The one behaviour
-- it enables is the intended one: a provisional row that carries a real
-- generated sfl_number and no name.
--
-- WHY THIS IS NOT A PRIVACY REGRESSION. A provisional participant is
-- deliberately anonymous: a random UUID, a generated Set for Life Number, and
-- nothing else. That is strictly LESS identifying than the previous flow, which
-- demanded a name and email before the participant could see anything.
--
-- The distinction the schema must keep is between "provisional" and "claimed".
-- §5: "Anonymous/provisional first-time sessions must be safely claimable by the
-- verified participant when Save My Progress or protected Snapshot retrieval is
-- established." Claiming is recorded explicitly below rather than inferred from
-- the presence of a name — a name can be typed by anyone, so it proves nothing.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Names become optional.
-- ----------------------------------------------------------------------------
ALTER TABLE participants
  ALTER COLUMN first_name DROP NOT NULL,
  ALTER COLUMN last_name  DROP NOT NULL;

COMMENT ON COLUMN participants.first_name IS
  'Addendum 02 v1.1 §3: NULL until identity is supplied (Save My Progress). A provisional participant is anonymous by design — UUID + Set for Life Number only.';

-- ----------------------------------------------------------------------------
-- Claim state: NULL means "provisional — no verified identity yet".
--
-- NULLABLE, and that is the honest encoding rather than a convenience. The
-- alternative considered first was `NOT NULL DEFAULT now()` with "provisional"
-- meaning `claimed_at = created_at`, and it was wrong twice over:
--
--   1. Every pre-existing row would have defaulted to `claimed_at = created_at`
--      and therefore been classified PROVISIONAL — including participants who
--      had completed the verified flow. A backfill would have had to guess.
--   2. It cannot represent a real intermediate state. A participant who chooses
--      Save My Progress supplies a name and email, and then must CLICK A LINK
--      before anything is verified. Between those two moments the row has a
--      name and no verified identity. `claimed_at` exists precisely to record
--      when verification SUCCEEDED, so NULL is the correct value until it does.
--
-- A CHECK constraint tying "provisional" to "has no name" was drafted and
-- deliberately dropped: it would have made that legitimate pending-verification
-- state impossible to store. The spec does not require the constraint, and
-- inventing one that blocks a real flow state is worse than having none.
--
-- Pre-existing rows are all claimed: they were created through the verified
-- email flow, which is the only path that existed. That is a fact about this
-- history, not a guess, so the backfill can set it directly.
-- ----------------------------------------------------------------------------
-- Add + backfill in ONE guarded step.
--
-- WHY THE EXISTENCE CHECK RATHER THAN `ADD COLUMN IF NOT EXISTS` PLUS AN
-- UNCONDITIONAL UPDATE. The backfill claims every row that exists AT MIGRATION
-- TIME. If it ran again later, it would claim rows created since — including
-- genuinely provisional participants — silently converting an anonymous
-- participant into an apparently-verified one. That is a correctness bug that
-- only appears on a re-run, so it is worth structuring the migration to make
-- re-running a no-op instead of trusting that nobody ever will.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'participants'
       AND column_name  = 'claimed_at'
  ) THEN
    ALTER TABLE participants ADD COLUMN claimed_at TIMESTAMPTZ;

    -- Every row that exists right now was created through the verified email
    -- flow, which was the only path that existed. That is a fact about this
    -- history rather than a guess, so it can be set directly.
    UPDATE participants SET claimed_at = created_at WHERE claimed_at IS NULL;
  END IF;
END $$;

COMMENT ON COLUMN participants.claimed_at IS
  'Addendum 02 v1.1 §5: when a VERIFIED identity was attached. NULL = provisional (anonymous) participant — UUID + Set for Life Number only. Set only after verification SUCCEEDS, so a participant awaiting a clicked link is still provisional.';
