-- KEYS[1] = stock key, contoh: "stock:event_123"
-- KEYS[2] = reservation key, contoh: "reservation:event_123:user_A"
-- ARGV[1] = TTL reservation dalam detik, contoh: 300 (5 menit)

local stock = tonumber(redis.call('GET', KEYS[1]))

if stock == nil then
  return -1  -- event/stock key tidak ditemukan
end

if stock <= 0 then
  return 0  -- stok habis
end

redis.call('DECR', KEYS[1])
redis.call('SET', KEYS[2], '1', 'EX', ARGV[1])

return 1  -- berhasil, stok terkunci untuk user ini
