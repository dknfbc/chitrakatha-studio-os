# v53 Security Review — Findings and Safe Next Step

**Status:** Review only. No Firebase rules or live deployment changed.

## Verified from the repository

- `firestore.rules` permits a signed-in user to read only `users/{theirUid}`.
- Signup can create only a minimal pending request with exactly `email`, `requestedRole`, `status`, `role`, and `createdAt`; it requires `status: 'pending'` and `role: null`.
- Client-side profile updates and deletes are denied. All other Firestore reads and writes are denied by the catch-all rule.
- The app's actual access-request payload includes `uid`, `name`, `email`, `requestedRole`, `status: 'pending'`, `role: null`, and `createdAt`. The initial rules incorrectly rejected `uid` and `name`; the rules now allow those optional fields only when `uid` matches the document/auth UID and `name` is a non-empty string. The auth-state handler checks `status === 'approved'`.
- Added emulator coverage for the exact app-shaped signup payload and for rejecting a mismatched `uid`.
- Test fixtures use `role` and `status`; the earlier `accountStatus` mismatch note is stale and has been removed.
- The test suite currently verifies pending signup, prevention of self-approval/promotion, profile-read isolation, and denial of finance/operational records. It intentionally does **not** grant any positive finance or operational access yet.
- The current tests seed synthetic examples for `financialRecords`, `financeDeployment`, `financeAssignments`, and `deployments`. These are test fixtures, not proof that the live app already uses those schemas.
- The permission draft proposes separate finance partitions:
  - `financeDeployment/{deploymentId}` for client package, advance, balance, and related client-finance fields.
  - `financeAssignments/{assignmentId}` for a freelancer's payment details for a particular assignment.
  - Operational deployment and assignment records must not contain finance values.
- The repository's inspected Firebase code has not established the complete deployment, assignment, attachment, or finance schema. A full application data-path audit is still required before enabling those permissions.

## Additional application audit findings

- The current `public/index.html` / `Chitrakatha_Studio_OS_v52_firebase_auth.html` blob (SHA `1ad6da5bd8ba4711527d544c0a6548cee00295e1`) has an HTML title identifying itself as **v41 · Clean Starter**, despite the v52 filename.
- Its Firebase module only uses Authentication plus `users/{uid}` profile reads/writes. Operational app state (`deployments`, `offers`, `unavailableDates`, and related state) is persisted to browser `localStorage`, not Firestore. The present operational UI is device-local and does not provide shared team data across devices/accounts.
- The same file still contains gear-custody state identifiers (`gearChecks`, `gearMissing`, `gearAudit`, `gearConfirmed`). This conflicts with the explicit requirement to exclude Gear Custody and must be resolved in the correct app base before release.
- Do not silently rewrite the 4.29 MB app file as part of this security-only branch. Confirm the intended v52 base/source artifact first, then remove the excluded feature and plan a reviewed migration from local-only operational state to secure shared data.

## Decision

Keep deny-by-default access for all operational and financial collections until the actual application data model and every relevant read/write path are verified. Do not loosen rules just to make screens appear functional.

## Next implementation sequence

1. Map the actual app's Firestore paths and payloads for deployment creation, assignments, availability, profile approval, and financial UI. Record the source file and exact fields for each path.
2. Define a deployment placeholder lifecycle for work dates supplied by Upasak: `draft` → `details_pending` → `ready_for_review` → `confirmed`. Store only known, confirmed details; never invent client names, rituals, freelancers, roles, call times, or amounts.
3. Keep draft/unconfirmed dates out of confirmed-booking and availability-conflict calculations. Only an explicit Deployer confirmation should make the date a confirmed booking.
4. Design attachment metadata for later photos/screenshots with uploader, upload time, and parent deployment reference. Treat extracted details as suggestions requiring Deployer review; do not auto-publish them. Choose and review storage access rules before implementing uploads.
5. Keep client finance and assignment payments in separate records, with explicit server-enforced ownership checks. Super Admin must remain denied finance access even if combined with other roles. Review server functions separately because Firebase Admin SDK bypasses Firestore rules.
6. Add positive and negative emulator tests for every intended permission, including direct reads, list/query scope, manipulated IDs, role combinations, and attachment access.
7. Run the emulator suite in CI and review its result before opening/merging a pull request.

## Release gate and guardrails

- No Firebase rules or live Worker deployment as part of this review.
- Do not create a new Firebase project or enable billing.
- Keep v32 and v46 untouched.
- Keep Gear Custody excluded.
- Do not add fake bookings, roster entries, Season Radar dates, or financial values.
- Do not enable operational or finance reads until the real app schema and tests support the exact permission.
