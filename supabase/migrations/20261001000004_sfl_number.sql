-- ============================================================================
-- "Your Set for Life Number" — the participant-facing lookup identifier.
--
-- Governs: Addendum 02 v1.1 §4, §4.2, §5, §14.
--
-- WHAT THE SPEC REQUIRES (Addendum 02 v1.1 §4):
--   "Ask for the participant's Grease the Wheel number as the returning lookup
--    identifier... Use the number to locate the participant record/session
--    association... Do not treat the Grease the Wheel number alone as sufficient
--    authentication for access to prior sensitive assessment responses."
--
-- §4.2 states the security rule flatly: "The Grease the Wheel number is a
-- lookup/routing identifier, not a password. A participant must never gain
-- access to another person's prior financial assessment or Snapshot solely by
-- entering a known/guessed number."
--
-- The participant-facing label is "Your Set for Life Number". GTW / Grease the
-- Wheel remains an internal business term and must not appear in participant UI.
--
-- DESIGN CONSTRAINTS (from the operator, all satisfied here):
--   * generated once per participant and persisted with the record;
--   * stable across assessment sessions and future assessments (it lives on
--     `participants`, which is the durable identity row — sessions come and go);
--   * NOT email, NOT mobile, NOT the database UUID, NOT a sequential count;
--   * unique, and must not make participant volume inferable;
--   * lookup/retrieval ONLY — never sufficient authentication (§4.2);
--   * a returning participant may enter it to locate a CANDIDATE record, after
--     which secure verification is required before anything protected is shown.
--
-- WHY THE ALPHABET IS CROCKFORD BASE32.
--
-- Participants read this off a screen, write it down, and read it back later —
-- possibly over the phone. Crockford's alphabet drops I, L, O and U precisely
-- because they are the characters people confuse (0/O, 1/I/L) or that produce
-- accidental words. Excluding them costs nothing and removes the single largest
-- source of "it says my number is wrong" support friction.
--
-- WHY 7 DATA CHARACTERS + 1 CHECK CHARACTER.
--
-- The format is XXXX-XXXX. Seven random characters give 32^7 = 34,359,738,368
-- combinations — far more than a pilot can exhaust, so uniqueness is never the
-- binding constraint. Spending the eighth character on a CHECK rather than more
-- entropy buys a genuinely better failure mode: a mistyped number is REJECTED AS
-- MALFORMED ("that does not look like a Set for Life Number") instead of being
-- submitted as a lookup that returns "no record found". Those two messages mean
-- very different things to a participant, and conflating them is how someone
-- concludes their record was lost.
--
-- The check is a position-weighted sum modulo 32. Adjacent transpositions are
-- the most common typing error, and with weights 1..7 a swap of characters at
-- positions i and i+1 changes the sum by exactly (b - a), so it is detected
-- unless the two characters are identical.
--
-- WHY THE GENERATOR IS RANDOM RATHER THAN SEQUENTIAL.
--
-- A sequential number would leak participant volume to anyone holding one — and
-- a participant comparing numbers with a friend would learn how many people
-- came before them. Random generation makes the number carry no information
-- about count. `get_byte(...) % 32` introduces NO modulo bias because 256 is
-- exactly divisible by 32.
--
-- WHY THIS IS NOT A SECURITY BOUNDARY. It is deliberately not treated as one.
-- §4.2 forbids treating possession as authentication, so the number is not a
-- secret and `generate_sfl_number` does not need cryptographic strength — but
-- it uses `gen_random_bytes` anyway, because a predictable identifier would let
-- someone ENUMERATE candidate records, and the lookup prompt should not be a
-- free directory. Verification, not the number, is what protects data.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The alphabet, as a function so it has exactly one definition.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sfl_number_alphabet()
RETURNS TEXT AS $$
  -- Crockford Base32: digits plus A-Z with I, L, O and U removed (32 symbols).
  SELECT '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
$$ LANGUAGE sql IMMUTABLE;

-- ----------------------------------------------------------------------------
-- The check character over a 7-character body.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sfl_number_check(p_body TEXT)
RETURNS TEXT AS $$
DECLARE
  v_alpha TEXT := sfl_number_alphabet();
  v_sum   INT := 0;
  v_i     INT;
