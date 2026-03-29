# Count123

Count123 is an accounting software concept for Canadian small businesses, with a liquid-glass UI and a product direction centered on operational efficiency, clean books, and practical tax-season readiness.

This repo now includes a server-side bank integration scaffold for Royal Bank of Canada (RBC) so OAuth credentials and account-sync calls stay off the frontend.

It is not possible to honestly guarantee a web app is "100% secure and compliant." This repo is hardened to a stronger baseline, but real compliance still depends on hosting, legal scope, data handling, monitoring, and the bank's production requirements.

It also includes a secure admin login flow that requires the configured email, username, and password on the server side.

## What is in this repo

- A dependency-free frontend starter app
- A liquid-glass design system in plain CSS
- An interactive small-business accounting dashboard prototype
- Product framing for a professional Canadian accounting app

## Primary deployment target

Count123 is currently packaged for Docker-first deployment, with Unraid as the primary host environment.

## Run with Docker

```bash
docker compose up --build -d
```

Then open `http://localhost:8087`.

## Configure RBC integration

1. Copy [`.env.example`](./.env.example) to `.env`.
2. Fill in the RBC OAuth values for your developer application:
   - `SESSION_SECRET`
   - `ADMIN_EMAIL`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD_HASH`
   - `RBC_CLIENT_ID`
   - `RBC_CLIENT_SECRET`
   - `RBC_AUTH_URL`
   - `RBC_TOKEN_URL`
   - `RBC_REDIRECT_URI`
   - `RBC_SCOPES`
   - `RBC_ACCOUNTS_URL`
   - `TRUST_PROXY=true` if TLS is terminated by a reverse proxy
   - `FORCE_HTTPS=true` in production
3. Ensure the redirect URI registered in RBC matches `RBC_REDIRECT_URI`.
4. Start the app and use the `Connect RBC` action in the dashboard.

Count123 assumes the integration target is RBC via the official developer portal: https://developer.rbc.com/

Because RBC endpoint details and credentials are app-specific, this repo ships a secure integration scaffold rather than hardcoded production endpoints.

## Security baseline in this repo

- Signed, per-user `HttpOnly` session cookies instead of a single shared process session
- Server-side admin authentication with email, username, and password verification
- Scrypt password-hash verification with timing-safe comparisons
- Basic login rate limiting for failed admin sign-in attempts
- OAuth state validation plus PKCE for the RBC authorization flow
- Security headers including CSP, HSTS when HTTPS is enabled, `X-Frame-Options`, `nosniff`, and restrictive referrer and permissions policies
- No bank credentials or tokens exposed to frontend JavaScript
- Masked bank account identifiers in the UI response payload
- Reduced error disclosure on callback and sync failures
- No third-party font or asset dependencies in the default HTML

## Remaining production requirements

- TLS everywhere, including reverse proxy and origin configuration
- Secret management outside `.env` for production
- Audit logging, alerting, and incident response
- Privacy policy, retention policy, and access control review
- Bank-specific security review and any contractual compliance obligations from RBC
- Penetration testing and dependency/container scanning in CI

## Generate the admin password hash

Use Node to generate a scrypt hash for `ADMIN_PASSWORD_HASH`:

```bash
node -e "const crypto=require('node:crypto'); const password=process.argv[1]; const salt=crypto.randomBytes(16).toString('base64url'); const N=16384,r=8,p=1; const hash=crypto.scryptSync(password, salt, 64, {N,r,p}).toString('base64url'); console.log(`scrypt$${N}$${r}$${p}$${salt}$${hash}`);" "your-strong-password"
```

## Deploy on Unraid

1. Place this repo in an Unraid-accessible share, or clone it onto the server.
2. In the Unraid Docker or Compose Manager flow, point the stack at this repo.
3. Deploy the included [`docker-compose.yml`](./docker-compose.yml).
4. Route a host port such as `8087` to container port `80`.
5. Optionally front it with your reverse proxy and map a custom domain.

The current container is a small Node image serving the frontend and the server-side bank integration endpoints. As the product grows, this can evolve into a multi-service stack without changing the Unraid deployment model.

## Local runtime

Because the app now includes secure OAuth and bank-sync endpoints, run the local Node server instead of a static file host.

```bash
npm start
```

Then open `http://localhost:80`.

## Product direction

Count123 is being positioned around:

- Clean bookkeeping and balancing workflows
- Client invoicing and receivables management
- Purchase orders, bills, and payables handling
- GST/HST-aware workflows
- Real-time cash visibility
- Bank connection and account sync through a secure backend
- Cleaner accountant handoff at year-end
- Self-hosted deployment

## Next build targets

- Client, quote, and invoice management
- Purchase orders, bills, and payables workflows
- Receipt capture and expense categorization
- Reconciliation and month-end close tooling
- GST/HST tracking and summaries
- Bank-feed sync and transaction matching
- Tax-season exports and reporting
- Import/export and audit trail tooling
