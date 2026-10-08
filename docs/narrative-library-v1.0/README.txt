SET FOR LIFE — NARRATIVE LIBRARY v1.0 (HISTORICAL, IMMUTABLE)

What this is
------------
Byte-exact copies of the three narrative-surface config libraries as they
stood at git commit ecfde5b363fb8aac5101458d6dcc1bb39d2ae3f6
("Four immutable version identifiers — and PINNED_VERSION is gone",
2026-10-01 19:52:11 -05:00, author Claude <noreply@anthropic.com>). All three
libraries declared version 1.0 at this commit — the FIRST commit at which any
of them carried a version field, and therefore the canonical v1.0 release
state of the narrative library. These copies exist so that any historical
Snapshot whose recorded narrative_library_version is 1.0 can be rendered from
the exact bytes that produced it, without consulting the live config files
(which have since moved to uncommitted 2.0.0 revisions in the working tree).

Provenance
----------
Source commit:        ecfde5b (ancestor of current HEAD ee5608f)
Recovery method:      git show ecfde5b:config/<file>  (raw blob content)
Provenance chain:     introduced cdd2b93 (2026-09-30, "Add assessment
                      configuration, schema, design tokens, and module
                      scaffold") WITHOUT version fields; narratives content
                      revised cd11db8 (2026-10-01 16:32, big_picture_templates
                      key change); version identifiers added ecfde5b
                      (2026-10-01 19:52) — the state archived here; patched
                      to 1.0.1 at 54bfb17 (2026-10-06, archived in
                      docs/narrative-library-v1.0.1/). The connection and
                      vocabulary blobs are unchanged from ecfde5b through HEAD
                      ee5608f; the narratives blob changed at 54bfb17.

Byte-exactness proof (2026-10-08)
---------------------------------
For each file below, `git hash-object` over the extracted copy reproduces the
blob ID that `git rev-parse ecfde5b:<path>` reports, and SHA256 over
`git cat-file -p` matches the file on disk:

  narratives-v1.0.json
    blob ecfde5b:config/narratives-v1.0.json        = 2348f3c4ffd60be1391be803464e44ccbc79a34c
    extracted copy hash-object                       = 2348f3c4ffd60be1391be803464e44ccbc79a34c  (MATCH)
    sha256 (bytes, 30299)                            = 556507abf3ad51a34501308a9f4462206295e7b213f19ed9cf2a2194b924573d
    canonical content hash (sorted-key, lib/assessment/versions.ts contentHash)
                                                     = 3960a4d396f8eb68f53dc351e83e020ab9de548771a0cc6133451e33110f9a2d

  connection-statements-v1.0.json
    blob ecfde5b:config/connection-statements-v1.0.json = cb25d28603afd5f14b664bada86b38f23112a1dd
    extracted copy hash-object                          = cb25d28603afd5f14b664bada86b38f23112a1dd  (MATCH)
    sha256 (bytes, 8008)                                = 224a99e73a5ed1e58041546d1d923255891fc032abf90101fcdfa8d1059aa9e0
    canonical content hash                              = b28fd325207c324cb75a79263b89bd33b68e8c0bafcc27d1ce2439c3f1083ff2

  signal-state-vocabulary-v1.0.json
    blob ecfde5b:config/signal-state-vocabulary-v1.0.json = b2baae6a811219c8eb8e95299234ba41c552108e
    extracted copy hash-object                            = b2baae6a811219c8eb8e95299234ba41c552108e  (MATCH)
    sha256 (bytes, 11475)                                 = 7a8b4bda07857747d31367dda90393d01d9e60fc2aced6ec9e1df9067285af09
    canonical content hash                                = 7288dba633652c6b0939e5654f615a9121f738054814e4b4e1058004c8542361

No byte was unrecoverable; there is no gap in the recovery.

Downloads cross-check — IMPORTANT
---------------------------------
The locked canonical /Users/erspaulding/Downloads/SFL_*.json copies were
compared byte-for-byte against every historical state of these files
reachable in this repository (all commits via git log --all, the complete
HEAD reflog, the one dangling commit fd06955, and the object store — fsck
reports zero dangling and zero unreachable blobs). NONE of the three Downloads
copies is the v1.0 release state:

  SFL_connection-statements-v1.0.json (7814 bytes, sha256 3fae1d1c...)
    = the PRE-versioning state at cdd2b93 (2026-09-30): byte-identical to the
    first 7812 bytes of the ecfde5b blob, then '}' where ecfde5b continues
    with the 194-byte version/_version_note trailer.

  SFL_signal-state-vocabulary-v1.0.json (11281 bytes, sha256 02101d7c...)
    = the same PRE-versioning cdd2b93 state: identical through byte 11279,
    then '}' instead of the trailer.

  SFL_narratives-v1.0.json (29760 bytes, sha256 bc476e3c...)
    matches NO commit in this repository. It is a hybrid that appears to have
    been assembled around the 2026-10-05 1.0.1 revision but was never
    committed: it carries the 1.0.1 activation-band copy (A1.LOW, A2.LOW,
    A4.LOW, A4.HIGH patched) but the PRE-ecfde5b big_picture_templates key
    set (NO_FRICTION present; NO_MEANINGFUL_FRICTION and DEVELOPING_PICTURE
    absent) and no version/_version_note trailer. Closest ancestor is
    54bfb17 (the 1.0.1 release, sha256 dec8a33d...): bytes 1-28305 are a
    byte-identical common prefix (prefix sha256
    f4a246189bf22ef9eff7fbbe580523aa307246deb1fefe30925a2ae3ce103bbe), with
    exactly 5 structural differences after that point. This file matches no
    blob reachable from any ref, the reflog, or a dangling object.

The v1.0 state recovered here from ecfde5b is the sole authoritative v1.0.
The manifest.json records this gap in full; nothing was reconstructed,
normalized, or invented to reconcile the Downloads copies.

Rules of this directory
-----------------------
1. IMMUTABLE: files in this directory are frozen historical artifacts. Never
   edit, reformat, or normalize them in place. A correction is a new
   versioned directory, never a modification.
2. NOT LIVE CONFIG: the application reads config/narratives-v1.0.json,
   config/connection-statements-v1.0.json and config/signal-state-vocabulary-
   v1.0.json by exact filename. Nothing under docs/ is imported or loaded by
   application code. These copies intentionally sit outside that path so the
   current loaders cannot pick them up.
3. FILENAMES: the three files keep the live config filenames. This directory
   itself is the version marker (docs/narrative-library-v1.0/), matching the
   convention of docs/narrative-library-v1.0.1/. The directory name encodes
   the library version; the files preserve the recovered byte content
   verbatim. No live file is overwritten, shadowed, or renamed.
4. Canonical JSON content hashes (sorted-key, per lib/assessment/versions.ts
   contentHash) are recorded in manifest.json; this directory preserves the
   RAW bytes, which are the authoritative thing.
5. Ingestion copies for verification runs (e.g. COPY_LIBRARY_DIR staging for
   tests/unit/copy-library-consistency.mjs) may be made FROM these files;
   these files themselves must never be moved, renamed, or edited by a run.