# Count123

Count123 is an accounting software concept for Canadian small businesses, with a liquid-glass UI and a product direction centered on operational efficiency, clean books, and practical tax-season readiness.

This repo now includes a server-side bank integration scaffold for Royal Bank of Canada (RBC) so OAuth credentials and account-sync calls stay off the frontend.

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
   - `RBC_CLIENT_ID`
   - `RBC_CLIENT_SECRET`
   - `RBC_AUTH_URL`
   - `RBC_TOKEN_URL`
   - `RBC_REDIRECT_URI`
   - `RBC_SCOPES`
   - `RBC_ACCOUNTS_URL`
3. Ensure the redirect URI registered in RBC matches `RBC_REDIRECT_URI`.
4. Start the app and use the `Connect RBC` action in the dashboard.

Count123 assumes the integration target is RBC via the official developer portal: https://developer.rbc.com/

Because RBC endpoint details and credentials are app-specific, this repo ships a secure integration scaffold rather than hardcoded production endpoints.

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
