import { InjectQueue } from "@nestjs/bullmq";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Queue } from "bullmq";
import { createHash, randomUUID } from "crypto";

import { db } from "../prisma/db";
import { RedisService } from "../redis/redis.service";

@Injectable()
export class OrdersService {
  constructor(
    private readonly redisService: RedisService,
    @InjectQueue("orders-queue") private readonly ordersQueue: Queue,
  ) {}

  async checkout(eventId: string, userId: string) {
    const reserveResult = await this.redisService.tryReserveStock(
      eventId,
      userId,
    );

    if (reserveResult === "not_found") {
      throw new NotFoundException(`Event ${eventId} not found`);
    }

    if (reserveResult === "sold_out") {
      throw new ConflictException("Stok habis");
    }

    // reserveResult === 'ok' -> proceed to push to the queue
    const bookingId = randomUUID();

    await this.ordersQueue.add("create-order", {
      bookingId,
      eventId,
      userId,
    });

    return {
      bookingId,
      status: "PENDING",
      message: "Checkout successful, order is being processed.",
    };
  }

  async handlePaymentWebhook(payload: any) {
    const {
      order_id: orderId,
      status_code: statusCode,
      gross_amount: grossAmount,
      signature_key: signatureKey,
      transaction_status: transactionStatus,
      fraud_status: fraudStatus,
    } = payload ?? {};

    if (
      !orderId ||
      !statusCode ||
      !grossAmount ||
      !signatureKey ||
      !transactionStatus
    ) {
      throw new BadRequestException("Missing required webhook fields");
    }

    // Signature verification in accordance with official Midtrans specifications:
    // SHA512(order_id + status_code + gross_amount + ServerKey)
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    if (!serverKey) {
      throw new BadRequestException(
        "Server misconfiguration: MIDTRANS_SERVER_KEY not set",
      );
    }

    const expectedSignature = createHash("sha512")
      .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
      .digest("hex");

    if (expectedSignature !== signatureKey) {
      throw new BadRequestException("Invalid signature");
    }

    const order = await db.orm.public.Order.where({ id: orderId }).first();
    if (!order) {
      throw new BadRequestException(`Order ${orderId} not found`);
    }

    // Idempotency check
    if (order.status === "PAID") {
      return { message: "Order already processed", order };
    }

    // Mapping status Midtrans -> OrderStatus
    const isPaid =
      transactionStatus === "settlement" ||
      (transactionStatus === "capture" && fraudStatus === "accept");

    const isFailed =
      transactionStatus === "deny" ||
      transactionStatus === "cancel" ||
      transactionStatus === "expire";

    if (isPaid) {
      const updatedOrder = await db.orm.public.Order.where({
        id: orderId,
      }).update({
        status: "PAID",
        paymentGatewayRef: orderId,
      });

      await this.redisService.del(
        `reservation:event_${order.eventId}:user_${order.userId}`,
      );

      return { message: "Payment confirmed", order: updatedOrder };
    }

    if (isFailed) {
      const newStatus = transactionStatus === "expire" ? "EXPIRED" : "FAILED";

      const updatedOrder = await db.orm.public.Order.where({
        id: orderId,
      }).update({ status: newStatus });

      await this.redisService.client.incr(`stock:event_${order.eventId}`);
      await this.redisService.del(
        `reservation:event_${order.eventId}:user_${order.userId}`,
      );

      return {
        message: `Payment ${transactionStatus}, stock released`,
        order: updatedOrder,
      };
    }

    // transaction_status === 'pending' -> no action needed, the order remains PENDING.
    return {
      message: `Transaction status: ${transactionStatus}, no action taken`,
      order,
    };
  }

  async getOrderById(orderId: string, requestingUserId: string) {
    const order = await db.orm.public.Order.where({ id: orderId }).first();

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    if (order.userId !== requestingUserId) {
      throw new ForbiddenException("You do not have access to this order");
    }

    return order;
  }
}
