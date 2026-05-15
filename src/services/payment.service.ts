import crypto from 'crypto';

/** Shape of a reconciliation API response */
export interface ReconciliationResult {
  status: number;
  transaction_details?: Record<string, { status: string }>;
  msg?: string;
}

/** Shape of a gateway callback payload (key-value pairs from form POST or query params) */
export type PayloadRecord = Record<string, string | string[] | undefined>;

/**
 * Payment Intent Response Structure
 * Every gateway must return at least a transaction ID.
 */
export interface PaymentIntent {
  id: string; // e.g., 'pi_123' (Stripe) or 'order_123' (Razorpay)
  clientSecret?: string; // Necessary for Stripe/Juspay/PayU frontend SDKs
  status: 'created' | 'requires_action' | 'succeeded' | 'failed';
  paymentUrl?: string; // For redirect-based gateways
  additionalParams?: Record<string, string>; // All params needed for form post
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
 * Common interface for all Payment Gateways (Fix F)
 * Includes callback verification contract for gateways with server-side callbacks.
 */
export interface IPaymentGateway {
  createIntent(
    amount: number,
    currency: string,
    customer: CustomerDetails,
    productInfo: string,
    paymentMethod?: string
  ): Promise<PaymentIntent>;

  /**
   * Verify the authenticity of a callback/webhook payload.
   * Returns true if the hash/signature is valid.
   */
  verifyResponseHash(payload: PayloadRecord): boolean;

  /**
   * Verify a transaction via the gateway's reconciliation/verification API.
   * This is the "source of truth" to confirm payment status.
   */
  verifyPaymentReconciliation(txnid: string): Promise<ReconciliationResult>;
}

/**
 * PayU Implementation (India-focused)
 * Using Hosted Checkout / Web Checkout Pro logic
 */
export class PayUGateway implements IPaymentGateway {
  readonly key: string;
  readonly salt: string;
  private surl: string;
  private furl: string;
  private paymentUrl: string;

  constructor() {
    this.key = process.env.PAYU_KEY || process.env.TEST_PAYU_KEY || '';
    this.salt = process.env.PAYU_SALT || process.env.TEST_PAYU_SALT || '';

    // Fix G: Warn loudly if callback URL is missing in production
    const callbackUrl = process.env.PAYU_CALLBACK_URL;
    if (!callbackUrl && process.env.NODE_ENV === 'production') {
      console.error(
        '[PAYU] ⚠️  CRITICAL: PAYU_CALLBACK_URL is not set in production! ' +
          'All PayU callbacks will fail. Set this environment variable immediately.'
      );
    }
    this.surl = callbackUrl || 'http://localhost:3000/api/v1/checkout/payu/callback';
    this.furl = callbackUrl || 'http://localhost:3000/api/v1/checkout/payu/callback';

    // Production vs Test Endpoints
    this.paymentUrl =
      process.env.NODE_ENV === 'production'
        ? 'https://secure.payu.in/_payment'
        : 'https://test.payu.in/_payment';
  }

  private generateHash(params: {
    txnid: string;
    amount: string;
    productinfo: string;
    firstname: string;
    email: string;
    udf1?: string;
    udf2?: string;
    udf3?: string;
    udf4?: string;
    udf5?: string;
  }): string {
    const {
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      udf1 = '',
      udf2 = '',
      udf3 = '',
      udf4 = '',
      udf5 = '',
    } = params;

    // Formula: sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
    const hashString = `${this.key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${this.salt}`;

    if (process.env.NODE_ENV !== 'production') {
      console.info(`[PAYU] Generating hash for TXN ${txnid}. (Salt hidden in production logs)`);
    }

    return crypto.createHash('sha512').update(hashString).digest('hex');
  }

