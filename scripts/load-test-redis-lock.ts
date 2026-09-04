/**
 * Concurrency test script to verify atomic stock locking in Redis.
 * Run with: bun run test-concurrency.ts
 */

const BASE_URL = 'http://localhost:3000';
const EVENT_ID = '99'; // Use a dedicated event ID for testing to avoid conflicts with other data.
const TOTAL_STOCK = 5;
const TOTAL_REQUESTS = 50; // number of users attempting to check out simultaneously

async function main() {
  console.log(`Init stock event_${EVENT_ID} = ${TOTAL_STOCK}`);
  await fetch(`${BASE_URL}/health/test-stock/${EVENT_ID}/${TOTAL_STOCK}`);

  console.log(`Sending ${TOTAL_REQUESTS} checkout requests in parallel...`);

  const requests = Array.from({ length: TOTAL_REQUESTS }, (_, i) => {
    const userId = `loadtest_user_${i}`;
    return fetch(`${BASE_URL}/health/test-reserve/${EVENT_ID}/${userId}`)
      .then((res) => res.json())
      .then((data) => ({ userId, result: data.result }));
  });

  const results = await Promise.all(requests);

  const okCount = results.filter((r) => r.result === 'ok').length;
  const soldOutCount = results.filter((r) => r.result === 'sold_out').length;
  const otherCount = results.length - okCount - soldOutCount;

  console.log('\n=== CONCURRENCY TEST RESULTS ===');
  console.log(`Total requests sent    : ${TOTAL_REQUESTS}`);
  console.log(`In stock               : ${TOTAL_STOCK}`);
  console.log(`Successful (ok)        : ${okCount}`);
  console.log(`Rejected (sold_out)    : ${soldOutCount}`);
  console.log(`Other                  : ${otherCount}`);

  if (okCount === TOTAL_STOCK) {
    console.log('\n✅ PASS — the number of "ok"s exactly matches the stock. No race condition.');
  } else {
    console.log(`\n❌ FAIL — expected "ok" = ${TOTAL_STOCK}, but got ${okCount}. There is a race condition!`);
  }
}

main();

export {};
