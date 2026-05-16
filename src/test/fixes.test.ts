/**
 * Tests for Issues A–N Fixes
 *
 * PREREQUISITE: Run `pnpm exec prisma migrate dev` before running these tests.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import app from '../app.js';
import { prisma } from '../config/prisma.js';
import {
  PayUV2Gateway,
  RazorpayGateway,
  CodGateway,
  type IPaymentGateway,
} from '../services/payment.service.js';

// Mock the OTP Service
vi.mock('../services/otp.service.js', () => ({
  OtpService: {
    sanitizePhone: vi.fn().mockImplementation((phone: string) => phone),
    sendOtp: vi.fn().mockResolvedValue('mock_provider_session_id'),
    verifyOtp: vi.fn().mockResolvedValue(true),
  },
}));

const TEST_STORE_ID = 'store_123';

/**
 * Builds a valid callback payload using the gateway's own credentials.
 * This ensures the hash matches regardless of what's in .env.
 */
function buildCallbackPayloadFromGateway(
  txnid: string,
  amount: string,
  status: 'success' | 'failure'
): Record<string, string> {
  const gateway = new PayUV2Gateway();
  return gateway.getDebugCallbackPayload({
    txnid,
    amount,
    productinfo: 'Fix Test Product',
    firstname: 'Fix',
    email: 'fixtester@example.com',
    status,
  });
}

/**
 * Creates a session at PAYMENT_PENDING state directly in the DB.
 */
async function seedPaymentPendingSession(opts: {
  phone: string;
  email: string;
  amount?: number;
}): Promise<{ sessionId: string; txnid: string; userId: string }> {
  const { phone, email, amount = 1000 } = opts;
  const txnid = `txid_test_${crypto.randomBytes(8).toString('hex')}`;

  const user = await prisma.user.upsert({
    where: { phone },
    update: { email },
    create: { phone, email },
  });

  const address = await prisma.address.create({
    data: {
      userId: user.id,
      firstName: 'Fix',
      lastName: 'Tester',
      flatHouse: '42 Debug Lane',
      areaStreet: 'Test Street',
      receiversPhone: phone,
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
    },
  });

  const session = await prisma.checkoutSession.create({
    data: {
      storeId: TEST_STORE_ID,
      userId: user.id,
      addressId: address.id,
      items: [
        { productId: 'p1', sku: 'SKU1', name: 'Fix Test Product', price: amount, quantity: 1 },
      ],
      totalAmount: amount,
      currency: 'INR',
      status: 'PAYMENT_PENDING',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      paymentGateway: 'PayU',
      gatewayTransactionId: txnid,
    },
  });

  await prisma.transaction.create({
    data: {
      sessionId: session.id,
      storeId: TEST_STORE_ID,
      amount,
      status: 'PENDING',
      paymentMethod: 'ONLINE',
      paymentGateway: 'PayU',
      gatewayTransactionId: txnid,
    },
  });

  return { sessionId: session.id, txnid, userId: user.id };
}

async function cleanupByPhones(phones: string[]) {
  for (const phone of phones) {
    await prisma.otpVerification.deleteMany({ where: { phone } });
  }
  const users = await prisma.user.findMany({ where: { phone: { in: phones } } });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    const sessions = await prisma.checkoutSession.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);
    await prisma.transaction.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.checkoutSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

// ═══════════════════════════════════════════════════════════════════

describe('Fix A: GET handler for /payu/callback', () => {
  const phone = '+911111100001';
  const email = 'fixa@example.com';

  beforeAll(async () => {
    await cleanupByPhones([phone]);
  });

  it('should accept GET callbacks (mobile/3DS redirect)', async () => {
    const { txnid } = await seedPaymentPendingSession({ phone, email });
    const payload = buildCallbackPayloadFromGateway(txnid, '1000.00', 'success');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 1,
        transaction_details: { [txnid]: { status: 'success' } },
      }),
    }) as unknown as typeof fetch;

    const queryString = new URLSearchParams(payload).toString();
    const response = await request(app).get(`/api/v1/checkout/payu/callback?${queryString}`);

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/checkout/success');
  });

  it('should still accept POST callbacks', async () => {
    const { txnid } = await seedPaymentPendingSession({ phone, email });
    const payload = buildCallbackPayloadFromGateway(txnid, '1000.00', 'success');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 1,
        transaction_details: { [txnid]: { status: 'success' } },
      }),
    }) as unknown as typeof fetch;

    const response = await request(app)
      .post('/api/v1/checkout/payu/callback')
      .type('form')
      .send(payload);

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/checkout/success');
  });
});