  async createIntent(
    amount: number,
    _currency: string,
    customer: CustomerDetails,
    productInfo: string,
    paymentMethod?: string
  ): Promise<PaymentIntent> {
    const txnid = `txid_${crypto.randomBytes(12).toString('hex')}`;
    const amountStr = amount.toFixed(2);

    const hash = this.generateHash({
      txnid,
      amount: amountStr,
      productinfo: productInfo,
      firstname: customer.firstName,
      email: customer.email,
    });

    // Build base params for Hosted Checkout
    const additionalParams: Record<string, string> = {
      key: this.key,
      txnid,
      amount: amountStr,
      productinfo: productInfo,
      firstname: customer.firstName,
      lastname: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      udf1: '',
      udf2: '',
      udf3: '',
      udf4: '',
      udf5: '',
      surl: this.surl,
      furl: this.furl,
      hash,
      // Fix H: Removed legacy 'service_provider: payu_paisa' — not required by modern PayU
    };

    // Fix I: Add UPI Intent params when payment method is PAYU_INTENT
    if (paymentMethod?.toUpperCase() === 'PAYU_INTENT') {
      additionalParams.pg = 'UPI';
      additionalParams.bankcode = 'INTENT';
      console.info(`[PAYU] UPI Intent flow enabled for TXN ${txnid}`);
    }

    return {
      id: txnid,
      clientSecret: hash,
      status: 'created',
      paymentUrl: this.paymentUrl,
      additionalParams,
    };
  }

  /**
   * Helper for manual testing without a frontend.
   * Generates a valid callback payload with the correct reverse hash.
   */
  getDebugCallbackPayload(params: {
    txnid: string;
    amount: string;
    productinfo: string;
    firstname: string;
    email: string;
    status: 'success' | 'failure';
  }): Record<string, string> {
    const { txnid, amount, productinfo, firstname, email, status } = params;
    const udf1 = '',
      udf2 = '',
      udf3 = '',
      udf4 = '',
      udf5 = '';

    const payload = {
      status,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      key: this.key,
      udf1,
      udf2,
      udf3,
      udf4,
      udf5,
      mihpayid: `mock_${Math.random().toString(36).substring(7)}`,
    };

    // sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
    const reverseHashString = `${this.salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${this.key}`;
    const hash = crypto.createHash('sha512').update(reverseHashString).digest('hex');

    return { ...payload, hash };
  }

  /**
   * Step 1.4.1: Response verification using reverse hashing
   * Formula: sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
   */
  verifyResponseHash(payload: PayloadRecord): boolean {
    const getString = (value: string | string[] | undefined): string => {
      if (Array.isArray(value)) return String(value[0] ?? '');
      return value == null ? '' : String(value);
    };

    const status = getString(payload.status);
    const udf1 = getString(payload.udf1);
    const udf2 = getString(payload.udf2);
    const udf3 = getString(payload.udf3);
    const udf4 = getString(payload.udf4);
    const udf5 = getString(payload.udf5);
    const email = getString(payload.email);
    const firstname = getString(payload.firstname);
    const productinfo = getString(payload.productinfo);
    const amount = getString(payload.amount);
    const txnid = getString(payload.txnid);
    const key = getString(payload.key);
    const hash = getString(payload.hash);
    const additional_charges = getString(payload.additional_charges);
    const splitInfo = getString(payload.splitInfo);

    if (!hash) return false;

    const effectiveKey = key || this.key;

    // Base strings for candidate verification
    // Formula: SALT|status|udf10|udf9|udf8|udf7|udf6|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
    const baseNoSplit = `${this.salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${effectiveKey}`;

    // Split formula often inserts splitInfo before UDFs or replaces a UDF slot
    const baseWithSplit = `${this.salt}|${status}|${splitInfo}|||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${effectiveKey}`;

    const candidateStrings = [baseNoSplit, baseWithSplit];

    // Try normalized amount (2 decimal places) as a fallback if the raw amount fails
    const amountNum = parseFloat(amount);
    if (!isNaN(amountNum)) {
      const normalizedAmount = amountNum.toFixed(2);
      if (normalizedAmount !== amount) {
        candidateStrings.push(
          `${this.salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${normalizedAmount}|${txnid}|${effectiveKey}`
        );
      }
    }

    // Prepend additional_charges if present
    const finalCandidates = [...candidateStrings];
    if (additional_charges) {
      candidateStrings.forEach((c) => finalCandidates.push(`${additional_charges}|${c}`));
    }

    if (process.env.NODE_ENV !== 'production') {
      console.info(
        `[PAYU] Verifying reverse hash for TXN ${txnid}. (Salt hidden in production logs)`
      );
    }

    try {
      const expectedHash = hash.toLowerCase();
      return finalCandidates.some((candidate) => {
        const calculatedHash = crypto.createHash('sha512').update(candidate).digest('hex');
        return crypto.timingSafeEqual(
          Buffer.from(calculatedHash, 'utf-8'),
          Buffer.from(expectedHash, 'utf-8')
        );
      });
    } catch {
      return false;
    }
  }

