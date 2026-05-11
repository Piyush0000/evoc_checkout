import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';

describe('User Profile Integration Tests', () => {
  let sessionA: string;
  const storeId = 'store_123'; // Mock store ID
  const phoneA = '+910000000001';
  const phoneB = '+910000000002';

  beforeEach(async () => {
    // Scoped cleanup to prevent race conditions and foreign key violations
    const emailsToDelete = ['userA@example.com', 'prince@example.com'];
    const usersToDelete = await prisma.user.findMany({
      where: {
        OR: [{ phone: { in: [phoneA, phoneB] } }, { email: { in: emailsToDelete } }],
      },
    });
    const userIds = usersToDelete.map((u) => u.id);
    if (userIds.length > 0) {
      await prisma.checkoutSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    // 2. Setup Session A and User A
    const resA = await request(app)
      .post('/api/v1/checkout/init')
      .set('x-store-id', storeId)
      .send({
        items: [{ productId: 'prod_A', sku: 'P1', name: 'Product 1', price: 100, quantity: 1 }],
        currency: 'INR',
      });

    expect(resA.status).toBe(201);
    sessionA = resA.body.data.sessionId;

    const userA = await prisma.user.create({ data: { phone: phoneA } });
    await prisma.checkoutSession.update({
      where: { id: sessionA },
      data: { userId: userA.id, status: 'AUTHENTICATED' },
    });

    // 3. Setup Session B and User B
    const resB = await request(app)
      .post('/api/v1/checkout/init')
      .set('x-store-id', storeId)
      .send({
        items: [{ productId: 'prod_B', sku: 'P2', name: 'Product 2', price: 200, quantity: 1 }],
        currency: 'INR',
      });

    expect(resB.status).toBe(201);

    const userB = await prisma.user.create({ data: { phone: phoneB } });
    await prisma.checkoutSession.update({
      where: { id: resB.body.data.sessionId },
      data: { userId: userB.id, status: 'AUTHENTICATED' },
    });
  });

  it('Should successfully update profile and create new address', async () => {
    const response = await request(app)
      .post('/api/v1/user/profile')
      .set('x-store-id', storeId)
      .send({
        sessionId: sessionA,
        email: 'userA@example.com',
        newAddress: {
          type: 'HOME',
          firstName: 'User',
          lastName: 'A',
          flatHouse: 'Flat 101, Building B',
          areaStreet: 'Main Street, Area 51',
          receiversPhone: '+919999999999',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    // Verify in DB
    const user = await prisma.user.findUnique({
      where: { phone: phoneA },
      include: { addresses: true },
    });
    expect(user?.email).toBe('userA@example.com');
    expect(user?.addresses?.length).toBe(1);
    expect(user?.addresses?.[0]?.city).toBe('Bengaluru');
    expect(user?.addresses?.[0]?.receiversPhone).toBe('+919999999999');
  });

  it('Should successfully use an existing address ID', async () => {
    // First, create an address
    const firstRes = await request(app)
      .post('/api/v1/user/profile')
      .set('x-store-id', storeId)
      .send({
        sessionId: sessionA,
        email: 'prince@example.com',
        newAddress: {
          type: 'HOME',
          firstName: 'Prince',
          lastName: 'Kumar',
          flatHouse: 'House 1',
          areaStreet: 'Street 2',
          receiversPhone: '+918888888888',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
        },
      });

    expect(firstRes.status).toBe(200);

    const userWithAddr = await prisma.user.findUnique({
      where: { phone: phoneA },
      include: { addresses: true },
    });
    const addressId = userWithAddr?.addresses?.[0]?.id;

    // Now, use the existing address ID
    const secondRes = await request(app)
      .post('/api/v1/user/profile')
      .set('x-store-id', storeId)
      .send({
        sessionId: sessionA,
        email: 'prince@example.com',
        addressId: addressId,
      });

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.success).toBe(true);
  });
});
