/**
 * Script test konkurensi untuk verifikasi atomic stock lock di Redis.
 * Jalankan dengan: bun run test-concurrency.ts
 */

const BASE_URL = 'http://localhost:3000';
const EVENT_ID = '99'; // pakai event id khusus buat testing, biar tidak bentrok data lain
const TOTAL_STOCK = 5;
const TOTAL_REQUESTS = 50; // jumlah user yang coba checkout bersamaan

async function main() {
  console.log(`Init stock event_${EVENT_ID} = ${TOTAL_STOCK}`);
  await fetch(`${BASE_URL}/health/test-stock/${EVENT_ID}/${TOTAL_STOCK}`);

  console.log(`Mengirim ${TOTAL_REQUESTS} request checkout secara PARALEL...`);

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

  console.log('\n=== HASIL TEST KONKURENSI ===');
  console.log(`Total request dikirim : ${TOTAL_REQUESTS}`);
  console.log(`Stok tersedia         : ${TOTAL_STOCK}`);
  console.log(`Berhasil (ok)         : ${okCount}`);
  console.log(`Ditolak (sold_out)    : ${soldOutCount}`);
  console.log(`Lainnya               : ${otherCount}`);

  if (okCount === TOTAL_STOCK) {
    console.log('\n✅ PASS — jumlah "ok" tepat sama dengan stok. Tidak ada race condition.');
  } else {
    console.log(`\n❌ FAIL — seharusnya "ok" = ${TOTAL_STOCK}, tapi hasilnya ${okCount}. Ada race condition!`);
  }
}

main();
