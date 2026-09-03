/**
 * Load test end-to-end: Checkout -> Redis lock -> BullMQ -> Postgres
 * Jalankan dengan: bun run test-checkout-load.ts
 */

const BASE_URL = 'http://localhost:3000';

const EVENT_ID = 'df17f261-c32e-4601-968c-a9d7800fd3ac';
const USER_IDS = [
  '070ceb5c-6cf5-460f-8fb9-6b972fd35b4e',
  '4c5c8eca-b46c-4493-8b9f-944427bdd28a',
  '227f0451-8d9b-44ff-8ca8-5ab6d3ed91ca',
  '540fa44c-00e6-4177-b156-3fb51caf99ee',
  'c8e77eca-c4dd-472c-bc78-644d123980a8',
  '44d7ffc7-cda1-4511-9c71-427629d9101b',
  'c5eb05e0-ac58-4b49-8e8b-551b6c20bf5d',
  '06c5d7ef-a9d3-402f-9715-6b58ea690386',
  '168a8f07-bfdc-4356-89aa-755fb5c63015',
  '85eeada1-2de8-45f4-8b7f-90bc30e1f7aa',
  '1a23b931-fad3-498b-83b4-2bb8bb4919a8',
  '6d1d3042-daa4-49bc-ad20-aaa1fbe972e0',
  '31f09949-2505-4190-b2e0-f454ac6c4167',
  'f2836529-1bfa-4bbd-89e1-3abb32735c9d',
  '547f4b2f-9c4c-4a1a-86fb-64be6bea419d',
  'b314a731-5af4-4464-920b-c14d5c0bfca0',
  '1bd12364-6256-4cca-bce9-597970c75617',
  'fe43dbe0-095f-42a3-a33e-554af10f6958',
  'a18b3635-714e-4a39-b1e0-0b0568f29fd8',
  '9cff4c7f-cbcc-4bea-9c22-d9b0d001b8a9',
  'a14dd354-0c37-4a3c-9050-da244c21c3e4',
  '970ea82e-cc79-4ee5-8441-4ab8d8c79e28',
  'bfdf0bc5-8aac-4f2c-aa1f-579721a6a223',
  '10ac684d-da34-4509-aa6c-d83d723f9fde',
  '274d6150-ac3d-4c09-8a40-f8e1b08ae89b',
  '20402c30-f78f-42ed-b583-a7f2038227dd',
  '90962591-8b8f-4c09-905f-031ef2aa73aa',
  '85906360-8e52-4c89-94c6-418d58659ed9',
  '7b947bf3-a717-4b44-8877-938159b714ec',
  'd3bb0f9b-f2c7-426c-a1b0-5976783ad9ff',
];

const EXPECTED_STOCK = 5;

async function main() {
  console.log(`Mengirim ${USER_IDS.length} request checkout PARALEL ke event ${EVENT_ID}...`);

  const requests = USER_IDS.map((userId) =>
    fetch(`${BASE_URL}/events/${EVENT_ID}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
      .then(async (res) => ({
        userId,
        statusCode: res.status,
        body: await res.json(),
      }))
  );

  const results = await Promise.all(requests);

  console.log('\nContoh 3 response pertama untuk debug:');
  console.log(JSON.stringify(results.slice(0, 3), null, 2));

  const accepted = results.filter((r) => r.statusCode === 202);
  const conflict = results.filter((r) => r.statusCode === 409);
  const other = results.filter((r) => r.statusCode !== 202 && r.statusCode !== 409);

  console.log('\n=== HASIL CHECKOUT (LAYER REDIS + API) ===');
  console.log(`Total request        : ${USER_IDS.length}`);
  console.log(`Stok tersedia         : ${EXPECTED_STOCK}`);
  console.log(`202 Accepted          : ${accepted.length}`);
  console.log(`409 Conflict          : ${conflict.length}`);
  console.log(`Lainnya               : ${other.length}`);

  if (accepted.length !== EXPECTED_STOCK) {
    console.log(`\n❌ FAIL — seharusnya 202 Accepted = ${EXPECTED_STOCK}, tapi hasilnya ${accepted.length}`);
    return;
  }
  console.log('✅ Layer Redis/API PASS');

  console.log('\nMenunggu worker memproses semua job ke Postgres (5 detik)...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log('\nCek endpoint /health/orders-count/:eventId untuk verifikasi jumlah order tersimpan...');
  const countRes = await fetch(`${BASE_URL}/health/orders-count/${EVENT_ID}`);
  const countData = await countRes.json();

  console.log('\n=== HASIL VERIFIKASI POSTGRES ===');
  console.log(JSON.stringify(countData, null, 2));

  if (countData.total === EXPECTED_STOCK) {
    console.log(`\n✅ PASS TOTAL — jumlah order di Postgres (${countData.total}) tepat sama dengan stok (${EXPECTED_STOCK}). Tidak ada race condition end-to-end.`);
  } else {
    console.log(`\n❌ FAIL — jumlah order di Postgres (${countData.total}) tidak sama dengan stok (${EXPECTED_STOCK})!`);
  }
}

main();
