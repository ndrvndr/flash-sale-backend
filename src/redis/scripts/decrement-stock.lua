-- KEYS[1] = Stock key, example: "stock:event_123"
-- KEYS[2] = Reservation key, example: "reservation:event_123:user_A"
-- ARGV[1] = Reservation TTL in seconds, e.g., 300 (5 minutes)

local stock = tonumber(redis.call('GET', KEYS[1]))

if stock == nil then
  return -1  -- Event/stock key not found
end

if stock <= 0 then
  return 0  -- Out of stock
end

redis.call('DECR', KEYS[1])
redis.call('SET', KEYS[2], '1', 'EX', ARGV[1])

return 1  -- Success, stock locked for this user.
