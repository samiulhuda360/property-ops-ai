# Property Ops

Rental property management for a New Zealand property manager, with AI automations for the back-office work:
supplier invoices and lease summaries, rent reconciliation against the bank statement, and the tenant inbox. Every
automation leaves the decisions to a person and records the time it returns.

The demo data is a fictional Auckland portfolio: 12 properties, 11 tenancies, 9 contractors. Every person, address
and business in it is invented.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, Recharts |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL with Prisma |
| AI | Any OpenAI-compatible chat API (Google Gemini by default), structured JSON output, rules-only mode without a key |
| Tests | Vitest and Supertest against a disposable PostgreSQL database; GitHub Actions |

## Getting started

```bash
npm install
docker compose up -d db                       # or any PostgreSQL 14+
cp server/.env.example server/.env            # set DATABASE_URL and JWT_SECRET
npm run db:setup                              # migrations and the demo data
npm run dev                                   # API on :3001, app on http://localhost:5173
```

Demo login: `demo@example.com` / `demo1234`.

## Tests

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/property_ops_test npm test
```

Without `TEST_DATABASE_URL` the unit tests run and the database tests are skipped.

## Licence

[MIT](LICENSE)
