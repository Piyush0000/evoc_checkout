/**
 * Structure of the Merchant Config returned by the external backend
 */
export interface MerchantConfig {
  id: string;
  name: string;
  currency: string;
  isActive: boolean;
  enabledGateways: {
    name: string;
    type: 'CARD' | 'UPI' | 'NET_BANKING' | 'COD' | 'WALLET';
    image: string; // URL to the provider logo
    description?: string;
  }[];
}

export class MerchantService {
  /**
   * Fetches merchant configuration from an external specific backend.
   *
   * TODO(production): Replace this hardcoded mock with a real API call:
   *   await axios.get(`${MERCHANT_BACKEND_URL}/stores/${storeId}`)
   * Currently only 'store_123' is defined. Any other x-store-id will throw.
   */
  static async getStoreConfig(storeId: string): Promise<MerchantConfig> {
    console.info(`[MERCHANT_SERVICE] Fetching config for Store: ${storeId}`);

    // Mocking the external API response
    // In production, this data comes from the specific merchant management service
    const mockConfigs: Record<string, MerchantConfig> = {
      store_123: {
        id: 'store_123',
        name: 'Classic Couture',
        currency: 'INR',
        isActive: true,
        enabledGateways: [
          {
            name: 'COD',
            type: 'COD',
            image: 'https://cdn-icons-png.flaticon.com/512/2331/2331941.png',
            description: 'Pay cash when your order is delivered',
          },
          {
            name: 'Razorpay',
            type: 'UPI',
            image: 'https://cdn.razorpay.com/logo.png',
            description: 'Pay via Google Pay, PhonePe, or Any UPI App',
          },
          {
            name: 'PayU',
            type: 'CARD',
            image: 'https://www.payu.in/wp-content/uploads/2021/04/payu-logo.svg',
            description: 'Credit/Debit Cards and Netbanking',
          },
        ],
      },
    };

    const config = mockConfigs[storeId];

    if (!config) {
      throw new Error(`Merchant config not found for store: ${storeId}`);
    }

    return config;
  }
}
