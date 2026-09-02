import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersProcessor } from './orders.processor';
import { OrdersService } from './orders.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'orders-queue',
    }),
  ],
  controllers: [OrdersController, WebhooksController],
  providers: [OrdersProcessor, OrdersService],
  exports: [BullModule],
})
export class OrdersModule {}
