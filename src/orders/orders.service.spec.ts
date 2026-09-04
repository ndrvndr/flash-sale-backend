import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';

// ---- Mock db (Prisma) before importing the module under test ----
const mockOrderCreate = mock(() => Promise.resolve({}));
const mockOrderWhere = mock(() => ({
  first: mock(() => Promise.resolve(null)),
  update: mock(() => Promise.resolve({})),
}));

mock.module('../prisma/db', () => ({
  db: {
    orm: {
      public: {
        Order: {
          create: mockOrderCreate,
          where: mockOrderWhere,
        },
      },
    },
  },
}));

// ---- Import after mock.module so the mock is registered first ----
const { OrdersService } = await import('./orders.service');

describe('OrdersService', () => {
  let service: InstanceType<typeof OrdersService>;
  let mockRedisService: {
    tryReserveStock: ReturnType<typeof mock>;
    del: ReturnType<typeof mock>;
    client: { incr: ReturnType<typeof mock> };
  };
  let mockQueue: { add: ReturnType<typeof mock> };

  beforeEach(() => {
    mockOrderWhere.mockImplementation(() => ({
        first: mock(() => Promise.resolve(null)),
        update: mock(() => Promise.resolve({})),
      }) as any);

    mockRedisService = {
      tryReserveStock: mock(() => Promise.resolve('ok')),
      del: mock(() => Promise.resolve()),
      client: { incr: mock(() => Promise.resolve(1)) },
    };
    mockQueue = { add: mock(() => Promise.resolve({ id: 'job-1' })) };

    service = new OrdersService(mockRedisService as any, mockQueue as any);
  });

  describe('checkout', () => {
    it('throws ConflictException when stock is sold out', async () => {
      mockRedisService.tryReserveStock = mock(() => Promise.resolve('sold_out'));
      service = new OrdersService(mockRedisService as any, mockQueue as any);

      let error: unknown;
      try {
        await service.checkout('event-1', 'user-1');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when the event does not exist', async () => {
      mockRedisService.tryReserveStock = mock(() => Promise.resolve('not_found'));
      service = new OrdersService(mockRedisService as any, mockQueue as any);

      let error: unknown;
      try {
        await service.checkout('event-x', 'user-1');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(NotFoundException);
    });

    it('pushes a job to the queue and returns a bookingId when the reservation succeeds', async () => {
      const result = await service.checkout('event-1', 'user-1');

      expect(result.status).toBe('PENDING');
      expect(result.bookingId).toBeDefined();
      expect(mockQueue.add).toHaveBeenCalledTimes(1);

      const [jobName, jobData] = mockQueue.add.mock.calls[0] as [string, any];
      expect(jobName).toBe('create-order');
      expect(jobData.eventId).toBe('event-1');
      expect(jobData.userId).toBe('user-1');
    });
  });

  describe('handlePaymentWebhook', () => {
    it('throws BadRequestException when the signature is invalid', async () => {
      let error: unknown;
      try {
        await service.handlePaymentWebhook('booking-1', 'success', 'wrong-signature');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when the order is not found', async () => {
      mockOrderWhere.mockReturnValueOnce({
        first: mock(() => Promise.resolve(null)),
        update: mock(() => Promise.resolve({})),
      } as any);

      let error: unknown;
      try {
        await service.handlePaymentWebhook('booking-x', 'success', 'mock-webhook-secret');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(BadRequestException);
    });

    it('does not reprocess an order that is already PAID (idempotency)', async () => {
      const paidOrder = { id: 'booking-1', status: 'PAID', eventId: 'event-1', userId: 'user-1' };
      mockOrderWhere.mockReturnValueOnce({
        first: mock(() => Promise.resolve(paidOrder)),
        update: mock(() => Promise.resolve({})),
      } as any);

      const result = await service.handlePaymentWebhook('booking-1', 'success', 'mock-webhook-secret');

      expect(result.message).toBe('Order already processed');
    });

    it('updates status to PAID and removes the reservation key on successful payment', async () => {
      const pendingOrder = { id: 'booking-1', status: 'PENDING', eventId: 'event-1', userId: 'user-1' };
      const updateMock = mock(() => Promise.resolve({ ...pendingOrder, status: 'PAID' }));

      mockOrderWhere.mockImplementation(() => ({
        first: mock(() => Promise.resolve(pendingOrder)),
        update: updateMock,
      }) as any);

      const result = await service.handlePaymentWebhook('booking-1', 'success', 'mock-webhook-secret');

      expect(result.message).toBe('Payment confirmed');
      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(mockRedisService.del).toHaveBeenCalledWith('reservation:event_event-1:user_user-1');
    });

    it('updates status to FAILED and releases the stock on failed payment', async () => {
      const pendingOrder = { id: 'booking-1', status: 'PENDING', eventId: 'event-1', userId: 'user-1' };
      const updateMock = mock(() => Promise.resolve({ ...pendingOrder, status: 'FAILED' }));

      mockOrderWhere.mockImplementation(() => ({
        first: mock(() => Promise.resolve(pendingOrder)),
        update: updateMock,
      }) as any);

      const result = await service.handlePaymentWebhook('booking-1', 'failure', 'mock-webhook-secret');

      expect(result.message).toBe('Payment failed, stock released');
      expect(mockRedisService.client.incr).toHaveBeenCalledWith('stock:event_event-1');
      expect(mockRedisService.del).toHaveBeenCalledWith('reservation:event_event-1:user_user-1');
    });
  });
});
