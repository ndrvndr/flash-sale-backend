/**
 * End-to-end concurrency load test (with JWT auth).
 * Run with: bun run scripts/load-test-checkout-e2e.ts
 *
 * Requires the dev server to be running (bun run dev).
 */

const BASE_URL = "http://localhost:3000";
const TOTAL_USERS = 30;
const EVENT_STOCK = 5;

async function registerUser(
  index: number,
): Promise<{ userId: string; accessToken: string }> {
  const email = `loadtest-${Date.now()}-${index}@example.com`;
  const res = await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Failed to register ${email}: ${JSON.stringify(data)}`);
  }
  return { userId: data.user.id, accessToken: data.accessToken };
}

async function createTestEvent(accessToken: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      title: `Load Test Event ${Date.now()}`,
      totalStock: EVENT_STOCK,
      price: "50000",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Failed to create event: ${JSON.stringify(data)}`);
  }
  return data.id;
}

async function main() {
  console.log(`Registering ${TOTAL_USERS} test users...`);
  const users: { userId: string; accessToken: string }[] = [];
  for (let i = 0; i < TOTAL_USERS; i++) {
    users.push(await registerUser(i));
  }
  console.log(`Registered ${users.length} users.\n`);

  console.log(`Creating a fresh event with stock = ${EVENT_STOCK}...`);
  const eventId = await createTestEvent(users[0].accessToken);
  console.log(`Event created: ${eventId}\n`);

  console.log(`Sending ${TOTAL_USERS} concurrent checkout requests...`);
  const requests = users.map((user) =>
    fetch(`${BASE_URL}/events/${eventId}/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.accessToken}`,
      },
      body: JSON.stringify({}),
    }).then(async (res) => ({
      userId: user.userId,
      statusCode: res.status,
      body: await res.json(),
    })),
  );

  const results = await Promise.all(requests);

  const accepted = results.filter((r) => r.statusCode === 202);
  const conflict = results.filter((r) => r.statusCode === 409);
  const other = results.filter(
    (r) => r.statusCode !== 202 && r.statusCode !== 409,
  );

  console.log("\n=== CHECKOUT LAYER RESULTS (Redis + API) ===");
  console.log(`Total requests   : ${TOTAL_USERS}`);
  console.log(`Stock available  : ${EVENT_STOCK}`);
  console.log(`202 Accepted     : ${accepted.length}`);
  console.log(`409 Conflict     : ${conflict.length}`);
  console.log(`Other            : ${other.length}`);

  if (other.length > 0) {
    console.log("\nSample of unexpected responses:");
    console.log(JSON.stringify(other.slice(0, 3), null, 2));
  }

  if (accepted.length !== EVENT_STOCK) {
    console.log(
      `\n❌ FAIL — expected ${EVENT_STOCK} accepted, got ${accepted.length}`,
    );
    return;
  }
  console.log(
    "✅ Checkout layer PASS — no overselling at the API/Redis level.",
  );

  console.log(
    "\nWaiting 5 seconds for the worker to persist orders to Postgres...",
  );
  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log(
    "\nVerifying order count via GET /orders/:id for each accepted booking...",
  );
  const orderChecks = await Promise.all(
    accepted.map(async (r) => {
      const bookingId = r.body.bookingId;
      const acceptedUser = users.find((u) => u.userId === r.userId)!;
      const res = await fetch(`${BASE_URL}/orders/${bookingId}`, {
        headers: { Authorization: `Bearer ${acceptedUser.accessToken}` },
      });
      return res.ok;
    }),
  );

  const confirmedOrders = orderChecks.filter(Boolean).length;

  console.log("\n=== POSTGRES VERIFICATION ===");
  console.log(
    `Orders confirmed to exist: ${confirmedOrders} / ${accepted.length}`,
  );

  if (confirmedOrders === EVENT_STOCK) {
    console.log(
      `\n✅ PASS — exactly ${EVENT_STOCK} orders exist in Postgres. No race condition end-to-end.`,
    );
  } else {
    console.log(
      `\n❌ FAIL — expected ${EVENT_STOCK} orders, found ${confirmedOrders}.`,
    );
  }
}

main().catch((error) => {
  console.error("Load test failed:", error);
  process.exit(1);
});

export {};
