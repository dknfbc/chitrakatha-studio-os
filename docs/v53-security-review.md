# v53 Security Review — Findings and Safe Next Step

**Status:** Review only. No Firebase rules or live deployment changed.

## Verified from the repository

- `firestore.rules` permits a signed-in user to read only `users/{theirUid}`.
- Client-side create/update/delete operations on user profiles are denied.
- All other Firestore reads and writes are denied by the catch-all rule.
- `docs/permission-matrix-v2.md` specifies separate finance partitions:
  - `financeDeployment/{deploymentId}` for client package, advance, balance, and related client-finance fields.
  - `financeAssignments/{assignmentId}` for a freelancer's payment details for a particular assignment.
  - `deployments/{deploymentId}` and assignment records should contain operational fields only.
- The current tests seed `financialRecords/payment-1` and verify broad denial. They do not test the intended future positive case (a deployer reading their own finance document) or the new finance collections.
- The main app HTML and `public/index.html` are each approximately 4.3 MB and the GitHub file reader did not return their content. The app's actual Firestore paths, write patterns, and auth/profile bootstrap therefore remain unverified.

## Decision

Do **not** relax the current Firestore rules yet. Enabling writes or operational reads without confirming the app's actual data paths and record schema could expose sensitive data or break login and deployment workflows.

## Required implementation order

1. Inspect the app's Firebase initialization, authentication/profile bootstrap, and every Firestore read/write path.
2. Confirm whether finance is already separated from operational documents. If not, plan a migration before allowing finance reads.
3. Implement rule helpers that require an authenticated, approved user and verify role/ownership using trusted fields. Never trust a client-supplied role, owner UID, or assignment ID without checking the corresponding server-controlled records.
4. Keep Super Admin explicitly denied access to both finance collections. Do not expose finance through aggregate documents, dashboards, search, logs, exports, or callable/server endpoints.
5. Add emulator tests for both allowed and denied cases: deployer reads own deployment finance; cannot read another deployer's finance; deployer can read only assignment payments for freelancers assigned to their own deployment; freelancer can read only their own assigned payment; Super Admin and pending users cannot read finance; list/query and manipulated-ID attempts fail; profile safe-field updates cannot alter role or approval.
6. Run the Firestore emulator suite in CI and review its result before considering a pull request.
7. Deploy nothing to Firebase or the live Worker as part of this review.

## Release gate

Rules are not ready to deploy until the actual application data model is verified and all positive/negative emulator tests pass. Firebase Admin SDK/server functions bypass Firestore rules and require separate authorization review.
