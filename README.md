# Flash Sale Backend

A high-concurrency ticket flash sale engine built to solve one core problem: **preventing overselling when hundreds of users try to buy the last few tickets at the same millisecond.**

Built with NestJS, PostgreSQL, Redis, and BullMQ — with real payment gateway integration (Midtrans) and JWT authentication.

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

## Proof: Concurrency Test Results

Rather than just claiming the system is race-condition-safe, here's the actual test:

**30 concurrent checkout requests** sent simultaneously against an event with **5 units of stock**:

```
Total requests          : 30
Stock available         : 5
202 Accepted            : 5
409 Conflict            : 25
```

After the queue drained, the number of `Order` rows in PostgreSQL was verified:

```
Orders in Postgres      : 5
Status breakdown        : { PENDING: 5 }
```

**Result: exactly 5 orders, no more, no less** — from the Redis layer all the way through to the database. No oversells, no lost reservations.

## Tech Stack

| Layer | Technology |
|---|---|
| API Framework | NestJS (Bun runtime) |
| Concurrency Control | Redis (`ioredis`) + Lua script |
| Async Processing | BullMQ |
| Database & ORM | PostgreSQL + Prisma 8 |
| Payment Gateway | Midtrans Snap API |
| Authentication | JWT (`@nestjs/jwt`, `passport-jwt`) |
| Scheduled Jobs | `@nestjs/schedule` |
| Testing | `bun:test` |

## API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Register a new user |
| POST | `/auth/login` | — | Log in, returns a JWT |
| POST | `/events/:id/checkout` | JWT required | Attempt to reserve stock and start checkout |
| POST | `/webhooks/payment` | Signature-verified | Midtrans payment notification handler |
| GET | `/health/redis` | — | Redis connectivity health check |

## Getting Started

### Prerequisites
- Node.js ^22.18.0 or >=24.11.0
- [Bun](https://bun.sh)
- A PostgreSQL database (e.g. [Prisma Postgres](https://www.prisma.io))
- A Redis instance (e.g. [Upstash](https://upstash.com)) — **set eviction to `noeviction`**, since BullMQ requires job data to persist
- A [Midtrans](https://midtrans.com) sandbox account

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

# Start the dev server
bun run dev
```

### Running tests

```bash
# Unit tests
bun test

# End-to-end concurrency load test (requires the dev server running)
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

- **Rate limiting per user** — prevent a single user from spamming checkout requests
- **PDF e-ticket generation & email delivery** — triggered as a follow-up BullMQ job after payment confirmation
- **Additional unit tests** — coverage for `OrdersProcessor` and `OrdersExpiryService`, currently only `OrdersService` is covered
- **Admin dashboard** — CRUD for events, sales monitoring
- **Refresh token flow** — current JWT setup only issues short-lived access tokens
- **Dead-letter queue handling** — more robust retry/failure handling for BullMQ jobs that exhaust retries

## Why This Project

This project was built to demonstrate a specific, well-known distributed systems problem — race conditions under high concurrency — and to prove, not just claim, that the chosen solution (Redis atomic operations + async queue + eventual database consistency) actually works under load.
