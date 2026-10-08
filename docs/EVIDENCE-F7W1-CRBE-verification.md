# Workflow Evidence — SELECT-only DB verification for SFL F7W1-CRBE

Date: 2026-10-08
Method: psql against SUPABASE_DIRECT_URL from `.env.local` (password `@` percent-encoded as `%40`; final host separator preserved). Session pooler `aws-0-us-east-2.pooler.supabase.com:5432/postgres`.
Scope: SELECT-only. No UPDATE, no DELETE, no writes of any kind to the database. No commit, no push.

## Verified identifiers

| Item | Value |
|---|---|
| Participant ID | `54588d5d-3e17-46fd-b5aa-ccaa78745f76` |
| SFL Number | `F7W1-CRBE` |
| Session ID | `660fef00-69a1-42da-871c-200e57038bda` |
| Snapshot ID | `263373da-421c-4875-925d-9f7edcbf7f07` |
| Response rows | 36 |

## Verification detail (all SELECT)

1. **Participant row** — exactly 1 row in `public.participants` with `sfl_number = 'F7W1-CRBE'`:
   `participant_id=54588d5d-3e17-46fd-b5aa-ccaa78745f76, status=active, created_at=2026-10-07 03:47:34.391492+00, claimed_at=NULL, state_code=IL`
2. **Session** — exactly 1 row in `public.assessment_sessions` for that participant:
   `session_id=660fef00-69a1-42da-871c-200e57038bda, assessment_version=1.0, assessment_number=1, status=completed, started_at=2026-10-07 03:47:34.576551+00, completed_at=2026-10-07 04:01:52.572+00, pilot_mode=false`
3. **Snapshot** — exactly 1 row in `public.snapshots` for that session:
   `snapshot_id=263373da-421c-4875-925d-9f7edcbf7f07, report_version=1.0, generated_at=2026-10-07 04:01:52.675664+00, assessment_version=1.0, snapshot_schema_version=1.1`
4. **Responses** — 36 rows in `public.responses` with `session_id = 660fef00-69a1-42da-871c-200e57038bda` (31 distinct `item_id`; some items carry multiple answer revisions, consistent with the `changed_at` column). The same 36-row count holds when joined through the participant, so no responses exist outside this session for this participant.
5. **Contacts** — 0 rows in `public.participant_contacts` for participant `54588d5d-3e17-46fd-b5aa-ccaa78745f76`.

## Conclusion

The database state for F7W1-CRBE is exactly: one participant row, one session, one snapshot, 36 response rows, zero contact rows. All five expectations confirmed.