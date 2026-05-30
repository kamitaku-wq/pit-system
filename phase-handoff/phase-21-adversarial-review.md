# Phase 22 (16-E) Plan v1 Adversarial Review

## Verdict
Major revisions — two Critical Issues must be resolved before Phase 22 implementation begins.

## Critical Issues (Plan v2 化必須)

1. **A1 RLS blocker: Drizzle UPDATE on  will fail under RLS**
   Plan v1 (§A1 close service) proposes direct Drizzle  via . The existing RLS policy on  requires  for UPDATE, so a transport company performing the close (whose auth.uid() maps to a vendor, not the owning vendor) will receive a row-level permission error.
   Evidence:  shows every UPDATE policy is vendor-scoped;  (Phase 19) worked around this by running as a SECURITY DEFINER RPC ().
   **Recommended fix**: Implement A1 as a SECURITY DEFINER RPC  analogous to the Phase 19 pattern, not as a Drizzle direct update. Plan v2 must reflect this.

2. **A1 wrong history schema:  insert columns are incorrect**
   Plan v1 lists  as the insert payload. Actual schema (supabase/migrations/20240001_transport_order_status_history or equivalent) has columns , , , , , . There is no  column and no bare  column.
   Evidence:  (schema.ts has the canonical shape).
   **Recommended fix**: Correct the insert payload in A1 spec before writing service code. If a trigger auto-inserts history rows, remove the explicit insert from the service entirely.

## Recommended Improvements (時間あれば)

1. **Seed gap explicit in TODO**: The recon file (phase-21-16e-recon-close-order.md) notes  may not exist in alpha seed. Plan v1 §9 mentions this but does not assign ownership or propose a concrete resolution path. Add a named owner and a fallback (e.g., hard-code the two terminal status values in the service rather than querying the seed table).

2. **Double-submit E2E reliability**: Testing double-submit by clicking the submit button twice in Playwright is fragile — the form disables after first submit and the second click is a no-op rather than a real concurrent request. Replace with a  or a direct fetch race, or downgrade to a unit/integration test that is more deterministic.

3. **Fixture cleanup scope**: storageState saves Supabase JWTs. If any test creates Supabase auth users (not just DB rows),  cleanup must call . The plan does not mention this.

4. **Admin invitation deferral evidence**: The recon file  covers spot; admin invitation deferral has no corresponding recon document. Record the rationale (e.g., no existing admin invitation RPC, or out-of-scope for alpha) explicitly in Plan v2 §B.

5. **Parallel A3/A1 safety**: Plan v1 asserts no file overlap between A3 (E2E spec files) and A1 (service files). This is plausible but not verified. Confirm target paths before launching parallel Codex runs.

## Validated Strengths

1. **Spot invitation β deferral is sound.** No existing  RPC, no helper support, no seed rows — all confirmed by recon greps. Forcing it into 16-E would require scope creep across 4+ new files.

2. **storageState pattern for E2E auth is correct.** Phase 19 sealed (respondToTransportOrder) already established a Playwright storageState approach for vendor auth; reusing it avoids re-implementing cookie/JWT management in tests.

3. **Using SELECT FOR UPDATE for close idempotency is appropriate.** Advisory locks (used in Phase 19 accept flow) are per-connection and less predictable across serverless invocations; row-level locking is the right primitive for a finite-row single-order update.

4. **Minimum sealed scope (A1+A2+A3+A4, no spot/admin) is defensible.** The β deferral list is bounded and each item has a traceable reason. The sealed scope is narrow enough to complete in one session.

## Open Questions (Plan v2 起草前に Claude or User が判断)

1. **Does  have a trigger that auto-inserts rows, or must the service insert explicitly?** If there is a trigger, the explicit insert in A1 is both wrong (wrong columns) and redundant.

2. **What is the correct terminal status value set for alpha?**  returns no seed rows. Is it safe to hard-code  in the service, or must it be configurable?

3. **Is there an existing  RPC from any prior phase?** The missing recon file makes this ambiguous. If one exists, the β deferral rationale needs updating.

4. **Should  be restricted to the transport company (vendor) that accepted, or can the pit admin also close?** The RLS design depends on this role question.

## Codex Independent Recommendation

Codex recommends restructuring A1 as follows before any implementation:

1. Write the SECURITY DEFINER RPC  in a new migration, modelled on  from Phase 19. This sidesteps RLS entirely and makes the close operation auditable.
2. The service layer () becomes a thin wrapper that calls the RPC and returns the updated order row — no direct Drizzle UPDATE.
3. The status_history insert, if not handled by a trigger, should be included in the RPC body using the correct columns (, , ).

This is a departure from Plan v1's Drizzle-direct approach but is consistent with the architectural pattern established in Phase 19. Implementing it otherwise will produce a runtime RLS error on the first real test run.

Delegation-ID: codex-adversarial-16e-20260525
