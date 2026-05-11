import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../app.js';

describe('Input Validation Tests', () => {
  const storeId = 'store_123';

  describe('Checkout Initiation (POST /api/v1/checkout/init)', () => {
    it('Should reject empty items list', async () => {
      const response = await request(app)
        .post('/api/v1/checkout/init')
        .set('x-store-id', storeId)
        .send({
          items: [],
          currency: 'INR',
        });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].message).toBe('At least one item is required');
    });

    it('Should reject negative item price', async () => {
      const response = await request(app)
        .post('/api/v1/checkout/init')
        .set('x-store-id', storeId)
        .send({
          items: [{ productId: 'p1', sku: 'S1', name: 'P', price: -100, quantity: 1 }],
          currency: 'INR',
        });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].message).toContain('Too small');
    });

    it('Should reject zero quantity', async () => {
      const response = await request(app)
        .post('/api/v1/checkout/init')
        .set('x-store-id', storeId)
        .send({
          items: [{ productId: 'p1', sku: 'S1', name: 'P', price: 100, quantity: 0 }],
          currency: 'INR',
        });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].message).toContain('Too small');
    });

    it('Should reject unsupported currency', async () => {
      const response = await request(app)
        .post('/api/v1/checkout/init')
        .set('x-store-id', storeId)
        .send({
          items: [{ productId: 'p1', sku: 'S1', name: 'P', price: 100, quantity: 1 }],
          currency: 'EUR', // Only INR and USD are allowed
        });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].message).toContain('Invalid option');
    });
  });

  describe('User Profile Validation (POST /api/v1/user/profile)', () => {
    it('Should reject invalid email format', async () => {
      const response = await request(app)
        .post('/api/v1/user/profile')
        .set('x-store-id', storeId)
        .send({
          sessionId: '00000000-0000-0000-0000-000000000000', // Valid UUID but won't exist
          email: 'not-an-email',
          addressId: '00000000-0000-0000-0000-000000000000',
        });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].message).toBe('Invalid email address');
    });

    it('Should reject malformed pincode', async () => {
      const response = await request(app)
        .post('/api/v1/user/profile')
        .set('x-store-id', storeId)
        .send({
          sessionId: '00000000-0000-0000-0000-000000000000',
          email: 'test@example.com',
          newAddress: {
            type: 'HOME',
            firstName: 'A',
            lastName: 'B',
            flatHouse: '1',
            areaStreet: '2',
            receiversPhone: '9999999999',
            city: 'C',
            state: 'S',
            pincode: '12345', // Must be 6 digits
          },
        });

      expect(response.status).toBe(400);
      expect(
        response.body.errors.some(
          (e: { message: string }) => e.message === 'Pincode must be 6 digits'
        )
      ).toBe(true);
    });
  });
});
