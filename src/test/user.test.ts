import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';

describe('User Profile Integration Tests', () => {
  let sessionA: string;
  let sessionB: string;
  const phoneA = '+910000000001';
  const phoneB = '+910000000002';
  const commonEmail = 'conflict@example.com';

  beforeEach(async () => {
    // 1. Clean up potential previous test data
    await prisma.checkoutSession.deleteMany();
    await prisma.user.deleteMany();

    // 2. Setup Session A and User A
    const resA = await request(app)
      .post('/api/v1/checkout/init')
      .send({
        items: [
          { productId: 'prod_A', sku: 'P1', name: 'Product 1', price: 100, quantity: 1 },
        ],
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
      .send({
        items: [
          { productId: 'prod_B', sku: 'P2', name: 'Product 2', price: 200, quantity: 1 },
        ],
        currency: 'INR',
      });

    expect(resB.status).toBe(201);
    sessionB = resB.body.data.sessionId;

    const userB = await prisma.user.create({ data: { phone: phoneB } });
    await prisma.checkoutSession.update({
      where: { id: sessionB },
      data: { userId: userB.id, status: 'AUTHENTICATED' },
    });
  });

  it('Should successfully update profile with all fields', async () => {
    const response = await request(app).post('/api/v1/user/profile').send({
      sessionId: sessionA,
      firstName: 'User',
      lastName: 'A',
      address: '123 Main St',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      email: 'userA@example.com',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    // Verify in DB
    const user = await prisma.user.findUnique({ where: { phone: phoneA } });
    expect(user?.email).toBe('userA@example.com');
  });

  it('Should support mononymous users (no last name)', async () => {
    const response = await request(app).post('/api/v1/user/profile').send({
      sessionId: sessionA,
      firstName: 'Prince', // Just a first name
      address: '123 Main St',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('Should prevent two users from claiming the same email', async () => {
    // 1. Assign commonEmail to User A
    await request(app).post('/api/v1/user/profile').send({
      sessionId: sessionA,
      firstName: 'User',
      lastName: 'A',
      address: '123 Main St',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      email: commonEmail,
    });

    // 2. Try to assign the SAME email to User B
    const response = await request(app).post('/api/v1/user/profile').send({
      sessionId: sessionB,
      firstName: 'User',
      lastName: 'B',
      address: '456 Side St',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560002',
      email: commonEmail, // CONFLICT!
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('This email is already associated with another account');
  });
});