BEGIN
  IF p_body IS NULL OR length(p_body) <> 7 THEN
    RAISE EXCEPTION 'sfl_number_check: body must be exactly 7 characters, got %',
      coalesce(length(p_body)::text, 'NULL');
  END IF;

  FOR v_i IN 1..7 LOOP
    v_sum := v_sum + (strpos(v_alpha, substr(p_body, v_i, 1)) - 1) * v_i;
  END LOOP;

  -- strpos returns 0 for a character outside the alphabet, which would make the
  -- value -1 and silently produce a check character for an invalid body. Fail
  -- loudly instead: a bad body is a bug, not participant input.
  IF v_sum < 0 THEN
    RAISE EXCEPTION 'sfl_number_check: body % contains characters outside the alphabet', p_body;
  END IF;

  RETURN substr(v_alpha, (v_sum % 32) + 1, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION sfl_number_check(TEXT) IS
  'Addendum 02 v1.1 §4: positional checksum for a Set for Life Number body. Detects adjacent transpositions, the most common typing error.';

-- ----------------------------------------------------------------------------
-- Generation: 7 random characters + check, formatted XXXX-XXXX.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_sfl_number()
RETURNS TEXT AS $$
DECLARE
  v_alpha TEXT := sfl_number_alphabet();
  v_bytes BYTEA := gen_random_bytes(7);
  v_body  TEXT := '';
  v_i     INT;
BEGIN
  -- 256 / 32 = 8 exactly, so `% 32` is uniform here — no modulo bias.
  FOR v_i IN 0..6 LOOP
    v_body := v_body || substr(v_alpha, (get_byte(v_bytes, v_i) % 32) + 1, 1);
  END LOOP;
  RETURN substr(v_body, 1, 4) || '-' || substr(v_body, 5, 3) || sfl_number_check(v_body);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_sfl_number() IS
  'Addendum 02 v1.1 §4: one Set for Life Number, XXXX-XXXX, random over Crockford Base32 with a trailing check character.';

-- ----------------------------------------------------------------------------
-- The column.
--
-- On `participants`, not `assessment_sessions`: the number identifies the
-- PERSON and must survive every session and every future assessment. Putting it
-- on the session would issue a new number each time and break §5's "a
-- participant can own multiple assessment sessions and Snapshots" under one
-- stable identifier.
-- ----------------------------------------------------------------------------
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS sfl_number TEXT;

COMMENT ON COLUMN participants.sfl_number IS
  'Addendum 02 v1.1 §4/§4.2: participant-facing "Set for Life Number" (XXXX-XXXX). A LOOKUP identifier only — possession is never sufficient authentication for protected data. Distinct from participant_id, which remains the authoritative relational identity (§5).';

-- ----------------------------------------------------------------------------
-- Assignment trigger: generate, retry on the astronomically unlikely collision.
--
-- A DEFAULT expression cannot retry, and a unique violation at INSERT would
-- surface to the participant as a failed signup. 32^7 is large enough that the
-- loop will essentially never run twice, but "essentially never" is not "never",
-- and the cost of handling it here is three lines.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_sfl_number()
RETURNS TRIGGER AS $$
DECLARE
  v_candidate TEXT;
  v_attempts  INT := 0;
BEGIN
  -- Never overwrite an existing number: stability across sessions is the whole
  -- point (§5). This also makes the trigger safe to leave attached.
  IF NEW.sfl_number IS NOT NULL AND btrim(NEW.sfl_number) <> '' THEN
    RETURN NEW;
  END IF;

  LOOP
    v_attempts := v_attempts + 1;
    v_candidate := generate_sfl_number();

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM participants WHERE sfl_number = v_candidate
    );

    IF v_attempts >= 20 THEN
      RAISE EXCEPTION
        'assign_sfl_number: could not find a unique number after % attempts', v_attempts;
    END IF;
  END LOOP;

  NEW.sfl_number := v_candidate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_sfl_number ON participants;
CREATE TRIGGER trg_assign_sfl_number
  BEFORE INSERT ON participants
  FOR EACH ROW EXECUTE FUNCTION assign_sfl_number();

-- ----------------------------------------------------------------------------
-- Immutability guard.
--
-- WHY THIS IS A SECOND TRIGGER. The assignment trigger above only runs BEFORE
-- INSERT, so it protects nothing once a row exists — and a direct
-- `UPDATE participants SET sfl_number = ...` was verified to succeed against a
-- real database, changing a participant's number out from under them. That
-- breaks §5's requirement that the number be stable across sessions and future
-- assessments, and it breaks the promise the participant is shown: "Keep this
-- number. It helps us find your Set for Life record when you return." A number
-- that can change is one they cannot rely on.
--
-- It was caught by testing the claim rather than trusting the comment above,
-- which asserted stability the INSERT-only trigger did not provide.
--
-- Deliberately narrow: only a CHANGE is refused. A no-op update that rewrites
-- the same value is allowed, so ordinary `UPDATE participants SET ...` calls
-- that happen to include the column do not start failing.
--
-- There is intentionally NO escape hatch. Unlike the Snapshot guards, where an
-- authorized erasure must reach the data, nothing in the product has a
-- legitimate reason to renumber a participant — and if one ever does, that is a
-- decision worth forcing into the open rather than leaving a flag for.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION protect_sfl_number()
RETURNS TRIGGER AS $$
BEGIN
  -- FIRST ASSIGNMENT IS NOT A CHANGE. A row going from NULL to a number is the
  -- number being ISSUED, not altered, and the backfill below depends on it.
  --
  -- This distinction was learned the hard way: the first version of this guard
  -- refused ANY distinct value, which blocked the backfill and left every
  -- pre-existing participant without a number. It passed local testing only
  -- because the chain was applied to an EMPTY database — the backfill had no
  -- rows to touch, so the guard never fired. Applying to a database that
  -- actually had participants exposed it immediately.
  IF OLD.sfl_number IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.sfl_number IS DISTINCT FROM OLD.sfl_number THEN
    RAISE EXCEPTION
      'Addendum 02 v1.1 §5: a Set for Life Number is permanent; participant % already has %',
      OLD.participant_id, OLD.sfl_number
      USING HINT =
        'The number is the participant''s stable lookup handle. If it must genuinely change, do it as an explicit, reviewed data operation.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_sfl_number ON participants;
