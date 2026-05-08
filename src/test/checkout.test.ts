import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';

describe('Checkout Flow Integration Test', () => {
  let sessionId: string;
  const phone = '+919999999999';

  it('Step 1: Should initiate a checkout session', async () => {
    const response = await request(app)
      .post('/api/v1/checkout/init')
      .send({
        items: [
          {
            productId: 'prod_123',
            sku: 'TEST-123',
            name: 'Test Product',
            price: 1000,
            quantity: 1,
          },
        ],
        currency: 'INR',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.sessionId).toBeDefined();
    sessionId = response.body.data.sessionId;
  });

  it('Step 2: Should send an OTP', async () => {
    const response = await request(app).post('/api/v1/auth/otp/send').send({
      phone,
      sessionId,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('Step 3: Should verify OTP and authenticate the session', async () => {
    // Fetch the OTP from the database (since we log it to console in dev)
    const otpRecord = await prisma.otpVerification.findFirst({
      where: { phone, sessionId },
      orderBy: { createdAt: 'desc' },
    });

    expect(otpRecord).toBeDefined();

    const response = await request(app).post('/api/v1/auth/otp/verify').send({
      phone,
      sessionId,
      code: otpRecord?.code,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.sessionStatus).toBe('AUTHENTICATED');
  });

  it('Step 4: Should update profile and confirm address', async () => {
    const response = await request(app).post('/api/v1/user/profile').send({
      sessionId,
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      address: '123 Tech Park',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.sessionStatus).toBe('ADDRESS_CONFIRMED');
  });

  it('Step 5: Should fetch the session summary', async () => {
    const response = await request(app).get(`/api/v1/checkout/summary/${sessionId}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.totalAmount).toBe(1000);
    expect(response.body.data.user.firstName).toBe('John');
  });

  it('Step 6: Should finalize the session', async () => {
    const response = await request(app).post('/api/v1/checkout/finalize').send({
      sessionId,
      paymentMethod: 'UPI',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe('PAYMENT_PENDING');
  });
});
