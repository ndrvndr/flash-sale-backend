import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class PaymentWebhookDto {
  @IsString()
  @IsNotEmpty()
  bookingId!: string; // This is Order.id.

  @IsString()
  @IsIn(['success', 'failure'])
  status!: string; // Mock status of payment gateway

  @IsString()
  @IsNotEmpty()
  signature!: string; // Mock signature verification
}
