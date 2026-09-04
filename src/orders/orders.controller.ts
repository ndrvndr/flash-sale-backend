import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CheckoutDto } from './dto/checkout.dto';
import { OrdersService } from './orders.service';

interface AuthenticatedRequest extends Request {
  user: { id: string; email: string };
}

@Controller('events')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @UseGuards(JwtAuthGuard)
  @Post(':id/checkout')
  @HttpCode(HttpStatus.ACCEPTED)
  async checkout(
    @Param('id') eventId: string,
    @Req() req: AuthenticatedRequest,
    @Body() _dto: CheckoutDto,
  ) {
    return this.ordersService.checkout(eventId, req.user.id);
  }
}