CREATE TRIGGER trg_protect_sfl_number
  BEFORE UPDATE ON participants
  FOR EACH ROW EXECUTE FUNCTION protect_sfl_number();

COMMENT ON FUNCTION protect_sfl_number() IS
  'Addendum 02 v1.1 §5: a Set for Life Number never changes. Refuses any UPDATE that alters it; the number is the participant''s permanent lookup handle.';

-- ----------------------------------------------------------------------------
-- Backfill, then enforce NOT NULL + UNIQUE.
--
-- Existing rows predate the identifier. They are given real numbers rather than
-- NULLs because §5 makes the number the participant's stable handle, and a
-- participant row without one would be a record a returning participant could
-- never look up.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_candidate TEXT;
  v_attempts INT;
BEGIN
  FOR r IN SELECT participant_id FROM participants WHERE sfl_number IS NULL LOOP
    v_attempts := 0;
    LOOP
      v_attempts := v_attempts + 1;
      v_candidate := generate_sfl_number();
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM participants WHERE sfl_number = v_candidate
      );
      IF v_attempts >= 20 THEN
        RAISE EXCEPTION 'backfill: no unique number after % attempts', v_attempts;
      END IF;
    END LOOP;
    UPDATE participants SET sfl_number = v_candidate WHERE participant_id = r.participant_id;
  END LOOP;
END $$;

ALTER TABLE participants
  ALTER COLUMN sfl_number SET NOT NULL;

-- UNIQUE, not merely indexed: §4 requires the number to identify exactly one
-- participant. A collision that reached the table would make a lookup
-- ambiguous, which is precisely the case §4.2 says must never expose another
-- person's data.
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_sfl_number
  ON participants(sfl_number);

-- ----------------------------------------------------------------------------
-- Lookup normalization.
--
-- Participants type the number from memory, a screenshot, or paper. They will
-- include the dash, omit it, use spaces, or type lowercase. All of those must
-- resolve to the SAME record, so the comparison is done on a canonical form.
--
-- `replace` strips every separator at once (dash, space, en/em dash, and the
-- non-breaking space a paste from a web page can carry). Input is also mapped
-- through Crockford's documented confusions — O->0, I/L->1 — because those are
-- exactly the characters a participant might substitute while reading their own
-- number off a screen.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION normalize_sfl_number(p_input TEXT)
RETURNS TEXT AS $$
DECLARE
  v TEXT;
BEGIN
  IF p_input IS NULL THEN RETURN NULL; END IF;

  v := upper(btrim(p_input));
  -- Strip separators before anything else, so "abcd 1234" and "ABCD-1234" and
  -- "abcd1234" all become the same string.
  v := regexp_replace(v, '[^0-9A-Z]', '', 'g');
  -- Crockford's canonical substitutions, applied AFTER upper().
  v := translate(v, 'OIL', '011');

  RETURN v;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION normalize_sfl_number(TEXT) IS
  'Addendum 02 v1.1 §4: canonical form of a participant-entered Set for Life Number. Strips separators and folds Crockford confusions (O->0, I/L->1) so all reasonable renderings resolve to one record.';

-- ----------------------------------------------------------------------------
-- Validity check, used to distinguish "malformed" from "not found".
--
-- This distinction is the reason the check character exists: telling a
-- participant their number is mistyped is actionable, while "no record found"
-- reads as "your record is gone".
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_valid_sfl_number(p_input TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v TEXT := normalize_sfl_number(p_input);
BEGIN
  IF v IS NULL OR length(v) <> 8 THEN RETURN FALSE; END IF;
  -- Every character must be in the alphabet; normalize() may have left symbols.
  IF v ~ '[^0-9A-Z]' THEN RETURN FALSE; END IF;
  RETURN sfl_number_check(substr(v, 1, 7)) = substr(v, 8, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION is_valid_sfl_number(TEXT) IS
  'Addendum 02 v1.1 §4: true when input is a well-formed Set for Life Number. Lets the app say "that looks mistyped" rather than "no record found".';
