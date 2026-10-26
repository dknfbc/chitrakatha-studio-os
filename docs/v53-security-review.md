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
- The app initializes Firebase Auth and Firestore. The observed client code uses only `users/{uid}` so far: access requests call `setDoc` with `status: 'pending'`, `role: null`, and `createdAt`; sign-in and the auth-state handler read `status === 'approved'`.
- **Registration mismatch:** the current rules deny all client-side profile creation, so the access-request `setDoc` is rejected by Firestore.
- **Approval-field mismatch:** the app checks `status`, while the security test fixtures use `accountStatus`. The field name must be standardized before approval rules or tests can be trusted.
- No app-level finance collection reads/writes were found in the inspected Firebase module. That does not establish that all finance UI flows are implemented or that finance is already safely partitioned.

## Decision

Do **not** relax the current Firestore rules yet. Enabling writes or operational reads without confirming the app's actual data paths and record schema could expose sensitive data or break login and deployment workflows.

## Required implementation order

1. Reconcile the signup/profile bootstrap with the deny-by-default rules and standardize the approval field (`status` versus `accountStatus`) in a deliberate, tested change.
2. Confirm whether finance is already separated from operational documents. If not, plan a migration before allowing finance reads.
3. Implement rule helpers that require an authenticated, approved user and verify role/ownership using trusted fields. Never trust a client-supplied role, owner UID, or assignment ID without checking the corresponding server-controlled records.
4. Keep Super Admin explicitly denied access to both finance collections. Do not expose finance through aggregate documents, dashboards, search, logs, exports, or callable/server endpoints.
5. Add emulator tests for both allowed and denied cases: deployer reads own deployment finance; cannot read another deployer's finance; deployer can read only assignment payments for freelancers assigned to their own deployment; freelancer can read only their own assigned payment; Super Admin and pending users cannot read finance; list/query and manipulated-ID attempts fail; profile safe-field updates cannot alter role or approval.
6. Run the Firestore emulator suite in CI and review its result before considering a pull request.
7. Deploy nothing to Firebase or the live Worker as part of this review.

## Release gate

Rules are not ready to deploy until the actual application data model is verified and all positive/negative emulator tests pass. Firebase Admin SDK/server functions bypass Firestore rules and require separate authorization review.
