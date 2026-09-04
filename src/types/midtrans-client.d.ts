declare module 'midtrans-client' {
  export interface MidtransConfig {
    isProduction: boolean;
    serverKey: string;
    clientKey: string;
  }

  export interface SnapTransactionParameter {
    transaction_details: {
      order_id: string;
      gross_amount: number;
    };
    [key: string]: unknown;
  }

  export interface SnapTransactionResponse {
    token: string;
    redirect_url: string;
  }

  export class Snap {
    constructor(config?: MidtransConfig);
    createTransaction(parameter: SnapTransactionParameter): Promise<SnapTransactionResponse>;
  }

  const midtransClient: {
    Snap: typeof Snap;
  };

  export default midtransClient;
}
