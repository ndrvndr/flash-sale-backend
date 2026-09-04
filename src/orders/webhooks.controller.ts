import { Controller, Post, Body } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('payment')
  async paymentWebhook(@Body() payload: any) {
    return this.ordersService.handlePaymentWebhook(payload);
  }
}
