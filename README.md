# Flash Sale Backend

A high-concurrency ticket flash sale engine built to solve one core problem: **preventing overselling when hundreds of users try to buy the last few tickets at the same millisecond.**

Built with NestJS, PostgreSQL, Redis, and BullMQ — with real payment gateway integration (Midtrans), JWT authentication, and interactive API docs (Swagger).

## The Problem

In a typical flash sale, the naive approach — check stock in the database, then decrement it — creates a race condition:

```
Stock = 1
User A: reads stock → 1 (available)
User B: reads stock → 1 (available, A hasn't written yet)
User A: writes stock - 1 → 0, succeeds
User B: writes stock - 1 → -1, also succeeds (overselling!)
```

Both users get a ticket that doesn't exist. This is the exact failure mode this project is designed to prevent.

## The Solution

Instead of writing directly to PostgreSQL on every checkout attempt, this system moves the concurrency-critical path to **Redis**, using an **atomic Lua script** to check-and-decrement stock in a single, indivisible operation. PostgreSQL writes happen asynchronously through a **BullMQ** queue, so the database is never hit with a burst of concurrent writes.

### Architecture

```
[ Client ]
     │
     ▼
┌─────────────┐   Atomic Lua Script    ┌──────────────┐
│  NestJS API │ ──────────────────────►│ Redis        │
└──────┬──────┘                        │ (Stock Lock) │
       │ Job Dispatch                  └──────────────┘
       ▼
┌─────────────┐
│   BullMQ    │ (Queue)
└──────┬──────┘
       │
       ▼
┌─────────────┐   Persist Order        ┌──────────────┐
│ Background  │ ──────────────────────►│ PostgreSQL   │
│   Worker    │                        │(Source of    │
└──────┬──────┘                        │  Truth)      │
       │ Create Transaction
       ▼
┌─────────────┐
│  Midtrans   │ (Snap Payment Link)
└─────────────┘
       │
       ▼ (webhook)
┌─────────────┐
│  Payment    │  Updates order status,
│  Webhook    │  releases Redis reservation
└─────────────┘

┌─────────────┐
│  Cron Job   │  Auto-expires unpaid orders
│ (every min) │  after 5 minutes, releases stock
└─────────────┘
```

### Checkout flow, step by step

1. **User initiates checkout** — authenticated via JWT, `userId` extracted from the token (never trusted from the request body).
2. **Redis atomic lock** — a Lua script checks stock and decrements it in one indivisible operation, then sets a reservation key with a 5-minute TTL. If stock is `0`, the request fails fast (`409 Conflict`) in under 10ms without touching the database.
3. **Job dispatched to BullMQ** — the API responds immediately with `202 Accepted` and a `bookingId`. The client doesn't wait for the database write.
4. **Background worker processes the job** — creates a Midtrans Snap transaction, persists the order to PostgreSQL with status `PENDING`.
5. **Payment webhook** — Midtrans notifies the backend when payment succeeds or fails. The signature is verified (SHA512) before any state change, and the handler is idempotent — a duplicate webhook won't double-process an order.
6. **Expiry cron job** — runs every minute, finds orders that passed their 5-minute payment window, marks them `EXPIRED`, and releases the stock back to Redis so other users can buy it.

## Proof: Full-Stack Concurrency Test

Rather than just claiming the system is race-condition-safe, here's an actual, reproducible test that exercises the **entire stack** — not just Redis in isolation:

1. **30 real users** are registered via `POST /auth/register`, each receiving their own JWT.
2. A **fresh event** with **5 units of stock** is created dynamically via `POST /events`.
3. All 30 users send a `POST /events/:id/checkout` request **at the same time**, each authenticated with their own token.
4. After the queue drains, every accepted booking is independently verified to exist in PostgreSQL via `GET /orders/:id` (with per-user ownership checks).

```
Total requests   : 30
Stock available  : 5
202 Accepted     : 5
409 Conflict     : 25

--- After the worker persists orders to Postgres ---
Orders confirmed to exist: 5 / 5
```

**Result: exactly 5 successful checkouts, no more, no less** — verified from the authenticated API layer, through the Redis lock, all the way to the database. No oversells, no lost reservations, no auth bypass.

This test is fully scripted and reproducible — see [`scripts/load-test-checkout-e2e.ts`](./scripts/load-test-checkout-e2e.ts).

## Proof: Real Payment Gateway Integration

Beyond the concurrency test, the full payment lifecycle was verified end-to-end against Midtrans' sandbox — not mocked:

