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
  // In production, this comes from your .env file
  private static readonly API_KEY = process.env.TWO_FACTOR_API_KEY || 'your_2factor_api_key';
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
   * @param phone The user's phone number (must include country code, e.g., +91)
   * @returns The provider session ID (Details) to be used for verification later.
   */
  static async sendOtp(phone: string): Promise<string> {
    const formattedPhone = this.sanitizePhone(phone);
    try {
      // Endpoint: /API/V1/:api_key/SMS/:phone_number/AUTOGEN3/OTP1
      const url = `${this.BASE_URL}/${this.API_KEY}/SMS/${formattedPhone}/AUTOGEN3/OTP1`;

      const response = await fetch(url, { method: 'GET' });
      const data = (await response.json()) as TwoFactorResponse;

      if (data.Status === 'Success') {
        console.info(
          `[2FACTOR] OTP sent successfully to ${formattedPhone}. Session ID: ${data.Details}`
        );
        return data.Details; // This is the 2Factor "session_id" we need for verification
      } else {
        console.error(`[2FACTOR] API Error: ${data.Details}`);
        throw new Error(`OTP Provider Error: ${data.Details}`);
      }
    } catch (error) {
      console.error('[2FACTOR] Network/Parse Error:', error);
      throw new Error('Failed to communicate with OTP provider');
    }
  }

  /**
   * Verifies the OTP entered by the user using the 2Factor API (Phone Number Method).
   * @param phone The user's phone number.
   * @param otpEnteredByUser The code entered by the user.
   */
  static async verifyOtp(phone: string, otpEnteredByUser: string): Promise<boolean> {
    const formattedPhone = this.sanitizePhone(phone);
    try {
      // Endpoint: /API/V1/:api_key/SMS/VERIFY3/:phone_number/:otp_entered_by_user
      const url = `${this.BASE_URL}/${this.API_KEY}/SMS/VERIFY3/${formattedPhone}/${otpEnteredByUser}`;

      const response = await fetch(url, { method: 'GET' });
      const data = (await response.json()) as TwoFactorResponse;

      if (data.Status === 'Success' || data.Details === 'OTP Matched') {
        console.info(`[2FACTOR] OTP Verified successfully for phone: ${formattedPhone}`);
        return true;
      } else {
        console.warn(`[2FACTOR] Verification Failed for phone ${formattedPhone}: ${data.Details}`);
        return false;
      }
    } catch (error) {
      console.error('[2FACTOR] Verification Network/Parse Error:', error);
      throw new Error('Failed to verify OTP with provider');
    }
  }
}
