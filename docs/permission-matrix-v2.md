# Chitrakatha Studio OS — Permission Matrix v2

**Status:** Draft for review. Not deployed and not yet implemented in Firestore rules.

## Role model

There is no Admin role or Admin section.

- **Super Admin:** System administration and explicitly approved operational access. Must never access financial information, directly or indirectly, including through combined roles.
- **Deployer:** Creates/manages work they deployed. Can access financial details only for their own deployed work and only for freelancers assigned to that work.
- **Freelancer:** Can access their own assignment/payment details for work they are assigned to. Cannot see client package/advance/balance or another freelancer's payment details.
- **Pending user:** Can access only their own limited profile. No operational or financial access until approved.

## Non-negotiable finance boundaries

| Financial data | Super Admin | Deployer | Freelancer | Pending |
|---|---|---|---|---|
| Client package, advance, balance | DENY always | Own deployed work only | DENY | DENY |
| Freelancer payment for an assignment | DENY always | Only if the freelancer is assigned to their own deployed work | Own assignment only | DENY |
| Another deployer's financial records | DENY | DENY | DENY | DENY |
| Another freelancer's payment details | DENY | Only for a freelancer assigned to their own deployed work | DENY | DENY |
| Finance totals, dashboards, exports, logs, search indexes | DENY always, including indirect/derived data | Own deployed-work scope only | Own assignment-only payment information | DENY |

## Operational access baseline

| Resource/action | Super Admin | Deployer | Freelancer | Pending |
|---|---|---|---|---|
| Read/edit own safe profile fields | Own profile only; privileged fields protected | Own profile only | Own profile only | Own limited profile only |
| Approve users / assign roles | Controlled server-side workflow; cannot self-promote | DENY | DENY | DENY |
| Read operational deployment details | Approved operational fields only; no finance/private notes by default | Own deployed work | Work assigned to them only | DENY |
| Create deployment | Only if explicitly approved | Own deployment | DENY | DENY |
| Edit deployment/day plan | Only approved operational permissions | Own deployed work | DENY; may request correction | DENY |
| Assign/change another person's assignment | Only approved operational workflow | Own deployed work, subject to assignment workflow | DENY | DENY |
| Own assignment response | Approved operational fields only | Own deployed work | Can respond to own offer; cannot silently withdraw from confirmed work | DENY |
| Availability | Operational signal only when needed; private reason denied by default | Scheduling signal only for own work; private reason denied by default | Own availability and private reason | DENY |
| Season Radar source dates | Approved management of source dates; no finance | Read only | Read only | DENY until approved |
| Private notes | DENY by default | Own notes / authorized own-work notes only | Own permitted notes only | DENY |
| Audit events | Redacted, non-financial operational events only if explicitly approved | Own-work events only if explicitly approved | Own-record events only if explicitly approved | DENY |
| Bulk export/delete/restore | Explicit narrow grant; never finance | DENY by default | DENY | DENY |

## Required data partition

Keep financial information in separate records that Super Admin cannot read:

- `financeDeployment/{deploymentId}` — client package, advance, balance and related client-finance fields.
- `financeAssignments/{assignmentId}` — a specific freelancer's payment details for a specific assignment.
- `deployments/{deploymentId}` and assignment records — operational fields only; do not include finance values.
- Keep private availability reasons and private notes separate from broad operational records.
- Search, dashboards, exports, logs, background jobs and server endpoints must not reveal finance or finance-derived information to Super Admin.
- Firebase Admin SDK bypasses Firestore rules; privileged server functions need explicit narrow authorization and must not offer generic unrestricted reads.

## Test requirements before enabling permissions

For each role, test both allowed and denied cases:

1. Super Admin cannot read any finance document or finance-derived output, including when assigned additional non-financial roles.
2. A Deployer can read client finance only for a deployment they own.
3. A Deployer can read freelancer payment details only for freelancers assigned to their own deployment.
4. A Deployer cannot read another deployer's finance or unrelated freelancer payments.
5. A Freelancer can read their own assignment payment record only.
6. A Freelancer cannot read client package/advance/balance, another freelancer's payment, or a payment for an assignment they do not own.
7. Pending users cannot read operational or financial records.
8. Direct document reads, list/query scoping, manipulated IDs, search, exports, logs and server endpoints are tested.
9. Safe profile edits are allowed only for approved fields; users cannot self-approve or self-promote.
10. Backup restoration is tested before any real operational data is entered.

## Implementation guardrails

- Current restrictive `main` rules remain unchanged until a separate test branch passes.
- Do not deploy these draft permissions to a live Firebase project.
- No Firebase project creation, billing activation, or paid service is authorized by this draft.
- Frozen v32 and v46 remain untouched.
- Gear Custody remains excluded.
- Do not add fake bookings, roster entries, season dates, or financial values.

## Decisions still not defined by this draft

- The precise Super Admin operational permissions beyond established system/team/Season Radar administration.
- Exact cancellation/deletion and confirmed-assignment withdrawal workflows.
- Exact first-owner bootstrap process.
- Approved backup destination and restore process.