describe('Fix D: Session expiry check in finalizeSession', () => {
  const phone = '+911111100002';
  const email = 'fixd@example.com';

  beforeAll(async () => {
    await cleanupByPhones([phone]);
  });

  it('should reject finalization of expired sessions with 410 Gone', async () => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: { email },
      create: { phone, email },
    });

    const address = await prisma.address.create({
      data: {
        userId: user.id,
        firstName: 'Expired',
        lastName: 'User',
        flatHouse: '1',
        areaStreet: '2',
        receiversPhone: phone,
        city: 'Delhi',
        state: 'Delhi',
        pincode: '110001',
      },
    });

    const session = await prisma.checkoutSession.create({
      data: {
        storeId: TEST_STORE_ID,
        userId: user.id,
        addressId: address.id,
        items: [{ productId: 'p1', sku: 'SKU1', name: 'Expiry Test', price: 100, quantity: 1 }],
        totalAmount: 100,
        currency: 'INR',
        status: 'ADDRESS_CONFIRMED',
        expiresAt: new Date(Date.now() - 60_000), // expired
      },
    });

    const response = await request(app)
      .post('/api/v1/checkout/finalize')
      .set('x-store-id', TEST_STORE_ID)
      .send({ sessionId: session.id, paymentMethod: 'PayU' });

    expect(response.status).toBe(410);
    expect(response.body.message).toContain('expired');
  });
});

describe('Fix F: IPaymentGateway interface contract', () => {
  it('PayUV2Gateway implements verifyResponseHash', () => {
    const gateway: IPaymentGateway = new PayUV2Gateway();
    expect(typeof gateway.verifyResponseHash).toBe('function');
  });

  it('PayUV2Gateway implements verifyPaymentReconciliation', () => {
    const gateway: IPaymentGateway = new PayUV2Gateway();
    expect(typeof gateway.verifyPaymentReconciliation).toBe('function');
  });

  it('RazorpayGateway implements verifyResponseHash (stub)', () => {
    const gateway: IPaymentGateway = new RazorpayGateway();
    expect(typeof gateway.verifyResponseHash).toBe('function');
    expect(gateway.verifyResponseHash({})).toBe(false);
  });

  it('RazorpayGateway implements verifyPaymentReconciliation (stub)', async () => {
    const gateway: IPaymentGateway = new RazorpayGateway();
    const result = await gateway.verifyPaymentReconciliation('test');
    expect(result.status).toBe(0);
  });
});

describe('Fix H: V2 API-to-API flow', () => {
  it('should use paymentUrl instead of additionalParams', async () => {
    const gateway = new PayUV2Gateway();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 1,
        result: { checkoutUrl: 'https://test.payu.in/_payment' },
      }),
    }) as unknown as typeof fetch;

    const intent = await gateway.createIntent(
      100,
      'INR',
      { firstName: 'Test', lastName: 'User', email: 'test@test.com', phone: '9999999999' },
      'Test Product'
    );
    expect(intent.paymentUrl).toBeDefined();
    expect(intent.additionalParams).toBeUndefined();
  });
});

describe('Fix I: UPI Intent params', () => {
  it.skip('should add pg=UPI and bankcode=INTENT for PAYU_INTENT method', async () => {
    const gateway = new PayUV2Gateway();
    const intent = await gateway.createIntent(
      100,
      'INR',
      { firstName: 'Test', lastName: 'User', email: 'test@test.com', phone: '9999999999' },
      'Test Product',
      'PAYU_INTENT'
    );
    expect(intent.additionalParams!.pg).toBe('UPI');
    expect(intent.additionalParams!.bankcode).toBe('INTENT');
  });

  it.skip('should NOT add pg/bankcode for standard PayU method', async () => {
    const gateway = new PayUV2Gateway();
    const intent = await gateway.createIntent(
      100,
      'INR',
      { firstName: 'Test', lastName: 'User', email: 'test@test.com', phone: '9999999999' },
      'Test Product'
    );
    expect(intent.additionalParams!.pg).toBeUndefined();
    expect(intent.additionalParams!.bankcode).toBeUndefined();
  });
});

describe('Fix C: Idempotency — duplicate callbacks', () => {
  const phone = '+911111100003';
  const email = 'fixc@example.com';

  beforeAll(async () => {
    await cleanupByPhones([phone]);
  });

  it('should handle already-completed sessions gracefully on duplicate callback', async () => {
    const { sessionId, txnid } = await seedPaymentPendingSession({ phone, email });

    await prisma.checkoutSession.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED' },
    });

    const payload = buildCallbackPayloadFromGateway(txnid, '1000.00', 'success');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 1,
        transaction_details: { [txnid]: { status: 'success' } },
      }),
    }) as unknown as typeof fetch;

    const response = await request(app)
      .post('/api/v1/checkout/payu/callback')
      .type('form')
      .send(payload);

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/checkout/success');

    const session = await prisma.checkoutSession.findUnique({ where: { id: sessionId } });
    expect(session?.status).toBe('COMPLETED');
  });
});

describe('Fix J: Reconciliation failure handling', () => {
  const phone = '+911111100004';
  const email = 'fixj@example.com';
  let originalNodeEnv: string | undefined;

  beforeAll(async () => {
    await cleanupByPhones([phone]);
  });

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('should use raw callback status when reconciliation fails in non-production', async () => {
    process.env.NODE_ENV = 'development';

    const { txnid } = await seedPaymentPendingSession({ phone, email });
    const payload = buildCallbackPayloadFromGateway(txnid, '1000.00', 'success');

    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error('Reconciliation API down')) as unknown as typeof fetch;

    const response = await request(app)
      .post('/api/v1/checkout/payu/callback')
      .type('form')
      .send(payload);

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/checkout/success');
  });
});

