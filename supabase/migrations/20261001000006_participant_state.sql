-- ============================================================================
-- Optional participant State — contextual/profile data ONLY.
--
-- GOVERNING REQUIREMENT (operator, 2026-10-01):
--   "It must have zero effect on diagnostic scoring, the six Money Picture
--    signals, friction determination, Perception Gap, Activation, or Snapshot
--    interpretation."
--
-- WHY IT LIVES ON `participants` AND NOT `demographics`.
--
-- That requirement is the whole design constraint. `demographics` is FROZEN on
-- session completion (`trg_demographics_immutable`, migration ...0002), and
-- freezing exists to protect the interpretation of a completed assessment. State
-- is explicitly NOT part of that interpretation — it is contextual/profile data
-- that may be collected or corrected later, and must never be read by the
-- engine. Putting it in a table the engine freezes would misrepresent it as
-- interpretation-relevant, and would make a later correction impossible.
--
-- It sits next to `sfl_number` on `participants` for the same reason: both are
-- durable facts about the PERSON that outlive any single assessment session.
--
-- NO DIAGNOSTIC INFERENCE FROM DECLINING. The column is NULLABLE and NULL is a
-- first-class value, not a gap to be filled. A participant who declines leaves
-- NULL, and nothing in the engine reads this column at all — there is no code
-- path from State into scoring, the six signals, tension determination,
-- Perception Gap, Activation, or the Snapshot payload. Declining therefore
-- cannot produce an inference because there is nothing that could infer.
--
-- NOT PART OF THE 31. This is not an instrument item: it has no entry in
-- config/assessment-v1.0.json, no `external_order`, and no scoring behaviour.
-- The required-response count is unchanged at 31.
--
-- FUTURE (Addendum 03). Preserved so an Admin can later match a participant
-- against agents whose RECORDED licensed jurisdiction is compatible. This
-- migration deliberately does NOT implement automatic licensing-based
-- assignment, and does not infer legal eligibility from State — a jurisdiction
-- code is not a legal conclusion.
--
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS state_code TEXT;

COMMENT ON COLUMN participants.state_code IS
  'Optional US state/jurisdiction code (e.g. "CA"), or NULL when declined. CONTEXTUAL/PROFILE DATA ONLY — never read by scoring, the six Money Picture signals, tension determination, Perception Gap, Activation, or Snapshot interpretation. Reserved for future Addendum 03 advisor matching; no licensing inference is made from it.';

-- ----------------------------------------------------------------------------
-- The controlled jurisdiction list.
--
-- A CHECK against an explicit list rather than free text, per the requirement
-- for a "controlled U.S. state/jurisdiction selector rather than free text".
-- Stored as a table so it is queryable and so a future jurisdiction (a territory
-- or an international expansion) is a data change rather than a constraint
-- rewrite.
--
-- The 50 states + DC are the canonical set. Territories are INCLUDED because
-- "jurisdiction" is broader than "state" and the requirement said
-- jurisdiction — omitting them would silently make a Puerto Rico participant
-- unable to answer truthfully. Codes are USPS two-letter, which is what a
-- licensing dataset would key on.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jurisdictions (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('state', 'district', 'territory')),
  sort_order INTEGER NOT NULL
);

COMMENT ON TABLE jurisdictions IS
  'Addendum 02 v1.1 / operator 2026-10-01: the controlled jurisdiction list for the optional State profile field. Codes are USPS two-letter. Includes territories because "jurisdiction" is broader than "state".';

INSERT INTO jurisdictions (code, name, kind, sort_order) VALUES
  ('AL','Alabama','state',1),        ('AK','Alaska','state',2),
  ('AZ','Arizona','state',3),        ('AR','Arkansas','state',4),
  ('CA','California','state',5),     ('CO','Colorado','state',6),
  ('CT','Connecticut','state',7),    ('DE','Delaware','state',8),
  ('DC','District of Columbia','district',9),
  ('FL','Florida','state',10),       ('GA','Georgia','state',11),
  ('HI','Hawaii','state',12),        ('ID','Idaho','state',13),
  ('IL','Illinois','state',14),      ('IN','Indiana','state',15),
  ('IA','Iowa','state',16),          ('KS','Kansas','state',17),
  ('KY','Kentucky','state',18),      ('LA','Louisiana','state',19),
  ('ME','Maine','state',20),         ('MD','Maryland','state',21),
  ('MA','Massachusetts','state',22), ('MI','Michigan','state',23),
  ('MN','Minnesota','state',24),     ('MS','Mississippi','state',25),
  ('MO','Missouri','state',26),      ('MT','Montana','state',27),
  ('NE','Nebraska','state',28),      ('NV','Nevada','state',29),
  ('NH','New Hampshire','state',30), ('NJ','New Jersey','state',31),
  ('NM','New Mexico','state',32),    ('NY','New York','state',33),
  ('NC','North Carolina','state',34),('ND','North Dakota','state',35),
  ('OH','Ohio','state',36),          ('OK','Oklahoma','state',37),
  ('OR','Oregon','state',38),        ('PA','Pennsylvania','state',39),
  ('RI','Rhode Island','state',40),  ('SC','South Carolina','state',41),
  ('SD','South Dakota','state',42),  ('TN','Tennessee','state',43),
  ('TX','Texas','state',44),         ('UT','Utah','state',45),
  ('VT','Vermont','state',46),       ('VA','Virginia','state',47),
  ('WA','Washington','state',48),    ('WV','West Virginia','state',49),
  ('WI','Wisconsin','state',50),     ('WY','Wyoming','state',51),
  ('AS','American Samoa','territory',52),
  ('GU','Guam','territory',53),
  ('MP','Northern Mariana Islands','territory',54),
  ('PR','Puerto Rico','territory',55),
  ('VI','U.S. Virgin Islands','territory',56)
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Referential integrity.
--
-- A separate ALTER rather than inline, so the constraint can be dropped and
-- re-added if the jurisdiction list ever changes without rewriting the column.
--
-- NOT VALID is avoided deliberately: the table was just created and backfilled
-- in this same migration, so existing rows are simply NULL and validate
-- trivially.
-- ----------------------------------------------------------------------------
ALTER TABLE participants
  DROP CONSTRAINT IF EXISTS participants_state_code_fk;

ALTER TABLE participants
  ADD CONSTRAINT participants_state_code_fk
  FOREIGN KEY (state_code) REFERENCES jurisdictions(code);

COMMENT ON CONSTRAINT participants_state_code_fk ON participants IS
  'Any non-NULL state_code must be in the controlled jurisdiction list — the schema-level half of "controlled selector, not free text".';

-- ----------------------------------------------------------------------------
-- Deliberately NO index on state_code yet.
--
-- The future Addendum 03 use is likely "find participants in jurisdiction X to
-- match against an agent's licensed jurisdiction". There is no such query today
-- and no measured need, so an index would be speculative cost on a column that
-- is NULL for most rows. Add it when the query exists.
-- ----------------------------------------------------------------------------
