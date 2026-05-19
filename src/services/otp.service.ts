/**
 * Response shape from 2Factor API
 */
interface TwoFactorResponse {
  Status: 'Success' | 'Error';
  Details: string;
}

/**
 * Service to handle OTP generation and verification via 2Factor API.
 */
export class OtpService {
  private static get apiKey(): string {
    return process.env.TWO_FACTOR_API_KEY || 'your_2factor_api_key';
  }

  private static get mode(): 'AUTO' | 'REAL' | 'MOCK' {
    return (process.env.OTP_MODE?.toUpperCase() as any) || 'AUTO';
  }

  private static get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  /**
   * Determines if mock fallback is allowed.
   * ONLY allowed in non-production environments (development/test).
   */
  private static get allowMockFallback(): boolean {
    // REAL mode never allows mock
    if (this.mode === 'REAL') return false;
    // MOCK mode always uses mock (for testing)
    if (this.mode === 'MOCK') return true;
    // AUTO mode: only fallback to mock in non-production
    return !this.isProduction;
  }

  private static readonly BASE_URL = 'https://2factor.in/API/V1';

  /**
   * Sanitizes phone number to ensure a consistent fully-qualified format.
   * Handles 10-digit Indian numbers by adding +91 prefix.
   */
  public static sanitizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `+91${digits}`;
    }
    if (digits.length === 12 && digits.startsWith('91')) {
      return `+${digits}`;
    }
    return phone.startsWith('+') ? phone : `+${phone}`;
  }

  /**
   * Sends an auto-generated OTP via 2Factor.
   * @param phone The user's phone number
   * @returns Metadata including provider session ID and whether it's a mock.
   */
  static async sendOtp(phone: string): Promise<{ providerSessionId: string; isMock: boolean }> {
    const formattedPhone = this.sanitizePhone(phone);
    const mode = this.mode;

    // Use real OTP if API key is present AND mode is not explicitly MOCK
    const hasApiKey =
      this.apiKey && this.apiKey !== 'your_2factor_api_key' && this.apiKey !== '';

    const shouldAttemptReal = mode !== 'MOCK' && hasApiKey;

    if (!shouldAttemptReal) {
      console.info(
        `[OTP_MOCK] Mode=${mode}. Sending mock OTP to ${formattedPhone}. (Use 6666 for verification)`
      );
      return {
        providerSessionId: `mock_session_${Math.random().toString(36).substring(7)}`,
        isMock: true,
      };
    }

    console.info(
      `[2FACTOR] Mode=${mode}. Sending real OTP to ${formattedPhone} using API Key: ${this.apiKey.substring(
        0,
        5
      )}...`
    );

    try {
      const encodedPhone = encodeURIComponent(formattedPhone);
      const url = `${this.BASE_URL}/${this.apiKey}/SMS/${encodedPhone}/AUTOGEN3/OTP1`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });
      const data = (await response.json()) as TwoFactorResponse;

      if (data.Status === 'Success') {
        console.info(
          `[2FACTOR] OTP sent successfully to ${formattedPhone}. Session ID: ${data.Details}`
        );
        return { providerSessionId: data.Details, isMock: false };
      } else {
        throw new Error(`OTP Provider Error: ${data.Details}`);
      }
    } catch (error: any) {
      console.error('[2FACTOR] Send Error:', error.message || error);

      // Only fall back to mock if allowed AND mode is AUTO
      if (this.allowMockFallback && mode === 'AUTO') {
        console.warn(
          `[DEMO_SAFETY] Real OTP failed in AUTO mode (non-prod). Falling back to Mock for ${formattedPhone}.`
        );
        return {
          providerSessionId: `mock_fallback_${Math.random().toString(36).substring(7)}`,
          isMock: true,
        };
      }

      // In production or REAL mode, we let the error propagate — no bypass
      throw new Error(`Failed to send real OTP: ${error.message}`);
    }
  }

  /**
   * Verifies the OTP entered by the user using the 2Factor API.
   */
  static async verifyOtp(phone: string, otpEnteredByUser: string): Promise<boolean> {
    const formattedPhone = this.sanitizePhone(phone);
    const mode = this.mode;

    // EMERGENCY DEMO BYPASS: Allow 6666 ONLY in non-production with AUTO/MOCK mode
    if (otpEnteredByUser === '6666' && this.allowMockFallback) {
      console.warn(
        `[DEMO_BYPASS] Mode=${mode} (non-prod). Emergency code used for ${formattedPhone}. SUCCESS.`
      );
      return true;
    }

    const hasApiKey =
      this.apiKey && this.apiKey !== 'your_2factor_api_key' && this.apiKey !== '';

    if (mode === 'MOCK') {
      return otpEnteredByUser === '6666';
    }

    // No API key in AUTO mode — only allow 6666 in non-production
    if (!hasApiKey && mode === 'AUTO' && !this.isProduction) {
      return otpEnteredByUser === '6666';
    }

    try {
      const encodedPhone = encodeURIComponent(formattedPhone);
      const encodedOtp = encodeURIComponent(otpEnteredByUser);
      const url = `${this.BASE_URL}/${this.apiKey}/SMS/VERIFY3/${encodedPhone}/${encodedOtp}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });
      const data = (await response.json()) as TwoFactorResponse;

      return data.Status === 'Success' || data.Details === 'OTP Matched';
    } catch (error: any) {
      console.error('[2FACTOR] Verification Error:', error.message || error);
      throw new Error('Failed to verify OTP with provider');
    }
  }
}
