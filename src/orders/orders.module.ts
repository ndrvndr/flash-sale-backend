import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PaymentModule } from '../payment/payment.module';
import { OrdersExpiryService } from './orders-expiry.service';
import { OrdersController } from './orders.controller';
import { OrdersProcessor } from './orders.processor';
import { OrdersService } from './orders.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'orders-queue',
    }),
    PaymentModule,
  ],
  controllers: [OrdersController, WebhooksController],
  providers: [OrdersProcessor, OrdersService, OrdersExpiryService],
  exports: [BullModule],
})
export class OrdersModule {}
