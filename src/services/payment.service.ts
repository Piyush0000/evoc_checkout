/**
 * Payment Intent Response Structure
 * Every gateway must return at least a transaction ID.
 */
export interface PaymentIntent {
  id: string; // e.g., 'pi_123' (Stripe) or 'order_123' (Razorpay)
  clientSecret?: string; // Necessary for Stripe/Juspay/PayU frontend SDKs
  status: 'created' | 'requires_action' | 'succeeded' | 'failed';
}

/**
 * Customer details required by most gateways (PayU, Razorpay, etc.)
 */
export interface CustomerDetails {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/**
 * Common interface for all Payment Gateways
 */
export interface IPaymentGateway {
  createIntent(
    amount: number,
    currency: string,
    customer: CustomerDetails,
    productInfo: string
  ): Promise<PaymentIntent>;
}

/**
 * Mock PayU Implementation (India-focused)
 */
export class PayUGateway implements IPaymentGateway {
  async createIntent(
    amount: number,
    currency: string,
    customer: CustomerDetails,
    productInfo: string
  ): Promise<PaymentIntent> {
    console.info(`[PAYU] Creating Transaction for ${amount} ${currency}`);
    console.info(
      `[PAYU] Customer: ${customer.firstName} (${customer.email}), Product: ${productInfo}`
    );

    // In a real app:
    // const hash = generatePayUHash(key, txnid, amount, productInfo, customer.firstName, customer.email, salt);
    // const response = await fetch('https://secure.payu.in/_payment', { body: { ..., hash } });

    return {
      id: `payu_txid_${Math.random().toString(36).substring(7)}`,
      clientSecret: `payu_hash_mock_${Math.random().toString(36).substring(7)}`,
      status: 'created',
    };
  }
}

/**
 * Mock Razorpay Implementation
 */
export class RazorpayGateway implements IPaymentGateway {
  async createIntent(
    amount: number,
    currency: string,
    customer: CustomerDetails,
    _productInfo: string
  ): Promise<PaymentIntent> {
    console.info(`[RAZORPAY] Creating Order for ${amount} ${currency}`);
    console.info(`[RAZORPAY] Linking to customer phone: ${customer.phone}`);

    // In a real app:
    // const order = await razorpay.orders.create({
    //   amount: amount * 100,
    //   currency,
    //   notes: { email: customer.email, name: customer.firstName }
    // });

    return {
      id: `order_mock_${Math.random().toString(36).substring(7)}`,
      status: 'created',
    };
  }
}

/**
 * Factory to get the correct gateway strategy
 */
export class PaymentService {
  static getGateway(gatewayName: string): IPaymentGateway {
    switch (gatewayName.toUpperCase()) {
      case 'PAYU':
        return new PayUGateway();
      case 'RAZORPAY':
        return new RazorpayGateway();
      default:
        throw new Error(`Unsupported gateway: ${gatewayName}`);
    }
  }
}
