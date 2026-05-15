import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';
import { PayUGateway } from '../services/payment.service.js';

const request = supertest(app);

describe('PayU Webhook Contract Test', () => {
  let sessionId: string;
  let storeId = 'test-store-123';
  let txnid: string;
  const amount = 500.0;

  beforeAll(async () => {
    // 1. Setup a dummy session in the database
    txnid = `txid_test_${Math.random().toString(36).substring(7)}`;

    const session = await prisma.checkoutSession.create({
      data: {
        storeId,
        totalAmount: amount,
        currency: 'INR',
        status: 'PAYMENT_PENDING',
        gatewayTransactionId: txnid,
        items: [{ name: 'Test Product', price: amount, quantity: 1 }],
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    sessionId = session.id;

    // Create a pending transaction record
    await prisma.transaction.create({
      data: {
        sessionId: session.id,
        storeId,
        amount,
        status: 'PENDING',
        paymentMethod: 'ONLINE',
        paymentGateway: 'PAYU',
        gatewayTransactionId: txnid,
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.transaction.deleteMany({ where: { sessionId } });
    await prisma.checkoutSession.deleteMany({ where: { id: sessionId } });
  });

  it('should successfully process a valid PayU success webhook', async () => {
    const gateway = new PayUGateway();

    // Use the helper to generate a "perfect" payload (signed with real Salt)
    const payload = gateway.getDebugCallbackPayload({
      txnid,
      amount: amount.toFixed(2),
      productinfo: 'Test Product',
      firstname: 'John',
      email: 'john@example.com',
      status: 'success',
    });

    // Act: Send POST to the callback endpoint
    const response = await request.post('/api/v1/checkout/payu/callback').send(payload);

    // Assert: Check Redirect (Browser behavior)
    expect(response.status).toBe(302);
    expect(response.header.location).toContain('/checkout/success');

    // Assert: Check Database Synchronization
    const updatedSession = await prisma.checkoutSession.findUnique({
      where: { id: sessionId },
    });
    expect(updatedSession?.status).toBe('COMPLETED');

    const updatedTxn = await prisma.transaction.findUnique({
      where: { sessionId },
    });
    expect(updatedTxn?.status).toBe('SUCCESS');
    expect(updatedTxn?.metadata).toBeDefined();
  });

  it('should reject a webhook if the hash is tampered with', async () => {
    const gateway = new PayUGateway();
    const payload = gateway.getDebugCallbackPayload({
      txnid,
      amount: amount.toFixed(2),
      productinfo: 'Test Product',
      firstname: 'John',
      email: 'john@example.com',
      status: 'success',
    });

    // Tamper with the hash
    payload.hash = 'wrong_hash';

    const response = await request.post('/api/v1/checkout/payu/callback').send(payload);

    // Assert: Redirect to failure page
    expect(response.status).toBe(302);
    expect(response.header.location).toContain('reason=hash_mismatch');

    // Assert: Database status should NOT change (stays COMPLETED from previous test)
    const session = await prisma.checkoutSession.findUnique({
      where: { id: sessionId },
    });
    expect(session?.status).toBe('COMPLETED');
  });

  it('should prevent amount tampering (paying less than required)', async () => {
    // Create a new session for this specific test
    const newTxnId = `txid_hack_${Math.random().toString(36).substring(7)}`;
    const session = await prisma.checkoutSession.create({
      data: {
        storeId,
        totalAmount: 1000.0, // Expected 1000
        currency: 'INR',
        status: 'PAYMENT_PENDING',
        gatewayTransactionId: newTxnId,
        items: [{ name: 'Expensive Item', price: 1000, quantity: 1 }],
        expiresAt: new Date(Date.now() + 3600000),
      },
    });

    const gateway = new PayUGateway();
    // Hacker tries to send a "success" payload but with only ₹1 paid
    const payload = gateway.getDebugCallbackPayload({
      txnid: newTxnId,
      amount: '1.00', // Paid only 1
      productinfo: 'Expensive Item',
      firstname: 'Hacker',
      email: 'hacker@example.com',
      status: 'success',
    });

    const response = await request.post('/api/v1/checkout/payu/callback').send(payload);

    expect(response.status).toBe(302);
    expect(response.header.location).toContain('reason=amount_mismatch');

    const updatedSession = await prisma.checkoutSession.findUnique({
      where: { id: session.id },
    });
    expect(updatedSession?.status).toBe('FAILED'); // Marked as failed due to tampering
  });
});
