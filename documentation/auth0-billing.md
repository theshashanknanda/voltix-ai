# Auth0 and billing: issues #110 and #115

## Review and rollout order

The initial Auth0 and billing implementations were merged into `main` in PRs
#116 and #117. The production-configuration and session-restoration follow-up is
on `feature/110-auth0-login`; review its remaining diff against `main`.
See [auth0.md](auth0.md#production-rollout) for the exact production URLs,
required hosting settings, and remaining provider setup.

The migrations are separate: `20261119142000_auth0_login` owns identity changes;
`20261119143000_billing_projects` adds plans, counters, Stripe identifiers/events,
and project snapshots. Apply both in order when deploying the billing branch.
The Auth0 branch can deploy its identity migration independently of billing.

Neither Auth0 setup nor Stripe test-mode configuration needs to wait for the
other open issues. #110 has passed live Google/GitHub sign-in, identity migration,
account reuse, authenticated import, refresh, and logout checks. The final manual
provider cancellation check remains pending; see [auth0.md](auth0.md). #115 remains partial until #113/#114 connect
the quota helper and their chat/edit UI handles the returned 402 errors.

Coordinate the `Project` model with the owner of #111 before merging its changes;
reuse/extend the snapshot foundation rather than adding duplicate project rows.

## Implemented

- Google/GitHub sign-in through the Auth0 React SDK. The app no longer accepts
  email/password registration or login. Old endpoints return 410.
- Backend verification of RS256 API access tokens against the configured Auth0
  issuer/JWKS, including audience and expiry. The existing `requireAuth` gate
  resolves the Auth0 subject to the internal user UUID.
- First-login profile retrieval from Auth0 `/userinfo`, followed by user
  creation. Invalid tokens, mismatched subjects, and provider failures cannot
  create a partial user. Concurrent first requests reuse the unique subject.
- Protected Billing page, authoritative usage API, Stripe subscription Checkout,
  customer portal, and raw-body, signature-verified subscription webhook.
- Free: 20 chat messages/month and 1 saved project. Pro: 500 messages/month and
  20 saved projects. A calendar month starts at 00:00 UTC on its first day.
- Transactional per-user quota checks use PostgreSQL `SELECT ... FOR UPDATE`,
  covering concurrent message requests, month rollover, and project creation.
- Repo and ZIP imports are authenticated, checked before processing, and checked
  again inside the persistence transaction. Over-limit imports return 402.
- Minimal imported-project snapshots with list/reopen/delete operations. This
  foundation is necessary for project quotas; it is an explicit overlap with
  #111, not a replacement for its full acceptance criteria.
- Project slots are separate from saved `Analysis` explanations. Removing a
  saved explanation does not free a project slot. Removing a project does.
- Existing projects survive downgrades. An over-limit account can still browse
  and remove its snapshots, but cannot import another project.

## Remaining integration with open issues

### #111: saved projects

`Project` has `id`, `userId`, `source`, `label`, `files` (JSON snapshot), `metadata`
(the existing import metadata), and `createdAt`. Both import routes return a
`projectId` without changing their existing `files`/`meta` contract. GitHub also
retains its `analysisId` response for compatibility.

Use `saveImportedProject(userId, input)` for future import persistence, or retain
its per-user locking and capacity check if moving files to a storage service.
Do not create a second project record for the same successful import. Snapshots
exclude secret filenames and detected credential literals; the scanner is a
heuristic, not a complete secret detector. The aggregate snapshot limit is 20 MB.

API contract:

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/projects` | `{ projects: [{ id, source, label, createdAt }] }` |
| GET | `/api/projects/:id` | `{ project }`, including `files` and `metadata` |
| DELETE | `/api/projects/:id` | `{ ok: true }`, frees the saved-project slot |

All routes scope access to the authenticated internal user UUID. Missing or
foreign projects return 404. Reopening a snapshot makes no model calls and
does not consume quota. Source edits in the existing viewer do not yet update
the imported snapshot; persistence of chat edits belongs to #111/#114.

Old Analysis rows cannot reconstruct a ZIP or a repository's historical file
contents and are not backfilled into project snapshots. Their ownership is kept.

### #113/#114: chat and edits

No chat, conversation, patch-generation, or patch-application implementation
has been invented here. There is no production `/api/chat` route yet. The quota
route tests use a test-only `/api/chat` handler and a fake model.

When implementing those routes:

```ts
import requireAuth from '../middleware/requireAuth';
import chatQuota from '../middleware/chatQuota';

router.post('/chat', requireAuth, validateChatAndProjectOwnership, chatQuota, generateReply);
```

Run request validation, project ownership, and secret checks before `chatQuota`.
The middleware charges one message atomically and returns 402 without calling
the next handler when exhausted. It sets `X-Chat-Messages-Remaining` on admitted
requests. For service-based routes, `consumeChatMessage(userId)` exposes the same
operation. **Use one of the helper or middleware, not both.** Never make the
model call before the helper has succeeded.

The implementation's accounting policy is one message per admitted model-backed
question or edit-generation request. A provider failure after admission still
counts. Applying an already-generated patch makes no extra model call and does
not charge again. Invalid requests and denied requests do not count. Align this
policy with #114 before connecting its generate/apply stages.

On 402, the future chat UI should display the server error and link to `/billing`.
The machine-readable code is `CHAT_LIMIT_REACHED` or `PROJECT_LIMIT_REACHED`.
File browsing, tree/search requests, Billing reads, and existing one-off
Analyze/Review/Document actions are not charged by this issue. Extending quotas
to those older AI actions would be a separate product decision.

### #112: editor

Billing has its own route and component. Project list controls live in
`SavedProjects.tsx`, leaving the file-tree and code-viewer implementations alone.
Protected requests should use `useAuth().apiFetch`, which obtains a fresh access
token from the SDK for every request. `token` remains in the auth context only
for compatibility; do not use the initially loaded token for long-lived sessions.

## Local setup

1. Install backend and frontend dependencies with `npm ci` in each directory.
2. Copy each `.env.example` to that directory's `.env` and fill in the values.
   Never place a Stripe secret, Auth0 client secret, or database URL in Vite env.
3. Configure a PostgreSQL database and run `npx prisma migrate deploy` in backend,
   then `npx prisma generate`. The migration is additive for account/project data
   and makes password hashes optional. It also changes email from a unique
   identity key to an indexed profile field; Auth0 subject is now the identity.
4. In Auth0, create an SPA and a custom API using RS256. Set the same API
   audience on frontend and backend. Enable only Google (`google-oauth2`) and
   GitHub (`github`) connections for this application. Configure provider
   credentials and ensure the GitHub connection can retrieve the user's email.
5. Allow `http://localhost:5173/auth` as a callback and logout URL, and
   `http://localhost:5173` as a web origin. Register equivalent deployment URLs.
   Auth0 handles SDK session restoration using its localStorage cache so page
   refresh works when silent iframe login is blocked. Logout clears this cache.
   Voltix removes its legacy token keys; see the storage tradeoffs in [auth0.md](auth0.md).
6. In Stripe test mode, create a recurring Pro price and set its `price_...` ID
   as `STRIPE_PRO_PRICE_ID`. Price/currency are configured in Stripe, not guessed
   by this implementation. Enable the customer portal to support payment-method
   updates and cancellation.
7. Forward Stripe test events to the backend:

   ```sh
   stripe listen --forward-to localhost:5001/api/billing/webhook
   ```

   Copy the listener's signing secret to `STRIPE_WEBHOOK_SECRET`. Subscribe to
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`.
   Configure the production webhook separately with its own signing secret.
8. Run `npm run dev` in backend and frontend. Backend defaults to port 5001.

Missing Auth0 configuration leaves sign-in unavailable without crashing the
frontend or accepting a legacy token. Missing Stripe configuration leaves Free
usage visible and disables checkout. No live Auth0/Stripe tenant changes or
database migrations are performed automatically by the application.

## Identity migration

Existing internal UUIDs and saved analyses are preserved by the SQL migration.
Existing password accounts have a null `auth0UserId`. They are intentionally not
claimed automatically by matching an email from a social profile. Before
cutover, administrators must verify account ownership and explicitly populate
the correct Auth0 subject on the existing user row, or use a verified Auth0
migration/linking flow. Do this before the person's first social login if they
need to retain their old workspace.

Google and GitHub identities with the same email can sign in as separate
accounts. To share one workspace and subscription across providers, link their
identities in Auth0 through an authenticated account-linking flow. Email
equality is not proof of account ownership.

## Stripe state and failure handling

Only the webhook updates `plan`; a success URL, checkout creation, or client
request cannot grant Pro. Pro requires an active subscription with a paid latest
invoice and the configured Pro price. Payment failures and terminated
subscriptions resolve to Free. Successful payment recovery restores Pro.
Scheduling cancellation leaves Pro active until the paid subscription ends.

Events are signature-checked using the raw bytes before Express JSON parsing.
Processing is deduplicated by event ID and committed with the user change.
State is reconciled from Stripe under the per-user lock, so delivery order does
not define the plan. Older subscription events cannot revoke a replacement.
Failed processing returns non-2xx and is not marked complete, allowing retry.

## Verification

```sh
cd backend
npm test -- --runInBand
npx tsc --noEmit
npx prisma validate

cd ../frontend
npm run build
npm run lint
```

Backend tests exercise the real JWT verifier with generated RS256 keys and a
local discovery/JWKS server, and actual Stripe webhook signatures with test
payloads. Outbound Stripe APIs and database operations use test doubles. Quota
concurrency tests use serialized transaction doubles; deployment still needs
verification against PostgreSQL and the actual Auth0 and Stripe test accounts.

Current verification: 181 backend tests across 12 suites pass. Backend TypeScript
and Prisma validation pass; frontend production build and lint pass. The existing
syntax-highlighting bundle size warning remains. Browser checks with the real
frontend and an isolated Auth0/API fixture verified Free/Pro limits, a canceled
checkout remaining Free, simulated confirmation showing Pro, a denied import's
Billing link, reopening saved source, and logout showing only the social buttons.
Those browser checks do not substitute for live Auth0 or Stripe test-mode checks.

All SQL migrations were also applied to a disposable in-memory PostgreSQL WASM
database (PGlite), with legacy-user and saved-analysis fixtures. Checks confirmed
preserved ownership/data, Free defaults, passwordless accounts, separate
same-email identities, unique Auth0 subjects, project foreign keys/cascade,
quota row-lock/update SQL, and unique Stripe event IDs. This did not connect to
or modify the configured application database and does not test multi-connection
PostgreSQL contention.

Manual checks after external configuration:

- Google login, logout, GitHub login, canceled login, and page reload.
- Import one project on Free; attempt a repo and ZIP import at the limit. Both
  must return 402. Remove the saved project and verify a new import succeeds.
- Reopen an imported snapshot after closing the browser tab.
- Start and cancel checkout; confirm Free. Complete a Stripe test payment;
  wait for the webhook and confirm Pro limits without another login.
- Fail a subscription payment/end the subscription and confirm Free while
  existing projects and usage remain intact.
- After #113/#114 integration, send a question and an edit; verify usage drops
  once per admitted generation and message 21 on Free makes no model call.
