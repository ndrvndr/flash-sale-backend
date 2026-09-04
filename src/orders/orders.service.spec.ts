import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { createHash } from 'crypto';

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

const TEST_SERVER_KEY = 'test-server-key';

function buildSignature(orderId: string, statusCode: string, grossAmount: string): string {
  return createHash('sha512')
    .update(`${orderId}${statusCode}${grossAmount}${TEST_SERVER_KEY}`)
    .digest('hex');
}

describe('OrdersService', () => {
  let service: InstanceType<typeof OrdersService>;
  let mockRedisService: {
    tryReserveStock: ReturnType<typeof mock>;
    del: ReturnType<typeof mock>;
    client: { incr: ReturnType<typeof mock> };
  };
  let mockQueue: { add: ReturnType<typeof mock> };

  beforeEach(() => {
    process.env.MIDTRANS_SERVER_KEY = TEST_SERVER_KEY;

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
      const payload = {
        order_id: 'booking-1',
        status_code: '200',
        gross_amount: '100000.00',
        signature_key: 'wrong-signature',
        transaction_status: 'settlement',
      };

      let error: unknown;
      try {
        await service.handlePaymentWebhook(payload);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when required fields are missing', async () => {
      let error: unknown;
      try {
        await service.handlePaymentWebhook({ order_id: 'booking-1' });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when the order is not found', async () => {
      const payload = {
        order_id: 'booking-x',
        status_code: '200',
        gross_amount: '100000.00',
        signature_key: buildSignature('booking-x', '200', '100000.00'),
        transaction_status: 'settlement',
      };

      mockOrderWhere.mockReturnValueOnce({
        first: mock(() => Promise.resolve(null)),
        update: mock(() => Promise.resolve({})),
      } as any);

      let error: unknown;
      try {
        await service.handlePaymentWebhook(payload);
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

      const payload = {
        order_id: 'booking-1',
        status_code: '200',
        gross_amount: '100000.00',
        signature_key: buildSignature('booking-1', '200', '100000.00'),
        transaction_status: 'settlement',
      };

      const result = await service.handlePaymentWebhook(payload);

      expect(result.message).toBe('Order already processed');
    });

    it('updates status to PAID and removes the reservation key when transaction_status is settlement', async () => {
      const pendingOrder = { id: 'booking-1', status: 'PENDING', eventId: 'event-1', userId: 'user-1' };
      const updateMock = mock(() => Promise.resolve({ ...pendingOrder, status: 'PAID' }));

      mockOrderWhere.mockImplementation(() => ({
        first: mock(() => Promise.resolve(pendingOrder)),
        update: updateMock,
      }) as any);

      const payload = {
        order_id: 'booking-1',
        status_code: '200',
        gross_amount: '100000.00',
        signature_key: buildSignature('booking-1', '200', '100000.00'),
        transaction_status: 'settlement',
      };

      const result = await service.handlePaymentWebhook(payload);

      expect(result.message).toBe('Payment confirmed');
      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(mockRedisService.del).toHaveBeenCalledWith('reservation:event_event-1:user_user-1');
    });

    it('updates status to FAILED and releases stock when transaction_status is deny', async () => {
      const pendingOrder = { id: 'booking-1', status: 'PENDING', eventId: 'event-1', userId: 'user-1' };
      const updateMock = mock(() => Promise.resolve({ ...pendingOrder, status: 'FAILED' }));

      mockOrderWhere.mockImplementation(() => ({
        first: mock(() => Promise.resolve(pendingOrder)),
        update: updateMock,
      }) as any);

      const payload = {
        order_id: 'booking-1',
        status_code: '202',
        gross_amount: '100000.00',
        signature_key: buildSignature('booking-1', '202', '100000.00'),
        transaction_status: 'deny',
      };

      const result = await service.handlePaymentWebhook(payload);

      expect(result.message).toBe('Payment deny, stock released');
      expect(mockRedisService.client.incr).toHaveBeenCalledWith('stock:event_event-1');
      expect(mockRedisService.del).toHaveBeenCalledWith('reservation:event_event-1:user_user-1');
    });

    it('updates status to EXPIRED and releases stock when transaction_status is expire', async () => {
      const pendingOrder = { id: 'booking-1', status: 'PENDING', eventId: 'event-1', userId: 'user-1' };
      const updateMock = mock(() => Promise.resolve({ ...pendingOrder, status: 'EXPIRED' }));

      mockOrderWhere.mockImplementation(() => ({
        first: mock(() => Promise.resolve(pendingOrder)),
        update: updateMock,
      }) as any);

      const payload = {
        order_id: 'booking-1',
        status_code: '407',
        gross_amount: '100000.00',
        signature_key: buildSignature('booking-1', '407', '100000.00'),
        transaction_status: 'expire',
      };

      const result = await service.handlePaymentWebhook(payload);

      expect(result.message).toBe('Payment expire, stock released');
      expect(updateMock).toHaveBeenCalledTimes(1);
    });

    it('takes no action and keeps the order pending when transaction_status is pending', async () => {
      const pendingOrder = { id: 'booking-1', status: 'PENDING', eventId: 'event-1', userId: 'user-1' };

      mockOrderWhere.mockImplementation(() => ({
        first: mock(() => Promise.resolve(pendingOrder)),
        update: mock(() => Promise.resolve({})),
      }) as any);

      const payload = {
        order_id: 'booking-1',
        status_code: '201',
        gross_amount: '100000.00',
        signature_key: buildSignature('booking-1', '201', '100000.00'),
        transaction_status: 'pending',
      };

      const result = await service.handlePaymentWebhook(payload);

      expect(result.message).toContain('pending');
    });
  });
});
