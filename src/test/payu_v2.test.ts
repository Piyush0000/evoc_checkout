import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PayUV2Gateway } from '../services/payment.service.js';

describe('PayUV2Gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate correct auth header and call createIntent', async () => {
    const gateway = new PayUV2Gateway();

    const mockResponse = {
      status: 1,
      message: 'Success',
      result: {
        checkoutUrl: 'https://test.payu.in/checkout_url',
      },
    };

    // Use a simpler mock for fetch that works with vitest
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as unknown as Response);

    const customer = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: '9876543210',
      address: {
        line1: '123 Main St',
        city: 'Mumbai',
        state: 'MH',
        zipCode: '400001',
        country: 'India',
      },
    };

    const intent = await gateway.createIntent(100, 'INR', customer, 'Test Product');

    expect(intent.paymentUrl).toBe('https://test.payu.in/checkout_url');
    expect(fetchSpy).toHaveBeenCalled();

    const callArgs = fetchSpy.mock.calls[0]!;
    const url = callArgs[0] as string;
    const options = callArgs[1] as RequestInit;

    expect(url).toContain('/v2/payments');
    expect(options?.headers).toHaveProperty('authorization');
    expect(options?.headers).toHaveProperty('date');
    expect(options?.headers?.['Content-Type' as keyof typeof options.headers]).toBe(
      'application/json'
    );
  });

  it('should verify payment using v3 transaction API', async () => {
    const gateway = new PayUV2Gateway();

    const mockResponse = {
      status: 1,
      result: [
        {
          txnId: 'txid_v2_123',
          status: 'success',
        },
      ],
    };

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as unknown as Response);

    const reconciliation = await gateway.verifyPaymentReconciliation('txid_v2_123');
    expect(reconciliation.status).toBe(1);
    expect(reconciliation.transaction_details?.['txid_v2_123']?.status).toBe('success');
  });

  it('should handle API errors gracefully', async () => {
    const gateway = new PayUV2Gateway();

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 0, message: 'Invalid Transaction ID' }),
    } as unknown as Response);

    const reconciliation = await gateway.verifyPaymentReconciliation('invalid_id');
    expect(reconciliation.status).toBe(0);
    expect(reconciliation.msg).toBe('Invalid Transaction ID');
  });
});
