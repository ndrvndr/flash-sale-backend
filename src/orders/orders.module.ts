import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrdersProcessor } from './orders.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'orders-queue',
    }),
  ],
  providers: [OrdersProcessor],
  exports: [BullModule],
})
export class OrdersModule {}
