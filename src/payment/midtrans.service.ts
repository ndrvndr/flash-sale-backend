import { Injectable, Logger } from '@nestjs/common';
import midtransClient from 'midtrans-client';

@Injectable()
export class MidtransService {
  private readonly logger = new Logger(MidtransService.name);
  private snap: InstanceType<typeof midtransClient.Snap>;

  constructor() {
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    const clientKey = process.env.MIDTRANS_CLIENT_KEY;

    if (!serverKey || !clientKey) {
      throw new Error('MIDTRANS_SERVER_KEY and MIDTRANS_CLIENT_KEY must be set');
    }

    this.snap = new midtransClient.Snap({
      isProduction: false,
      serverKey,
      clientKey,
    });
  }

  async createTransaction(orderId: string, grossAmount: number) {
    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount,
      },
    };

    const transaction = await this.snap.createTransaction(parameter);
    this.logger.log(`Midtrans transaction created for order ${orderId}`);

    return {
      snapToken: transaction.token,
      paymentUrl: transaction.redirect_url,
    };
  }
}