1. Checkout created an order with a real Midtrans Snap payment link (`https://app.sandbox.midtrans.com/snap/v4/redirection/...`).
2. Payment was completed using Midtrans' test card.
3. Midtrans sent a real webhook notification to the backend (via an `ngrok` tunnel during local testing).
4. The webhook's SHA512 signature was verified before any state change.
5. The order transitioned from `PENDING` to `PAID`, with `paymentGatewayRef` populated from the real transaction.

```json
// GET /orders/:id — before payment
{ "status": "PENDING", "paymentGatewayRef": null }

// GET /orders/:id — after Midtrans webhook confirmed
{ "status": "PAID", "paymentGatewayRef": "807f0b4a-63df-4c8a-afd2-c396c7efbca2" }
```

## Tech Stack

| Layer               | Technology                          |
| ------------------- | ----------------------------------- |
| API Framework       | NestJS (Bun runtime)                |
| Concurrency Control | Redis (`ioredis`) + Lua script      |
| Async Processing    | BullMQ                              |
| Database & ORM      | PostgreSQL + Prisma 8               |
| Payment Gateway     | Midtrans Snap API                   |
| Authentication      | JWT (`@nestjs/jwt`, `passport-jwt`) |
| Scheduled Jobs      | `@nestjs/schedule`                  |
| API Docs            | Swagger (`@nestjs/swagger`)         |
| Testing             | `bun:test`                          |

## API Endpoints

| Method | Endpoint               | Auth                      | Description                                             |
| ------ | ---------------------- | ------------------------- | ------------------------------------------------------- |
| POST   | `/auth/register`       | —                         | Register a new user                                     |
| POST   | `/auth/login`          | —                         | Log in, returns a JWT                                   |
| GET    | `/events`              | —                         | List all available events                               |
| POST   | `/events`              | JWT required              | Create a new event (also seeds its Redis stock counter) |
| POST   | `/events/:id/checkout` | JWT required              | Attempt to reserve stock and start checkout             |
| GET    | `/orders/:id`          | JWT required (owner only) | Check order status and retrieve the payment URL         |
| POST   | `/webhooks/payment`    | Signature-verified        | Midtrans payment notification handler                   |
| GET    | `/health/redis`        | —                         | Redis connectivity health check                         |

