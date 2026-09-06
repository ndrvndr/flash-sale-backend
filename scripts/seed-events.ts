/**
 * Seed script for example events.
 * Run with: bun run scripts/seed-events.ts
 *
 * Requires DATABASE_URL and REDIS_URL to be set, and the dev server
 * does NOT need to be running (this talks to the database/Redis directly).
 */
import { db, connectDatabase } from "../src/prisma/db";
import Redis from "ioredis";

const events = [
  { title: "Concert Flash Sale 2026", totalStock: 10, price: "250000" },
  { title: "Football Match Tickets", totalStock: 5, price: "150000" },
  { title: "Comedy Night Special", totalStock: 20, price: "100000" },
];

async function main() {
  await connectDatabase();

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is not set");
  }
  const redis = new Redis(redisUrl);

  console.log("Seeding example events...\n");

  for (const eventData of events) {
    const event = await db.orm.public.Event.create(eventData);
    await redis.set(`stock:event_${event.id}`, eventData.totalStock);

    console.log(`Created: "${event.title}"`);
    console.log(`  id: ${event.id}`);
    console.log(
      `  stock: ${eventData.totalStock}, price: ${eventData.price}\n`,
    );
  }

  console.log("Done. Use these event IDs to test checkout via Swagger.");
  await redis.quit();
  process.exit(0);
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});

export {};
