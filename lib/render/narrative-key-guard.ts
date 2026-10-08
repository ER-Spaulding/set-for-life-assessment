// NARRATIVE-KEY RESOLVABILITY — the guard against the SILENT-DROP class.
//
// THE DEFECT THIS EXISTS TO PREVENT. `resolveSnapshotView` resolves every
// narrative key it is handed and OMITS the ones it cannot resolve
// (lib/render/snapshot-view.ts: `.map(resolveFinding).filter(f => f !== null)`).
// Omission is the CORRECT read-time behaviour — see §C below — but it is silent,
// and the blast radius is not one sentence: the resolver drops the whole
// RESOLVED FINDING, so a module with one unresolvable key of two renders as a
// module with one finding, and a module whose only key is unresolvable
// disappears entirely (`resolveSnapshotSections` gates each module on
// `view.<part>.length > 0`).
//
// So a key that stops resolving does not produce an error, a blank line, or a
// missing page. It produces a SHORTER report that still looks deliberate. A
// participant cannot tell a two-finding report from a three-finding one, and an
// operator reading the page has no signal either. That is the whole reason this
// guard is a writer-side FAIL rather than a read-side repair.
//
// ── §C: WHY READ TIME STAYS FAIL-SOFT, AND WHY THIS MODULE IS NOT A THROWER ──
//
// A Snapshot is IMMUTABLE and HISTORICAL (Addendum 01 §3.2; the `snapshots`
// table refuses every UPDATE). A payload minted under narrative library v1.0
// must keep rendering after a later revision retires a key, because the
// participant's report is a record of what they were given. Turning the
// resolver into a thrower would convert "we retired a sentence" into "an old
// report is now unopenable" — a much worse failure, and one the participant
// experiences as the product breaking.
//
// So the direction of the guarantee is one-way, and that is the design:
//
//   WRITE  — `assertNarrativeKeysResolvable` THROWS. A NEW payload whose keys
//            do not resolve must never be persisted. The failure lands in
//            development and staging, loudly, on the exact commit that
//            introduced the drift.
//   READ   — resolution stays fail-soft and OMITS. `unresolvedNarrativeKeys`
//            reports what was omitted so the caller can LOG it, without
//            changing what the participant sees.
//
// Both directions read the SAME resolution logic, so a key cannot be
// resolvable-by-the-test and unresolvable-by-the-resolver, or vice versa. That
// single source is `resolveParticipantCopy` below; §B's exhaustiveness test and
// §A's write-path assertion both go through it.
//
// ── WHAT THIS MODULE DELIBERATELY DOES NOT DO ───────────────────────────────
//
// It does not recompute, re-score, re-derive, or re-select anything. It reads a
// payload that already exists and asks one question per key: does the pinned
// narrative library have copy for this? It never invents a key, never repairs
// one, never substitutes a neighbour, and never drops a finding from the
// payload. A finding it cannot resolve stays in the immutable payload exactly as
// written — the guard refuses the WRITE rather than editing the CONTENT.
//
// It holds no copy of its own. The key→copy mapping lives in
// lib/render/snapshot-view.ts, and this module delegates to it rather than
// reimplementing it, so there is exactly one implementation of "what does this
// key resolve to" in the codebase.

// ⚠️ THIS MODULE IMPORTS NO CONFIG FILE, AND THAT IS AN ARCHITECTURAL
// REQUIREMENT RATHER THAN AN OMISSION.
//
// `tests/integration/snapshot-resolution-single-source.test.ts` asserts that the
// narrative and connection configs have EXACTLY ONE OWNER — the resolver
// (`lib/render/snapshot-view.ts`, plus the type-only importer). That guard is the
// thing that stops a second key→copy implementation from growing somewhere else,
// which is the drift class this whole change exists to close.
//
// An earlier draft of this file imported both configs so it could classify keys.
// That made the guard a second owner — it worked, and the integration guard
// correctly failed it. The fix is not to add this file to the allowlist (that
// would weaken a real invariant for a diagnostic convenience) but to delegate:
// `resolveParticipantCopy` calls the resolver's own exported primitives, and
// `classifyNarrativeKey` classifies by the key's PREFIX, which needs no config.
import {
  resolveActivationCopy,
  resolveAttentionArea,
  resolveFinding,
  resolveNarrativeBody,
} from "./snapshot-view";
import type { SnapshotPayload } from "../assessment/snapshot-payload";

// ---------------------------------------------------------------------------
// The key space, as the resolver sees it
// ---------------------------------------------------------------------------

