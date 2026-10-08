# Workflow Evidence — SELECT-only DB verification of the SFL Snapshot write path

Date: 2026-10-08
Method: psql against the project's direct-connection URL from the local env file (password supplied percent-encoded; final host separator preserved). Session pooler: a Supabase pooler (host redacted).
Scope: SELECT-only. No UPDATE, no DELETE, no writes of any kind to the database. No commit, no push.

Identifier note: this document deliberately carries no real participant,
SFL-number, session, or snapshot values. Each is shown as a clearly-fake
placeholder plus a shape description.

## Verified identifiers

| Item | Value |
|---|---|
| Participant ID | `PARTICIPANT_ID_REDACTED` (a UUID) |
| SFL Number | `SFL_NUMBER_REDACTED` (a checksummed alphanumeric code) |
| Session ID | `SESSION_ID_REDACTED` (a UUID) |
| Snapshot ID | `SNAPSHOT_ID_REDACTED` (a UUID) |
| Response rows | 36 |

## Verification detail (all SELECT)

1. **Participant row** — exactly 1 row in `public.participants` with the target `sfl_number`:
   `participant_id=<UUID REDACTED>, status=active, created_at=2026-10-07 (date only), claimed_at=NULL`
2. **Session** — exactly 1 row in `public.assessment_sessions` for that participant:
   `session_id=<UUID REDACTED>, assessment_version=1.0, assessment_number=1, status=completed, started_at=2026-10-07 (date only), completed_at=2026-10-07 (date only), pilot_mode=false`
3. **Snapshot** — exactly 1 row in `public.snapshots` for that session:
   `snapshot_id=<UUID REDACTED>, report_version=1.0, generated_at=2026-10-07 (date only), assessment_version=1.0, snapshot_schema_version=1.1`
4. **Responses** — 36 rows in `public.responses` with the recorded `session_id` (31 distinct `item_id`; some items carry multiple answer revisions, consistent with the `changed_at` column). The same 36-row count holds when joined through the participant, so no responses exist outside this session for this participant.
5. **Contacts** — 0 rows in `public.participant_contacts` for the recorded participant.

## Conclusion

The database state for the verified participant is exactly: one participant row, one session, one snapshot, 36 response rows, zero contact rows. All five expectations confirmed.