> **Note:** `POST /events` has no role-based access control — any authenticated user can create an event. This is a deliberate MVP simplification; see [Future Improvements](#future-improvements).

## Getting Started

### Prerequisites

- Node.js ^22.18.0 or >=24.11.0
- [Bun](https://bun.sh)
- A PostgreSQL database (e.g. [Prisma Postgres](https://www.prisma.io))
- A Redis instance (e.g. [Upstash](https://upstash.com)) — **set eviction to `noeviction`**, since BullMQ requires job data to persist
- A [Midtrans](https://midtrans.com) sandbox account
- [ngrok](https://ngrok.com) (only needed to test the payment webhook locally)

### Setup

```bash
# Install dependencies
bun install

# Set environment variables
export DATABASE_URL="postgresql://..."
export REDIS_URL="rediss://..."
export MIDTRANS_SERVER_KEY="Mid-server-..."
export MIDTRANS_CLIENT_KEY="Mid-client-..."
export JWT_SECRET="your-random-secret"

# Apply the database schema
bun run db:init

# Seed a few example events (also sets their initial Redis stock)
bun run seed

# Start the dev server
bun run dev
```

The server starts at `http://localhost:3000`, with interactive API docs at **`http://localhost:3000/docs`**.

After seeding, you'll have a few ready-to-use events — no need to create one manually before testing checkout. If you want to create your own event instead (or need more later), use `POST /events`.

---

## Testing the Full Flow via Swagger

This is the fastest way to see the entire system work end-to-end, without writing a single `curl` command.

### 1. Open the docs

Go to `http://localhost:3000/docs` in your browser.

### 2. Register an account

Expand **Auth → `POST /auth/register`** → **Try it out** → fill in an email and password → **Execute**.

Copy the `accessToken` from the response.

> Already have an account? Use **`POST /auth/login`** instead.

### 3. Authorize

Click the **Authorize** button (top-right, padlock icon). Paste the `accessToken` and click **Authorize**, then **Close**. Every protected endpoint will now automatically send this token — no need to paste it again.

### 4. Browse available events

Expand **Events → `GET /events`** → **Try it out** → **Execute**.

If you ran `bun run seed`, you'll already see a few events here. Copy the `id` of the one you want to buy.

> Want to create your own event instead? Use **`POST /events`** — it also seeds the Redis stock counter automatically, so it's checkout-ready immediately.

### 5. Checkout

Expand **Events → `POST /events/{id}/checkout`** → **Try it out** → paste the event `id` → **Execute**.

You'll get a `202 Accepted` response with a `bookingId`. This is your order ID.

```json
{
  "bookingId": "461f9e8e-53de-4098-8567-a4579b08e6b1",
  "status": "PENDING",
  "message": "Checkout successful, order is being processed."
}
```

### 6. Retrieve the payment link

The order is created asynchronously by a background worker, so wait 2–3 seconds, then:

Expand **Orders → `GET /orders/{id}`** → paste the `bookingId` → **Execute**.

Once the worker has finished, the response includes a real Midtrans `paymentUrl`:

```json
{
  "status": "PENDING",
  "paymentUrl": "https://app.sandbox.midtrans.com/snap/v4/redirection/..."
}
```

### 7. Pay using Midtrans' sandbox

Open the `paymentUrl` in your browser. Choose credit card as the payment method and use Midtrans' test card:

```
Card Number : 4811 1111 1111 1114
CVV         : 123
Expiry      : any future date
OTP         : 112233
```

### 8. (Local only) Expose your webhook with ngrok

Midtrans needs to reach your machine to send the payment notification. In a separate terminal:

```bash
ngrok http 3000
```

Copy the forwarding URL (e.g. `https://xxxx.ngrok-free.app`) and set it, **including the path**, as the **Payment Notification URL** in the Midtrans dashboard (Sandbox → Settings → Configuration):

```
https://xxxx.ngrok-free.app/webhooks/payment
```

> If you're testing against an already-deployed instance, skip this step — the notification URL should already point to your live domain.

### 9. Confirm the payment went through

Go back to **Orders → `GET /orders/{id}`** and **Execute** again. The status should now read `PAID`, with `paymentGatewayRef` populated:

```json
{
  "status": "PAID",
  "paymentGatewayRef": "807f0b4a-63df-4c8a-afd2-c396c7efbca2"
}
```

That confirms the entire chain worked: **authenticated checkout → Redis stock lock → async order creation → real Midtrans payment → verified webhook → status update.**

### Note: seeding/resetting Redis stock manually

Event stock in Redis is tracked separately from the `totalStock` column in Postgres. `bun run seed` and `POST /events` both set this automatically. If you ever need to reset it manually (e.g. after heavy testing), use your Redis provider's CLI (e.g. Upstash's **CLI** tab):

```
SET stock:event_<eventId> 5
```

---

## Running Automated Tests

```bash
# Unit tests (mocked Redis/queue/database — no external services needed)
bun test

# Full-stack concurrency load test — registers real users, creates a fresh
# event, and fires concurrent authenticated checkout requests
# (requires the dev server running)
bun run scripts/load-test-checkout-e2e.ts
```

## Data Model

```prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  orders    Order[]
}

model Event {
  id            String   @id @default(uuid())
  title         String
  totalStock    Int
  price         Decimal
  reservedStock Int      @default(0)
  orders        Order[]
}

model Order {
  id                String      @id @default(uuid())
  userId            String
  eventId           String
  status            OrderStatus @default(PENDING)
  snapToken         String?
  paymentUrl        String?
  createdAt         DateTime    @default(now())
  reservedAt        DateTime?
  expiresAt         DateTime?
  paymentGatewayRef String?
  user              User        @relation(fields: [userId], references: [id])
  event             Event       @relation(fields: [eventId], references: [id])
}

enum OrderStatus {
  PENDING
  PAID
  EXPIRED
  FAILED
}
```

## Future Improvements

These were deliberately scoped out of the MVP to keep focus on the core concurrency problem, but are natural next steps:

- **Role-based access control** — restrict `POST /events` to admin users only
- **Rate limiting per user** — prevent a single user from spamming checkout requests
- **PDF e-ticket generation & email delivery** — triggered as a follow-up BullMQ job after payment confirmation
- **Additional unit tests** — coverage for `OrdersProcessor` and `OrdersExpiryService`, currently only `OrdersService` is covered
- **Admin dashboard** — CRUD for events, sales monitoring
- **Refresh token flow** — current JWT setup only issues short-lived access tokens
- **Dead-letter queue handling** — more robust retry/failure handling for BullMQ jobs that exhaust retries

## Why This Project

This project was built to demonstrate a specific, well-known distributed systems problem — race conditions under high concurrency — and to prove, not just claim, that the chosen solution (Redis atomic operations + async queue + eventual database consistency) actually works under load, across the full authenticated stack, with a real payment gateway integration verified end-to-end.
