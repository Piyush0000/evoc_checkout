import { beforeAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';

// Mock the OTP Service to avoid hitting the real 2Factor API during checkout tests
vi.mock('../services/otp.service.js', () => {
  return {
    OtpService: {
      sanitizePhone: vi.fn().mockImplementation((phone: string) => phone),
      sendOtp: vi.fn().mockResolvedValue('mock_provider_session_id'),
      verifyOtp: vi.fn().mockResolvedValue(true),
    },
  };
});

describe('Checkout Flow Integration Test', () => {
  let sessionId: string;
  const phone = '+919999999999';
  const storeId = 'store_123'; // Matches our mock merchant config

  beforeAll(async () => {
    // Scoped cleanup
    const usersToDelete = await prisma.user.findMany({ where: { phone } });
    const userIds = usersToDelete.map((u) => u.id);
    if (userIds.length > 0) {
      await prisma.checkoutSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  it('Step 1: Should initiate a checkout session', async () => {
    const response = await request(app)
      .post('/api/v1/checkout/init')
      .set('x-store-id', storeId)
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
    const response = await request(app)
      .post('/api/v1/auth/otp/send')
      .set('x-store-id', storeId)
      .send({
        phone,
        sessionId,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('Step 3: Should verify OTP and authenticate the session', async () => {
    const response = await request(app)
      .post('/api/v1/auth/otp/verify')
      .set('x-store-id', storeId)
      .send({
        phone,
        sessionId,
        code: '123456', // Mocked to always return true
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.sessionStatus).toBe('AUTHENTICATED');
  });

  it('Step 4: Should update profile and confirm address', async () => {
    const response = await request(app)
      .post('/api/v1/user/profile')
      .set('x-store-id', storeId)
      .send({
        sessionId,
        email: 'john@example.com',
        newAddress: {
          type: 'HOME',
          firstName: 'John',
          lastName: 'Doe',
          flatHouse: '123 Tech Park',
          areaStreet: 'Main Block',
          receiversPhone: '+919999999999',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.sessionStatus).toBe('ADDRESS_CONFIRMED');
  });

  it('Step 5: Should fetch the session summary', async () => {
    const response = await request(app)
      .get(`/api/v1/checkout/summary/${sessionId}`)
      .set('x-store-id', storeId);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.totalAmount).toBe(1000);
    expect(response.body.data.user.firstName).toBe('John');
  });

  it('Step 6: Should finalize the session', async () => {
    const response = await request(app)
      .post('/api/v1/checkout/finalize')
      .set('x-store-id', storeId)
      .send({
        sessionId,
        paymentMethod: 'PayU', // Must match an enabled gateway from MerchantService
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('PAYMENT_PENDING');
  });
});
