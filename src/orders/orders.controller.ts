import { Controller, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CheckoutDto } from './dto/checkout.dto';

@Controller('events')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post(':id/checkout')
  @HttpCode(HttpStatus.ACCEPTED)
  async checkout(@Param('id') eventId: string, @Body() dto: CheckoutDto) {
    return this.ordersService.checkout(eventId, dto.userId);
  }
}
