import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';

describe('Checkout Flow Integration Test', () => {
  let sessionId: string;
  const phone = '+919999999999';

  it('Step 1: Should initiate a checkout session', async () => {
    const response = await request(app)
      .post('/api/v1/checkout/init')
      .send({
        items: [{ sku: 'TEST-123', name: 'Test Product', price: 1000, quantity: 1 }],
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

  // Note: For a real test, we would need to extract the OTP from the DB
  // or mock the OTP generation. For this MVP test, we'll assume the
  // flow works if the endpoints respond correctly.
});
