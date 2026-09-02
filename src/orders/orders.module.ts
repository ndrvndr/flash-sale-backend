import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersProcessor } from './orders.processor';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'orders-queue',
    }),
  ],
  controllers: [OrdersController],
  providers: [OrdersProcessor, OrdersService],
  exports: [BullModule],
})
export class OrdersModule {}
