# Auth0 social login (#110)

## Implementation

- Google and GitHub sign-in use the Auth0 React SDK. The password form is removed
  and `/api/auth/login` and `/api/auth/register` return 410.
- Existing protected endpoints retain `requireAuth`, which verifies RS256 access
  token signatures, issuer, audience, and expiry using Auth0's discovery/JWKS.
  Missing, malformed, expired, and invalid tokens return 401 with
  `Unauthorized. Please login again.`
- The verified Auth0 subject maps to the existing internal user UUID. First
  login retrieves email/name from Auth0 `/userinfo` and creates a user only
  after that succeeds. Subsequent requests reuse the user, including concurrent
  first-login requests.
- The frontend waits for authentication and backend user provisioning before
  opening the dashboard. Callback failures and cancellations show a short error;
  logout returns to sign-in. Protected calls use `useAuth().apiFetch`, which
  obtains a fresh SDK access token for each request.
- GitHub imports now require authentication and save the correct internal owner.
- The old localStorage bearer-token keys are removed. Auth0 controls the session.

## Independent database migration

`20261119142000_auth0_login` makes `passwordHash` optional, adds a unique nullable
`auth0UserId`, and changes email from a unique identity key to an indexed profile
field. It preserves existing user IDs and analysis ownership.

Auth0 subject is the identity key. Google/GitHub identities with the same email
remain separate accounts unless linked through Auth0's authenticated account
linking flow. Matching email strings never automatically claim a workspace.

Existing password accounts need a verified migration: populate the correct
Auth0 subject on their existing user row after verifying ownership, ideally
before their first social login. Otherwise that login creates a separate
workspace. Do not bulk link users solely by email.

This migration and #110 can be reviewed independently of Stripe, project
persistence (#111), chat (#113), and edits (#114).

## Configuration and acceptance status

Code and automated checks are complete. **Live acceptance is pending tenant
configuration, applying the migration, and Google/GitHub smoke tests.** Keep
#110 in review until those checks pass. No Auth0 tenant was configured and no
application database migration was applied as part of this change.

1. Create an Auth0 Single Page Application and an RS256 custom API.
2. Enable Google (`google-oauth2`) and GitHub (`github`) connections for this
   application, configure their provider credentials, and disable password and
   other connections. Ensure the GitHub connection retrieves the user's email.
3. Configure backend `AUTH0_ISSUER_BASE_URL` and `AUTH0_AUDIENCE`, and frontend
   `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`. Frontend and
   backend audiences must match. Copy each directory's `.env.example` as a guide.
4. Allow `http://localhost:5173/auth` as callback and logout URL, and
   `http://localhost:5173` as a web origin. Add equivalent deployment URLs.
5. Set `DATABASE_URL` and `DIRECT_URL`, install with `npm ci` in each directory,
   then run `npx prisma migrate deploy` and `npx prisma generate` in backend.
   Coordinate deployment so the migration and Auth0 environment configuration
   are ready before switching the application to social login.
6. Run `npm run dev` in backend (5001) and frontend (5173). Without Auth0
   configuration the login page shows the provider buttons disabled and an
   unavailable message; it does not accept legacy tokens.

Do not put an Auth0 client secret or database credentials in Vite variables.

## Verification

Backend Jest tests use generated RS256 tokens and a real local discovery/JWKS
server to verify repeat login, expiry, issuer, audience, signature, rejected
legacy tokens, concurrent provisioning, and safe provider failures. Database
operations use test doubles; no developer database is contacted by tests.

Run `npm test -- --runInBand`, `npx tsc --noEmit`, and `npx prisma validate` in
backend. Run `npm run build` and `npm run lint` in frontend.

Before closing #110, verify against the configured Auth0 tenant and migrated DB:

1. Google sign-in reaches the dashboard and creates one user with email, name,
   and Auth0 subject without a password.
2. Logout and sign in again; the same internal user and saved analyses return.
3. Logout and use GitHub; it also reaches the dashboard.
4. Cancel provider login; the app stays logged out and shows a short error.
5. Import a small repo, verify ownership, then logout and confirm the dashboard
   requires a session. Invalid/expired API access tokens must return 401.
