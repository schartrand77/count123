# Count123

Count123 is an opinionated open source accounting software concept with a liquid-glass UI and a product position centered on clarity, speed, and trustworthy bookkeeping workflows.

## What is in this repo

- A dependency-free frontend starter app
- A liquid-glass design system in plain CSS
- An interactive accounting dashboard prototype
- Product framing for the future open source platform

## Primary deployment target

Count123 is currently packaged for Docker-first deployment, with Unraid as the primary host environment.

## Run with Docker

```bash
docker compose up --build -d
```

Then open `http://localhost:8087`.

## Deploy on Unraid

1. Place this repo in an Unraid-accessible share, or clone it onto the server.
2. In the Unraid Docker or Compose Manager flow, point the stack at this repo.
3. Deploy the included [`docker-compose.yml`](./docker-compose.yml).
4. Route a host port such as `8087` to container port `80`.
5. Optionally front it with your reverse proxy and map a custom domain.

The current container is a small nginx image serving the static prototype. As the product grows, this can evolve into a multi-service stack without changing the Unraid deployment model.

## Local non-Docker fallback

Because the app is static, any local file server works.

```bash
python -m http.server 4173
```

Then open `http://localhost:4173`.

## Product direction

Count123 is being positioned around:

- General ledger as the source of truth
- Fast journal-entry workflows
- Real-time cash visibility
- Multi-entity and audit-friendly reporting
- Open APIs and self-hosting

## Next build targets

- Authentication and workspace management
- Chart of accounts CRUD
- Journal entry posting and approvals
- Invoice, bill, payment, and reconciliation flows
- Financial statements and drill-down reporting
- Import/export and audit trail tooling
