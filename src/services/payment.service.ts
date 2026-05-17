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
  address?: {
    line1: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
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
 * PayU v2 Implementation (Hosted Checkout / Non-Seamless)
 */
export class PayUV2Gateway implements IPaymentGateway {
  readonly key: string;
  readonly salt: string;
  private paymentsUrl: string;
  private transactionUrl: string;
  private surl: string;
  private furl: string;

  constructor() {
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      if (!process.env.PAYU_KEY || !process.env.PAYU_SALT) {
        throw new Error('[PAYU_V2] ❌ CRITICAL: Credentials missing in production.');
      }
      this.key = process.env.PAYU_KEY;
      this.salt = process.env.PAYU_SALT;
    } else {
      this.key = process.env.PAYU_KEY || process.env.TEST_PAYU_KEY || '';
      this.salt = process.env.PAYU_SALT || process.env.TEST_PAYU_SALT || '';
    }

    this.paymentsUrl = isProduction
      ? 'https://api.payu.in/v2/payments'
      : 'https://apitest.payu.in/v2/payments';

    this.transactionUrl = isProduction
      ? 'https://info.payu.in/v3/transaction'
      : 'https://test.payu.in/v3/transaction';

    const callbackUrl =
      process.env.PAYU_CALLBACK_URL || 'http://localhost:3000/api/v1/checkout/payu/callback';
    this.surl = callbackUrl;
    this.furl = callbackUrl;
  }

  private generateV2Auth(body: Record<string, unknown>, dateStr: string): string {
    const data = JSON.stringify(body);
    // Hash logic: sha512(`<Body data>` + '|' + date + '|' + merchant_secret)
    const hashString = `${data}|${dateStr}|${this.salt}`;
    const hash = crypto.createHash('sha512').update(hashString).digest('hex');
    return `hmac username="${this.key}", algorithm="sha512", headers="date", signature="${hash}"`;
  }

  async createIntent(
    amount: number,
    _currency: string,
    customer: CustomerDetails,
    productInfo: string,
    _paymentMethod?: string
  ): Promise<PaymentIntent> {
    const txnid = `txid_v2_${crypto.randomBytes(12).toString('hex')}`;
    const date = new Date().toUTCString();

    const body = {
      accountId: this.key,
      txnId: txnid,
      order: {
        productInfo,
        paymentChargeSpecification: {
          price: amount,
        },
      },
      billingDetails: {
        firstName: customer.firstName,
        lastName: customer.lastName || '',
        email: customer.email,
        phone: customer.phone,
        address: {
          address1: customer.address?.line1 || 'NA',
          city: customer.address?.city || 'NA',
          state: customer.address?.state || 'NA',
          country: customer.address?.country || 'India',
          zipCode: customer.address?.zipCode || '110001',
        },
      },
      callBackActions: {
        successAction: this.surl,
        failureAction: this.furl,
        cancelAction: this.furl,
      },
      additionalInfo: {
        txnFlow: 'nonseamless',
      },
    };

    const authHeader = this.generateV2Auth(body, date);

    try {
      console.info(`[PAYU_V2] Initiating payment for TXN ${txnid} via API`);
      const response = await fetch(this.paymentsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          date: date,
          authorization: authHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000), // 15s timeout
      });

      const resData = await response.json();

      // Fix: Some PayU v2 environments return status: 'PENDING' (string) instead of status: 1 (number)
      // If we have a checkoutUrl, we consider it a success.
      const isSuccess =
        resData.result?.checkoutUrl && (resData.status === 1 || resData.status === 'PENDING');

      if (!isSuccess) {
        console.error('[PAYU_V2] API Error Response:', resData);
        throw new Error(`PayU V2 API Error: ${resData.message || resData.msg || 'Unknown error'}`);
      }

      return {
        id: txnid,
        status: 'created',
        paymentUrl: resData.result.checkoutUrl,
      };
    } catch (error) {
      console.error('[PAYU_V2] Create Intent Error:', error);
      throw error;
    }
  }

  verifyResponseHash(payload: PayloadRecord): boolean {
    // Re-use V1's reverse hash verification for callbacks if they follow the same format.
    // NOTE: This logic is partially derived from the now deprecated v1 implementation.
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

    // Formula: SALT|status|udf10|udf9|udf8|udf7|udf6|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
    const baseNoSplit = `${this.salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${effectiveKey}`;
    const baseWithSplit = `${this.salt}|${status}|${splitInfo}|||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${effectiveKey}`;

    const candidateStrings = [baseNoSplit, baseWithSplit];

    const amountNum = parseFloat(amount);
    if (!isNaN(amountNum)) {
      const normalizedAmount = amountNum.toFixed(2);
      if (normalizedAmount !== amount) {
        candidateStrings.push(
          `${this.salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${normalizedAmount}|${txnid}|${effectiveKey}`
        );
      }
    }

    const finalCandidates = [...candidateStrings];
    if (additional_charges) {
      candidateStrings.forEach((c) => finalCandidates.push(`${additional_charges}|${c}`));
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

  async verifyPaymentReconciliation(txnid: string): Promise<ReconciliationResult> {
    const date = new Date().toUTCString();
    const body = { txnId: [txnid] };
    const authHeader = this.generateV2Auth(body, date);

    try {
      const response = await fetch(this.transactionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          date: date,
          authorization: authHeader,
          'Info-Command': 'verify_payment',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000), // 15s timeout
      });

      const resData = await response.json();

      if (resData.status === 1 && Array.isArray(resData.result) && resData.result.length > 0) {
        const txn = resData.result[0];
        console.info(`[PAYU_V2] Verification successful for ${txnid}: ${txn.status}`);
        return {
          status: 1,
          transaction_details: {
            [txnid]: { status: txn.status },
          },
        };
      }

      console.warn(
        `[PAYU_V2] Verification failed or pending for ${txnid}:`,
        resData.message || resData.msg
      );
      return { status: 0, msg: resData.message || resData.msg || 'Transaction not found' };
    } catch (error) {
      console.error('[PAYUV2] Reconciliation Error:', error);
      throw error;
    }
  }

  /**
   * Helper for testing/debugging. Generates a valid callback payload.
   * Note: V2 callbacks currently use the same reverse hash logic as V1.
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
      mihpayid: `mock_v2_${Math.random().toString(36).substring(7)}`,
    };

    // sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
    const reverseHashString = `${this.salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${this.key}`;
    const hash = crypto.createHash('sha512').update(reverseHashString).digest('hex');

    return { ...payload, hash };
  }
}

/**
 * [RETIRED/DEPRECATED] PayU v1 Implementation
 * Favor PayUV2Gateway for more modern API-to-API communication.
 * This class is kept for reference but is no longer actively used.
 */