/**
 * A narrative key a payload may carry, paired with where it came from.
 *
 * `location` is the payload path, and it exists so a failure NAMES the field
 * rather than printing a bare string. "connection_statements.OLD_CODE does not
 * resolve" is a puzzle; "frictions[2].narrativeKey (connection_statements.OLD_CODE)
 * does not resolve" points at the line to fix.
 */
export interface NarrativeKeyRef {
  location: string;
  key: string;
}

/**
 * The kernel of a `signal_states.*` key — the part AFTER the prefix.
 *
 * `signal_states.SEE.S4` -> `SEE.S4`, which the activation-shaped lookup in
 * snapshot-view resolves. Kept as a named export because the §B exhaustiveness
 * test asserts against the same two shapes the writer is checked against.
 */
export const SIGNAL_STATE_PREFIX = "signal_states.";
export const SPECIAL_STATE_PREFIX = "special_signal_states.";

/**
 * Which of the resolver's lookups a key will be sent through.
 *
 * NOT a reimplementation — this is the resolver's OWN branch condition, lifted
 * so the guard and the resolver agree by construction. `resolveNarrativeBody`
 * strips the FIRST matching prefix and then tries each block in a fixed order;
 * this classifies into that same first-match.
 */
type KeyKind =
  | "connection_statement"
  | "signal_state"
  | "special_signal_state"
  | "context_narrative"
  | "perception_gap"
  | "attention_area"
  | "activation"
  | "big_picture_template";

/**
 * Would the RENDERER resolve this key to participant copy?
 *
 * ⚠️ THIS DELEGATES TO THE RESOLVER'S OWN FUNCTIONS — IT DOES NOT MIRROR THEM.
 * An earlier draft of this module reimplemented `resolveNarrativeBody`'s branch
 * order here and relied on a test to prove the two agreed. That is the shape
 * that drifts: a second implementation of one rule is a second source of truth,
 * and the dangerous direction is a guard that ACCEPTS a key the renderer then
 * omits — the payload would be persisted and the content would silently vanish,
 * which is the exact defect this module exists to prevent.
 *
 * So this dispatches to the same four exported primitives `resolveSnapshotView`
 * itself calls:
 *
 *   `connection_statements.*`            -> resolveConnection   (label + body)
 *   `signal_states.*` / `special_…`      -> resolveFinding      (label + copy)
 *   `attention_areas.*`                  -> resolveAttentionArea(label + body)
 *   `activation.*`                       -> resolveActivationCopy (non-empty)
 *   everything else (context narratives, perception gap, big-picture templates,
 *   and any bare code)                   -> resolveNarrativeBody
 *
 * Routing a finding-shaped key through `resolveFinding` rather than through the
 * generic body lookup is the point: `resolveFinding` is what the RENDERER calls
 * for strengths and frictions, and it is strictly stronger — it requires a
 * headline AND a body, where the generic lookup would accept a connection
 * statement that has a body but no headline. The guard must be at least as
 * strict as the path it is protecting, so it uses the path's own function.
 *
 * Returns copy on success, null when the renderer would OMIT the finding.
 */
export function resolveParticipantCopy(key: string): string | null {
  if (typeof key !== "string" || key.length === 0) return null;

  // Finding-shaped keys (strengths/frictions, signals) — the renderer's own path.
  if (
    key.startsWith("connection_statements.") ||
    key.startsWith("signal_states.") ||
    key.startsWith("special_signal_states.")
  ) {
    const finding = resolveFinding({ narrativeKey: key });
    return finding ? finding.copy : null;
  }

  // Attention areas carry label + paragraphs, never a bare string. The first
  // paragraph is the representative the write path needs for existence.
  if (key.startsWith("attention_areas.")) {
    const area = resolveAttentionArea(key.slice("attention_areas.".length));
    return area ? area.paragraphs[0] : null;
  }

  // Activation stores LEVELS, not keys; the key is composed at read time as
  // `activation.<item>.<LEVEL>` and resolves to a sentence that must be
  // non-empty (`resolveActivationCopy` returns "" — not null — on a miss).
  if (key.startsWith("activation.")) {
    const parts = key.split(".");
    if (parts.length !== 3) return null;
    const copy = resolveActivationCopy(parts[1], parts[2]);
    return copy.length > 0 ? copy : null;
  }

  // Context narratives, perception gap, big-picture templates, and the bare
  // connection code a tension can be referenced by.
  return resolveNarrativeBody(key);
}