  /**
   * Step 1.6: Verify the payment via Reconciliation API (v3 Transaction API)
   * This is the "Source of Truth" to verify if a payment actually happened.
   */
  async verifyPaymentReconciliation(txnid: string): Promise<ReconciliationResult> {
    const command = 'verify_payment';
    // Formula: sha512(key|command|var1|salt)
    const hashString = `${this.key}|${command}|${txnid}|${this.salt}`;
    const hash = crypto.createHash('sha512').update(hashString).digest('hex');

    const url =
      process.env.NODE_ENV === 'production'
        ? 'https://info.payu.in/merchant/postservice.php?form=2'
        : 'https://test.payu.in/merchant/postservice.php?form=2';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          key: this.key,
          command,
          var1: txnid,
          hash,
        }),
      });

      if (!response.ok) {
        throw new Error(`PayU Reconciliation API failed with status ${response.status}`);
      }

      const data = await response.json();

      // PayU Test environment often returns status: 0 for unknown txns
      if (data.status === 0 && process.env.NODE_ENV !== 'production') {
        console.warn(
          `[PAYU] Reconciliation returned status 0 (Transaction not found). This is expected if you haven't actually paid on the PayU page yet.`
        );
      }

      return data;
    } catch (error) {
      console.error('[PAYU] Reconciliation Error:', error);
      throw error;
    }
  }
}

/**
 * Mock Razorpay Implementation
 * Implements the full IPaymentGateway contract with stubs for callback methods.
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

    return {
      id: `order_mock_${Math.random().toString(36).substring(7)}`,
      status: 'created',
    };
  }

  verifyResponseHash(_payload: PayloadRecord): boolean {
    // TODO: Implement Razorpay webhook signature verification
    console.warn('[RAZORPAY] verifyResponseHash is not yet implemented');
    return false;
  }

  async verifyPaymentReconciliation(_txnid: string): Promise<ReconciliationResult> {
    // TODO: Implement Razorpay payment fetch API
    console.warn('[RAZORPAY] verifyPaymentReconciliation is not yet implemented');
    return { status: 0 };
  }
}

/**
 * Cash on Delivery "Gateway"
 *
 * Not a real payment gateway — no external API calls, no hash, no callback.
 * The session transitions directly to COMPLETED when finalized with COD.
 * This class exists so COD can flow through the same `IPaymentGateway` interface,
 * keeping the controller code uniform.
 */
export class CodGateway implements IPaymentGateway {
  async createIntent(
    amount: number,
    currency: string,
    customer: CustomerDetails,
    _productInfo: string
  ): Promise<PaymentIntent> {
    const orderId = `cod_${crypto.randomBytes(12).toString('hex')}`;

    console.info(
      `[COD] Order ${orderId} created for ${customer.firstName} — ₹${amount.toFixed(2)} (collect on delivery)`
    );

    return {
      id: orderId,
      status: 'succeeded', // COD is "confirmed" immediately
      // No paymentUrl — no redirect needed
      // No clientSecret — no hash verification needed
    };
  }

  /**
   * COD has no callback hash to verify.
   */
  verifyResponseHash(_payload: PayloadRecord): boolean {
    return false;
  }

  /**
   * COD has no reconciliation API.
   */
  async verifyPaymentReconciliation(_txnid: string): Promise<ReconciliationResult> {
    console.warn('[COD] No reconciliation API for Cash on Delivery');
    return { status: 0 };
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
      case 'COD':
        return new CodGateway();
      default:
        throw new Error(`Unsupported gateway: ${gatewayName}`);
    }
  }
}
