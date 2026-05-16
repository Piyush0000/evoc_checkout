import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';

// Mock OTP service
vi.mock('../services/otp.service.js', () => ({
  OtpService: {
    sanitizePhone: vi.fn().mockImplementation((phone: string) => phone),
    sendOtp: vi.fn().mockResolvedValue('mock_provider_session_id'),
    verifyOtp: vi.fn().mockResolvedValue(true),
  },
}));

describe('Security and Defensive Edge Case Tests', () => {
  const storeA = 'store_123';
  const storeB = 'store_invalid';
  const phoneA = '+917777777777';
  const phoneB = '+918888888888';

  let sessionA: string;
  let userAId: string;
  let addressAId: string;

  beforeAll(async () => {
    // Cleanup
    await prisma.transaction.deleteMany({});
    await prisma.checkoutSession.deleteMany({});
    await prisma.address.deleteMany({});
    await prisma.user.deleteMany({});

    // Setup a valid authenticated session for User A in Store A
    const resInit = await request(app)
      .post('/api/v1/checkout/init')
      .set('x-store-id', storeA)
      .send({
        items: [{ productId: 'p1', sku: 'S1', name: 'Product', price: 100, quantity: 1 }],
        currency: 'INR',
      });
    sessionA = resInit.body.data.sessionId;

    const userA = await prisma.user.create({ data: { phone: phoneA, email: 'userA@example.com' } });
    userAId = userA.id;

    const addressA = await prisma.address.create({
      data: {
        userId: userAId,
        firstName: 'John',
        lastName: 'Doe',
        flatHouse: '123',
        areaStreet: 'Main',
        receiversPhone: phoneA,
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
    });
    addressAId = addressA.id;

    await prisma.checkoutSession.update({
      where: { id: sessionA },
      data: { userId: userAId, status: 'AUTHENTICATED' },
    });
  });

  describe('Tenant Isolation (Store ID)', () => {
    it('Should reject access to a session from a different store ID', async () => {
      const response = await request(app)
        .get(`/api/v1/checkout/summary/${sessionA}`)
        .set('x-store-id', storeB); // Wrong store

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Unauthorized');
    });

    it('Should reject profile update with wrong store ID', async () => {
      const response = await request(app)
        .post('/api/v1/user/profile')
        .set('x-store-id', storeB)
        .send({
          sessionId: sessionA,
          email: 'userA@example.com',
          addressId: addressAId,
        });

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Unauthorized');
    });
  });

  describe('State Machine Transitions', () => {
    it('Should reject finalizeSession if status is not ADDRESS_CONFIRMED', async () => {
      // Current status is AUTHENTICATED (from beforeAll)
      const response = await request(app)
        .post('/api/v1/checkout/finalize')
        .set('x-store-id', storeA)
        .send({
          sessionId: sessionA,
          paymentMethod: 'PayU',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Shipping address must be confirmed');
    });
  });

  describe('Cross-User Data Protection', () => {
    it('Should reject using an addressId belonging to another user', async () => {
      // 1. Create User B and their session
      const resInitB = await request(app)
        .post('/api/v1/checkout/init')
        .set('x-store-id', storeA)
        .send({
          items: [{ productId: 'p1', sku: 'S1', name: 'Product', price: 100, quantity: 1 }],
          currency: 'INR',
        });
      const sessionB = resInitB.body.data.sessionId;

      const userB = await prisma.user.create({
        data: { phone: phoneB, email: 'userB@example.com' },
      });

      await prisma.checkoutSession.update({
        where: { id: sessionB },
        data: { userId: userB.id, status: 'AUTHENTICATED' },
      });

      // 2. Try to update User B's session with User A's addressId
      const response = await request(app)
        .post('/api/v1/user/profile')
        .set('x-store-id', storeA)
        .send({
          sessionId: sessionB,
          email: 'userB@example.com',
          addressId: addressAId, // Belongs to User A
        });

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Invalid address selection');
    });
  });
});
