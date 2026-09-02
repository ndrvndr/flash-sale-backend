import { Controller, Post, Body } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('payment')
  async paymentWebhook(@Body() dto: PaymentWebhookDto) {
    return this.ordersService.handlePaymentWebhook(dto.bookingId, dto.status, dto.signature);
  }
}
