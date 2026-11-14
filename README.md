# Window CRM

Small, dependency-free CRM for a window company: leads & customers, job pipeline, scheduling,
quotes priced from a price list, invoices & payments, installer mobile view with photos and notes.

- Runtime: Node.js 22+ (uses built-in `node:sqlite`), no npm packages.
- Data: SQLite database + uploaded photos in `$DATA_DIR` (default `./data`). Back this folder up.

## Run locally
    ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=changeme123 node --disable-warning=ExperimentalWarning server.js
    # open http://localhost:3000

## Environment
| Var | Purpose |
| --- | --- |
| `PORT` | HTTP port (default 3000) |
| `DATA_DIR` | Where the database and uploads live |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | First office login, used only when the database has no users |
| `TZ` | Time zone for "today" (e.g. `America/New_York`) |

## Deploy
Live at https://crm.2-25-165-80.sslip.io (Hostinger VPS, Docker Manager project `window-crm`).
See `docker-compose.yaml`: a stock `node:22-alpine` container downloads a pinned commit of this repo
at startup, behind Caddy for HTTPS. Data lives on the host in `/opt/window-crm/data`
(SQLite database + photos), so back that folder up. `Dockerfile` is there if you'd rather build an image.