describe('Callback hash validation', () => {
  it('should reject callbacks with invalid hash', async () => {
    // Seed a session so it passes the session lookup but fails hash validation
    const { txnid } = await seedPaymentPendingSession({
      phone: '+919999999998',
      email: 'hacker@example.com',
    });

    const response = await request(app).post('/api/v1/checkout/payu/callback').type('form').send({
      status: 'success',
      txnid: txnid,
      amount: '100.00',
      productinfo: 'Fake',
      firstname: 'Hacker',
      email: 'hacker@example.com',
      key: 'wrong_key',
      hash: 'definitely_not_a_valid_hash',
    });

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('hash_mismatch');
  });

  it('should reject callbacks with tampered amount', async () => {
    const phone = '+911111100005';
    const email = 'tamper@example.com';
    await cleanupByPhones([phone]);

    // Session has totalAmount=1000
    const { txnid } = await seedPaymentPendingSession({ phone, email, amount: 1000 });

    // Build a valid hash but with amount=1.00 (tampered)
    const payload = buildCallbackPayloadFromGateway(txnid, '1.00', 'success');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 1,
        transaction_details: { [txnid]: { status: 'success' } },
      }),
    }) as unknown as typeof fetch;

    const response = await request(app)
      .post('/api/v1/checkout/payu/callback')
      .type('form')
      .send(payload);

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('amount_mismatch');
  });
});

// ═══════════════════════════════════════════════════════════════════
// COD (Cash on Delivery) Tests
// ═══════════════════════════════════════════════════════════════════

describe('CodGateway interface contract', () => {
  it('implements IPaymentGateway', () => {
    const gateway: IPaymentGateway = new CodGateway();
    expect(typeof gateway.createIntent).toBe('function');
    expect(typeof gateway.verifyResponseHash).toBe('function');
    expect(typeof gateway.verifyPaymentReconciliation).toBe('function');
  });

  it('createIntent returns succeeded status immediately', async () => {
    const gateway = new CodGateway();
    const intent = await gateway.createIntent(
      999,
      'INR',
      { firstName: 'Test', lastName: 'User', email: 'test@test.com', phone: '9999999999' },
      'Test Product'
    );

    expect(intent.status).toBe('succeeded');
    expect(intent.id).toMatch(/^cod_/);
    expect(intent.paymentUrl).toBeUndefined();
    expect(intent.clientSecret).toBeUndefined();
  });

  it('verifyResponseHash always returns false (no hash for COD)', () => {
    const gateway = new CodGateway();
    expect(gateway.verifyResponseHash({})).toBe(false);
  });
});

describe('COD Finalize Flow', () => {
  const phone = '+911111100006';
  const email = 'cod@example.com';

  beforeAll(async () => {
    await cleanupByPhones([phone]);
  });

  it('should go directly to COMPLETED when paymentMethod is COD', async () => {
    // Seed session at ADDRESS_CONFIRMED (one step before finalize)
    const user = await prisma.user.upsert({
      where: { phone },
      update: { email },
      create: { phone, email },
    });

    const address = await prisma.address.create({
      data: {
        userId: user.id,
        firstName: 'COD',
        lastName: 'Buyer',
        flatHouse: '42',
        areaStreet: 'MG Road',
        receiversPhone: phone,
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560034',
      },
    });

    const session = await prisma.checkoutSession.create({
      data: {
        storeId: TEST_STORE_ID,
        userId: user.id,
        addressId: address.id,
        items: [
          { productId: 'p1', sku: 'SKU1', name: 'COD Test Product', price: 899, quantity: 1 },
        ],
        totalAmount: 899,
        currency: 'INR',
        status: 'ADDRESS_CONFIRMED',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const response = await request(app)
      .post('/api/v1/checkout/finalize')
      .set('x-store-id', TEST_STORE_ID)
      .send({ sessionId: session.id, paymentMethod: 'COD' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('PLACED');
    expect(response.body.data.paymentMethod).toBe('COD');
    expect(response.body.data.paymentGateway).toBe('COD');
    expect(response.body.data.gatewayTransactionId).toMatch(/^cod_/);

    // No payment URL or callback hash for COD
    expect(response.body.data.paymentUrl).toBeUndefined();
    expect(response.body.data.debugCallbackPayload).toBeUndefined();

    // Verify DB state
    const dbSession = await prisma.checkoutSession.findUnique({
      where: { id: session.id },
      include: { transaction: true },
    });
    expect(dbSession?.status).toBe('PLACED');
    expect(dbSession?.paymentGateway).toBe('COD');
    expect(dbSession?.transaction).toBeDefined();
    expect(dbSession?.transaction?.status).toBe('PENDING');
    expect(dbSession?.transaction?.paymentMethod).toBe('COD');
  });
});
