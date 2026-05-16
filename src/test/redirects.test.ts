import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';
import { PaymentService, type IPaymentGateway } from '../services/payment.service.js';

describe('Dynamic Redirect URLs', () => {
  const storeId = 'store_123';
  const successUrl = 'https://merchant.com/success';
  const cancelUrl = 'https://merchant.com/cancel';

  beforeAll(async () => {
    // No specific cleanup needed for this isolated test
  });

  it('should store successUrl and cancelUrl during session init', async () => {
    const response = await request(app)
      .post('/api/v1/checkout/init')
      .set('x-store-id', storeId)
      .send({
        items: [{ productId: 'p1', sku: 's1', name: 'n1', price: 100, quantity: 1 }],
        currency: 'INR',
        successUrl,
        cancelUrl,
      });

    expect(response.status).toBe(201);
    const sessionId = response.body.data.sessionId;

    const session = await prisma.checkoutSession.findUnique({
      where: { id: sessionId },
    });

    expect(session?.successUrl).toBe(successUrl);
    expect(session?.cancelUrl).toBe(cancelUrl);
  });

  it('should redirect to custom successUrl on successful payment callback', async () => {
    // 1. Mock Gateway
    const mockGateway = {
      verifyResponseHash: vi.fn().mockReturnValue(true),
      verifyPaymentReconciliation: vi.fn().mockResolvedValue({
        status: 1,
        transaction_details: {
          mock_txnid: { status: 'success' },
        },
      }),
      createIntent: vi.fn(),
    };
    vi.spyOn(PaymentService, 'getGateway').mockReturnValue(
      mockGateway as unknown as IPaymentGateway
    );

    // 2. Create session with custom URLs
    const initRes = await request(app)
      .post('/api/v1/checkout/init')
      .set('x-store-id', storeId)
      .send({
        items: [{ productId: 'p1', sku: 's1', name: 'n1', price: 100, quantity: 1 }],
        currency: 'INR',
        successUrl,
        cancelUrl,
      });

    const sessionId = initRes.body.data.sessionId;
    const txnid = `txn_${Date.now()}`;
    mockGateway.verifyPaymentReconciliation.mockResolvedValue({
      status: 1,
      transaction_details: {
        [txnid]: { status: 'success' },
      },
    });

    // 3. Finalize to set txnid and gateway + Create Transaction record
    await prisma.checkoutSession.update({
      where: { id: sessionId },
      data: {
        gatewayTransactionId: txnid,
        paymentGateway: 'PAYU',
        status: 'PENDING_AUTH',
      },
    });

    const session = await prisma.checkoutSession.findUnique({ where: { id: sessionId } });
    await prisma.transaction.create({
      data: {
        sessionId: session!.id,
        storeId: session!.storeId,
        amount: session!.totalAmount,
        currency: session!.currency,
        status: 'PENDING',
        paymentMethod: 'ONLINE',
        paymentGateway: 'PAYU',
        gatewayTransactionId: txnid,
      },
    });

    // 4. Simulate PayU callback
    const response = await request(app).post('/api/v1/checkout/payu/callback').send({
      txnid,
      status: 'success',
      amount: '100.00',
      hash: 'mock_hash',
    });

    expect(response.status).toBe(302);
    expect(response.header.location).toContain(successUrl);
    expect(response.header.location).toContain(`sessionId=${sessionId}`);
  });

  it('should redirect to custom cancelUrl on cancelled payment callback', async () => {
    const mockGateway = {
      verifyResponseHash: vi.fn().mockReturnValue(true),
      verifyPaymentReconciliation: vi.fn().mockResolvedValue({
        status: 1,
        transaction_details: {},
      }),
      createIntent: vi.fn(),
    };
    vi.spyOn(PaymentService, 'getGateway').mockReturnValue(
      mockGateway as unknown as IPaymentGateway
    );

    const initRes = await request(app)
      .post('/api/v1/checkout/init')
      .set('x-store-id', storeId)
      .send({
        items: [{ productId: 'p1', sku: 's1', name: 'n1', price: 100, quantity: 1 }],
        currency: 'INR',
        successUrl,
        cancelUrl,
      });

    const sessionId = initRes.body.data.sessionId;
    const txnid = `txn_cancel_${Date.now()}`;
    mockGateway.verifyPaymentReconciliation.mockResolvedValue({
      status: 1,
      transaction_details: {
        [txnid]: { status: 'cancel' },
      },
    });

    await prisma.checkoutSession.update({
      where: { id: sessionId },
      data: {
        gatewayTransactionId: txnid,
        paymentGateway: 'PAYU',
        status: 'PENDING_AUTH',
      },
    });

    const sessionCancel = await prisma.checkoutSession.findUnique({ where: { id: sessionId } });
    await prisma.transaction.create({
      data: {
        sessionId: sessionCancel!.id,
        storeId: sessionCancel!.storeId,
        amount: sessionCancel!.totalAmount,
        currency: sessionCancel!.currency,
        status: 'PENDING',
        paymentMethod: 'ONLINE',
        paymentGateway: 'PAYU',
        gatewayTransactionId: txnid,
      },
    });

    const response = await request(app).post('/api/v1/checkout/payu/callback').send({
      txnid,
      status: 'cancelled',
      amount: '100.00',
      hash: 'mock_hash',
    });

    expect(response.status).toBe(302);
    expect(response.header.location).toContain(cancelUrl);
    expect(response.header.location).toContain(`sessionId=${sessionId}`);
  });
});
