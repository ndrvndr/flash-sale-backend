import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class PaymentWebhookDto {
  @IsString()
  @IsNotEmpty()
  bookingId!: string; // ini adalah Order.id

  @IsString()
  @IsIn(['success', 'failure'])
  status!: string; // mock status dari payment gateway

  @IsString()
  @IsNotEmpty()
  signature!: string; // mock signature verification
}