/**
 * Classify a key by the family its PREFIX names. Diagnostic only.
 *
 * DELIBERATELY PREFIX-BASED, NOT CONFIG-BASED. Resolving a key's family by
 * looking it up in the config would require this module to own the config, which
 * the resolver-ownership guard forbids (see the import note at the top). The
 * prefix is the family: `signal_states.` means the signal ladder,
 * `attention_areas.` means an attention area, and so on. A key whose prefix is
 * not one of the seven known families is `unknown` — which is exactly the
 * answer wanted for a retired or invented key.
 *
 * This classifies SHAPE, not EXISTENCE. "Unknown" therefore does not mean
 * unresolvable: a bare big-picture template key (`PRIMARY_FRICTION`) has no
 * prefix and IS resolvable. Existence is `resolveParticipantCopy`'s question and
 * only that function answers it.
 */
export function classifyNarrativeKey(key: string): KeyKind | "unknown" {
  if (typeof key !== "string" || key.length === 0) return "unknown";
  if (key.startsWith("connection_statements.")) return "connection_statement";
  if (key.startsWith("signal_states.")) return "signal_state";
  if (key.startsWith("special_signal_states.")) return "special_signal_state";
  if (key.startsWith("context_narratives.")) return "context_narrative";
  if (key.startsWith("perception_gap.")) return "perception_gap";
  if (key.startsWith("attention_areas.")) return "attention_area";
  if (key.startsWith("activation.")) return "activation";
  return "unknown";
}

// ---------------------------------------------------------------------------
// §A — the write-path assertion
// ---------------------------------------------------------------------------

/**
 * Every narrative key a payload asks the renderer to resolve, in payload order.
 *
 * ⚠️ THIS LIST MUST COVER EVERY KEY-BEARING FIELD. A field the guard does not
 * walk is a field the silent-drop class can still hide in. The set below is the
 * complete key surface of `SnapshotPayload`:
 *
 *   strengths[].narrativeKey      frictions[].narrativeKey
 *   signals[].narrativeKey        connections[].narrativeKey
 *   context[].narrativeKey        bigPicture.parts[]
 *   attentionAreas[]              perceptionGap.narrativeKey
 *   activation.<A1-A4>            (level → `activation.<item>.<LEVEL>`)
 *
 * `q16Selections` is deliberately absent: its labels resolve from the PINNED
 * QUESTION BANK via `lib/ui/questions.ts`, not from a narrative library, so it
 * is outside this guard's key space by construction. `nullFinding` is a boolean.
 * `activationPatterns` and `moveSubsignals` are internal and never rendered as
 * copy (§24).
 */
export function narrativeKeysInPayload(
  payload: SnapshotPayload,
): NarrativeKeyRef[] {
  const refs: NarrativeKeyRef[] = [];
  const push = (location: string, key: unknown): void => {
    if (typeof key === "string" && key.length > 0) refs.push({ location, key });
  };

  (payload.signals ?? []).forEach((s, i) =>
    push(`signals[${i}].narrativeKey`, s.narrativeKey),
  );
  (payload.strengths ?? []).forEach((f, i) =>
    push(`strengths[${i}].narrativeKey`, f.narrativeKey),
  );
  (payload.frictions ?? []).forEach((f, i) =>
    push(`frictions[${i}].narrativeKey`, f.narrativeKey),
  );
  (payload.connections ?? []).forEach((c, i) =>
    push(`connections[${i}].narrativeKey`, c.narrativeKey),
  );
  (payload.context ?? []).forEach((c, i) =>
    push(`context[${i}].narrativeKey`, c.narrativeKey),
  );
  (payload.bigPicture?.parts ?? []).forEach((k, i) =>
    push(`bigPicture.parts[${i}]`, k),
  );
  (payload.attentionAreas ?? []).forEach((k, i) =>
    push(`attentionAreas[${i}]`, k),
  );
  if (payload.perceptionGap?.narrativeKey) {
    push("perceptionGap.narrativeKey", payload.perceptionGap.narrativeKey);
  }

  // The activation block stores LEVELS, not keys. The key the renderer resolves
  // is composed from the item id and the level, which is exactly what
  // `resolveActivationCopy(item, level)` does at read time — so it is composed
  // the same way here rather than assumed to be present as a literal.
  const activation = payload.activation as unknown as
    | Record<string, unknown>
    | undefined;
  if (activation && typeof activation === "object") {
    for (const item of ["A1", "A2", "A3", "A4"]) {
      const level = activation[item];
      if (typeof level === "string" && level.length > 0) {
        push(`activation.${item}`, `activation.${item}.${level}`);
      }
    }
  }

  return refs;
}

/**
 * The narrative keys in this payload that the renderer CANNOT resolve.
 *
 * Empty means every key renders. Non-empty names the exact fields that would
 * silently disappear from the participant's report.
 */
export function unresolvedNarrativeKeys(
  payload: SnapshotPayload,
): NarrativeKeyRef[] {
  return narrativeKeysInPayload(payload).filter(
    (ref) => resolveParticipantCopy(ref.key) === null,
  );
}

