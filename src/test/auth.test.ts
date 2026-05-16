import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';

// Mock the OTP Service to avoid hitting the real 2Factor API during tests
vi.mock('../services/otp.service.js', () => {
  return {
    OtpService: {
      sanitizePhone: vi.fn().mockImplementation((phone: string) => phone),
      sendOtp: vi.fn().mockResolvedValue('mock_provider_session_id'),
      verifyOtp: vi.fn().mockImplementation(async (_phone: string, code: string) => {
        return code === '123456'; // Only '123456' works in our tests
      }),
    },
  };
});

describe('OTP Authentication Integration Tests', () => {
  let sessionId: string;
  const storeId = 'store_123'; // Mock store from MerchantService
  const phone = '+919876543210';
  beforeEach(async () => {
    // Scoped cleanup to prevent race conditions with other test files
    await prisma.otpVerification.deleteMany({ where: { phone } });
    const usersToDelete = await prisma.user.findMany({ where: { phone } });
    const userIds = usersToDelete.map((u) => u.id);
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
    // 1. Initialize a session
    const resInit = await request(app)
      .post('/api/v1/checkout/init')
      .set('x-store-id', storeId)
      .send({
        items: [{ productId: 'prod_1', sku: 'P1', name: 'Test Product', price: 100, quantity: 1 }],
        currency: 'INR',
      });

    sessionId = resInit.body.data.sessionId;
  });

  it('Should successfully send an OTP', async () => {
    const response = await request(app)
      .post('/api/v1/auth/otp/send')
      .set('x-store-id', storeId)
      .send({
        phone,
        sessionId,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    // Verify it was saved in the DB
    const otpRecord = await prisma.otpVerification.findFirst({ where: { phone } });
    expect(otpRecord).toBeDefined();
    expect(otpRecord?.providerSessionId).toBe('mock_provider_session_id'); // From our mock
  });

  it('Should verify correct OTP and authenticate user', async () => {
    // 1. Send OTP
    await request(app).post('/api/v1/auth/otp/send').set('x-store-id', storeId).send({
      phone,
      sessionId,
    });

    // 2. Verify OTP (using the mocked '123456' valid code)
    const verifyResponse = await request(app)
      .post('/api/v1/auth/otp/verify')
      .set('x-store-id', storeId)
      .send({
        phone,
        sessionId,
        code: '123456',
      });

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body.success).toBe(true);
    expect(verifyResponse.body.sessionStatus).toBe('AUTHENTICATED');

    // Verify user was created
    const user = await prisma.user.findUnique({ where: { phone } });
    expect(user).toBeDefined();

    // Verify the OTP record was deleted after successful use
    const otpRecord = await prisma.otpVerification.findFirst({ where: { phone } });
    expect(otpRecord).toBeNull();
  });

  it('Should reject incorrect OTP', async () => {
    await request(app).post('/api/v1/auth/otp/send').set('x-store-id', storeId).send({
      phone,
      sessionId,
    });

    const verifyResponse = await request(app)
      .post('/api/v1/auth/otp/verify')
      .set('x-store-id', storeId)
      .send({
        phone,
        sessionId,
        code: '999999', // Incorrect code based on our mock
      });

    expect(verifyResponse.status).toBe(400);
    expect(verifyResponse.body.success).toBe(false);
    expect(verifyResponse.body.message).toBe('Invalid or expired OTP');
  });
});
