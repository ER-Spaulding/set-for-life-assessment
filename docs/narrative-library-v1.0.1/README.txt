SET FOR LIFE — NARRATIVE LIBRARY v1.0.1 (HISTORICAL, IMMUTABLE)

What this is
------------
Byte-exact copies of the three narrative-surface config libraries as they
stood at git commit 54bfb171aa7feb0c7d906d36ddbd57b185cf9298
("feat: complete Set for Life Financial Snapshot experience", 2026-10-06
10:15:58 -05:00, author ER-Spaulding). The narrative library declared
version 1.0.1 (revised 2026-10-05, per its _version_note); the two companion
libraries declared version 1.0. These copies exist so that any historical
Snapshot whose recorded narrative_library_version is 1.0.1 can be rendered
from the exact bytes that produced it, without consulting the live config
files (which have since moved to 2.0.0).

Provenance
----------
Source commit:        54bfb17 (ancestor of current HEAD ee5608f)
Recovery method:      git show 54bfb17:config/<file>  (raw blob content)
Provenance chain:     introduced cdd2b93 (2026-09-30, "Add assessment
                      configuration, schema, design tokens, and module
                      scaffold"); version identifiers added ecfde5b
                      (2026-10-01, "Four immutable version identifiers — and
                      PINNED_VERSION is gone"); last content change to these
                      three files before 54bfb17 was ecfde5b. The blobs are
                      identical at 54bfb17 and at HEAD (ee5608f); the live
                      working tree carries uncommitted 2.0.0 revisions.

Byte-exactness proof (2026-10-08)
---------------------------------
For each file below, `git hash-object` over the extracted copy reproduces the
blob ID that `git rev-parse 54bfb17:<path>` reports, and SHA256 over
`git cat-file -p` matches the file on disk:

  narratives-v1.0.1.json
    blob 54bfb17:config/narratives-v1.0.json        = 6fd4a335173844db95edd66723af0fffa9810e5f
    extracted copy hash-object                       = 6fd4a335173844db95edd66723af0fffa9810e5f  (MATCH)
    sha256 (bytes, 31330)                            = dec8a33dbce740e39fa994595318ed26f98c5c47657c6ed310017e39d43a1db5

  connection-statements-v1.0.1.json
    blob 54bfb17:config/connection-statements-v1.0.json = cb25d28603afd5f14b664bada86b38f23112a1dd
    extracted copy hash-object                          = cb25d28603afd5f14b664bada86b38f23112a1dd  (MATCH)
    sha256 (bytes, 8008)                                = 224a99e73a5ed1e58041546d1d923255891fc032abf90101fcdfa8d1059aa9e0

  signal-state-vocabulary-v1.0.1.json
    blob 54bfb17:config/signal-state-vocabulary-v1.0.json = b2baae6a811219c8eb8e95299234ba41c552108e
    extracted copy hash-object                            = b2baae6a811219c8eb8e95299234ba41c552108e  (MATCH)
    sha256 (bytes, 11475)                                 = 7a8b4bda07857747d31367dda90393d01d9e60fc2aced6ec9e1df9067285af09

No byte was unrecoverable; there is no gap in the recovery.

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
3. NEW FILENAMES: the -v1.0.1 suffix encodes the library version, distinct
   from the live files' -v1.0 names, so no live file is shadowed or confused.
4. Canonical JSON content hashes (sorted-key, per lib/assessment/versions.ts
   contentHash) must be computed from a copy if ever needed for verification;
   this directory preserves the RAW bytes, which are the authoritative thing.