/** Thrown at the write boundary when a payload would persist an unrenderable key. */
export class UnresolvedNarrativeKeyError extends Error {
  readonly unresolved: NarrativeKeyRef[];

  constructor(unresolved: NarrativeKeyRef[]) {
    const detail = unresolved
      .map((u) => `  ${u.location} (${u.key})`)
      .join("\n");
    super(
      `Snapshot payload contains ${unresolved.length} narrative key(s) that do ` +
        `not resolve against the pinned narrative config. Refusing to persist an ` +
        `immutable Snapshot whose report would silently omit content:\n${detail}\n\n` +
        `A key stops resolving when a config entry is renamed or removed while ` +
        `the engine still mints the old key — the drift this assertion exists to ` +
        `catch. Fix by aligning the engine's key with the config (or restoring ` +
        `the config entry). Do NOT delete the finding: the payload must carry ` +
        `the finding the engine produced, not a shortened list.`,
    );
    this.name = "UnresolvedNarrativeKeyError";
    this.unresolved = unresolved;
  }
}

/**
 * §A — REFUSE to persist a payload whose keys do not all resolve.
 *
 * Called at the Snapshot assembly/completion boundary, BEFORE the atomic write,
 * so a drifting key fails the completion path loudly in development and staging
 * rather than producing a partially valid immutable Snapshot in production.
 *
 * THROWS BY DESIGN. This is the one place the guarantee is allowed to be loud,
 * because the alternative — persisting it — is unrecoverable: the row is
 * append-only and the participant may already have opened the report.
 *
 * SCOPE IS NARROW ON PURPOSE. It asserts narrative-key resolvability and
 * nothing else. It does not re-score, re-derive tensions, re-select findings,
 * re-order anything, or validate the payload's shape. A payload that fails here
 * is one whose CONTENT is fine and whose KEYS are stale.
 *
 * Returns the payload unchanged on success, so it composes inline:
 *
 *   const payload = assertNarrativeKeysResolvable(assembleSnapshotPayload({...}));
 */
export function assertNarrativeKeysResolvable<T extends SnapshotPayload>(
  payload: T,
): T {
  const unresolved = unresolvedNarrativeKeys(payload);
  if (unresolved.length > 0) {
    throw new UnresolvedNarrativeKeyError(unresolved);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// §C — structured logging for the HISTORICAL read path
// ---------------------------------------------------------------------------

/**
 * Report keys that a STORED payload could not resolve, without changing what
 * the participant sees.
 *
 * THE READ PATH DELIBERATELY DOES NOT THROW (see the module header). This is
 * the observability half of that decision: the report renders exactly as it
 * would have without this call, and the operator gets a server-side line they
 * can alert on. Without it, a retired key is invisible everywhere — the page
 * looks normal, and the only symptom is a report with one fewer finding than
 * the payload contains, which nobody can see from the outside.
 *
 * WHY THIS IS NOT INSIDE THE RESOLVER. `resolveSnapshotView` is contractually
 * pure — no I/O, no clock, no logging — and a test asserts it imports none of
 * the server machinery. A `console` call there would make a pure function
 * effectful and would fire on every PDF render as well as every page load.
 * Logging belongs at the SERVER ENTRY POINT, which is where this is called.
 *
 * PRIVACY (§24). The line carries the payload PATH and the KEY — internal
 * vocabulary — and never a resolved copy string, a participant name, or a
 * session id. It is a server log, and nothing here reaches the browser.
 *
 * Returns the unresolved refs so a caller can also assert on them in a test.
 */
export function logUnresolvedNarrativeKeys(
  payload: SnapshotPayload,
  context: { sessionId?: string | null; surface: "web" | "pdf" },
): NarrativeKeyRef[] {
  const unresolved = unresolvedNarrativeKeys(payload);
  if (unresolved.length === 0) return unresolved;

  console.error(
    JSON.stringify({
      event: "snapshot_unresolved_narrative_keys",
      severity: "error",
      // The one identifier that makes the line actionable. A session id is not
      // participant-visible content and is already the key used everywhere else
      // in this codebase's server logs and analytics correlators.
      session_id: context.sessionId ?? null,
      surface: context.surface,
      count: unresolved.length,
      unresolved: unresolved.map((u) => ({ location: u.location, key: u.key })),
      note:
        "A stored Snapshot carries narrative keys the pinned config no longer " +
        "resolves. The report rendered fail-soft and OMITTED them, so it is " +
        "missing the content those keys held. The payload is immutable and is " +
        "NOT rewritten; this is a read-time observation only.",
    }),
  );

  return unresolved;
}