/*
export class PayUGateway implements IPaymentGateway {
  readonly key: string;
  readonly salt: string;
  private surl: string;
  private furl: string;
  private paymentUrl: string;

  constructor() {
    const isProduction = process.env.NODE_ENV === 'production';

    // Strict Production Check: Throw error if live keys are missing
    if (isProduction) {
      if (!process.env.PAYU_KEY || !process.env.PAYU_SALT) {
        throw new Error(
          '[PAYU] ❌ CRITICAL: PAYU_KEY or PAYU_SALT is missing in production environment. ' +
            'Payment processing is disabled for safety.'
        );
      }
      this.key = process.env.PAYU_KEY;
      this.salt = process.env.PAYU_SALT;
    } else {
      // Development Fallback
      this.key = process.env.PAYU_KEY || process.env.TEST_PAYU_KEY || '';
      this.salt = process.env.PAYU_SALT || process.env.TEST_PAYU_SALT || '';

      if (!this.key || !this.salt) {
        console.warn('[PAYU] ⚠️ Warning: PayU keys are missing. Set them in .env for testing.');
      }
    }

    const callbackUrl = process.env.PAYU_CALLBACK_URL;
    if (!callbackUrl && isProduction) {
      console.error(
        '[PAYU] ⚠️ CRITICAL: PAYU_CALLBACK_URL is not set in production! ' +
          'Callbacks will default to localhost and likely fail. Set this variable immediately.'
      );
    }

    // Default to local/relative path if not provided
    const defaultCallback = 'http://localhost:3000/api/v1/checkout/payu/callback';
    this.surl = callbackUrl || defaultCallback;
    this.furl = callbackUrl || defaultCallback;

    this.paymentUrl = isProduction
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

    const reverseHashString = `${this.salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${this.key}`;
    const hash = crypto.createHash('sha512').update(reverseHashString).digest('hex');

    return { ...payload, hash };
  }

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

    const baseNoSplit = `${this.salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${effectiveKey}`;
    const baseWithSplit = `${this.salt}|${status}|${splitInfo}|||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${effectiveKey}`;

    const candidateStrings = [baseNoSplit, baseWithSplit];

    const amountNum = parseFloat(amount);
    if (!isNaN(amountNum)) {
      const normalizedAmount = amountNum.toFixed(2);
      if (normalizedAmount !== amount) {
        candidateStrings.push(
          `${this.salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${normalizedAmount}|${txnid}|${effectiveKey}`
        );
      }
    }

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

  async verifyPaymentReconciliation(txnid: string): Promise<ReconciliationResult> {
    const command = 'verify_payment';
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
*/

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
    _currency: string,
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
      case 'PAYU_V2':
        return new PayUV2Gateway();
      case 'RAZORPAY':
        return new RazorpayGateway();
      case 'COD':
        return new CodGateway();
      default:
        throw new Error(`Unsupported gateway: ${gatewayName}`);
    }
  }
}
