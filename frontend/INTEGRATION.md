# Payment Gateway SDK Integration Guide

This document describes how to integrate the Evoc Labs Payment Orchestrator SDK into a merchant's e-commerce website.

---

## Overview

The Payment Gateway SDK provides a seamless, full-page redirect checkout flow for payment processing. When a customer selects a payment method, the SDK redirects them to the payment gateway (PayU, Razorpay, COD) in the same browser window. After payment completion, the gateway redirects back to your application with the payment result.

### Key Features
- Full-page redirect (no popups) for better user experience
- Cross-tab payment status synchronization
- Session management with automatic expiry handling
- Support for multiple payment gateways (PayU, Razorpay, COD)
- Responsive, mobile-first design

---

## Integration Steps

### 1. Include the SDK Files

Add the SDK CSS and JavaScript files to your HTML page:

```html
<!-- Styles -->
<link rel="stylesheet" href="path/to/style.css">

<!-- Google Fonts (required) -->
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">

<!-- SDK JavaScript -->
<script src="path/to/app.js"></script>
```

### 2. Add the Checkout Container

Add the checkout container div to your page where you want the checkout flow to appear:

```html
<div class="checkout-wrapper">
  <div class="checkout-panel centered">
    <!-- Header -->
    <header class="checkout-header">
      <div class="header-action-placeholder"></div>
      <div class="brand-logo-container">
        <img src="path/to/merchant-logo.png" alt="Merchant" class="brand-logo">
      </div>
      <div class="header-action-placeholder"></div>
    </header>

    <!-- Checkout Content (this will be populated by SDK) -->
    <div class="checkout-content">
      <!-- SDK renders workflow cards here -->
    </div>

    <!-- Footer -->
    <footer class="checkout-footer">
      <div class="footer-links">
        <a href="#">T&C</a>
        <span>|</span>
        <a href="#">Privacy Policy</a>
        <span>|</span>
        <span class="session-id-text" id="footerSessionId">Session: Pending</span>
      </div>
    </footer>
  </div>
</div>
```

### 3. Configure the SDK (Optional)

You can customize the SDK behavior by setting `window.EVOC_CONFIG`:

```html
<script>
  window.EVOC_CONFIG = {
    apiBaseUrl: 'https://your-backend.com/api/v1'  // Custom API base URL
  };
</script>
<script src="path/to/app.js"></script>
```

### 4. Backend Requirements

Your backend must implement the following API endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/checkout/init` | POST | Initialize a checkout session |
| `/checkout/summary/{sessionId}` | GET | Get current session state |
| `/checkout/finalize` | POST | Create payment intent |
| `/auth/otp/send` | POST | Send OTP for authentication |
| `/auth/otp/verify` | POST | Verify OTP code |
| `/user/profile` | POST | Save user profile and address |
| `/checkout/payu/callback` | POST | PayU payment callback |

#### Required Headers
- `x-store-id`: Your merchant/store identifier

#### Response Format
All API responses should follow this format:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": { ... }
}
```

### 5. Configure Payment Gateway Callbacks

For PayU, configure the following URLs in your PayU merchant dashboard:

- **Success URL (curl)**: `https://your-domain.com/index.html?sessionId={sessionId}&txnId={txnId}&paymentMethod=PAYU_V2`
- **Failure URL (furl)**: `https://your-domain.com/index.html?sessionId={sessionId}&status=failure`

The SDK automatically appends these callback URLs when redirecting to PayU.

---

## Configuration Options

### Environment Variables (Backend)

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname

# Server
PORT=3000
NODE_ENV=development

# Frontend URL (for callback redirects)
FRONTEND_URL=http://localhost:5173

# PayU Configuration
PAYU_KEY=your_payu_key
PAYU_SALT=your_payu_salt
PAYU_CALLBACK_URL=https://your-domain.com/api/v1/checkout/payu/callback

# OTP Service (2Factor.in)
TWO_FACTOR_API_KEY=your_2fa_api_key

# COD Limits
MAX_COD_AMOUNT=15000
```

### Client-Side Configuration

```javascript
window.EVOC_CONFIG = {
  apiBaseUrl: '/api/v1',        // Default: relative path
  // Add custom configurations as needed
};
```

---

## Payment Flow

1. **Session Init**: Customer clicks checkout → SDK calls `/checkout/init`
2. **OTP Auth**: Customer enters mobile → SDK sends OTP via `/auth/otp/send`
3. **OTP Verify**: Customer enters code → SDK verifies via `/auth/otp/verify`
4. **Address**: Customer enters/selects delivery address → saved via `/user/profile`
5. **Payment Selection**: Customer chooses payment method (PayU/Razorpay/COD)
6. **Gateway Redirect**: SDK redirects to payment gateway with callback URL
7. **Payment Completion**: Gateway processes payment
8. **Callback**: Gateway calls `/checkout/payu/callback` (server-side)
9. **Redirect Back**: Gateway redirects customer back to your app
10. **Status Check**: SDK checks `/checkout/summary/{sessionId}` for final status
11. **Result Display**: SDK shows success or failure screen

---

## Customization

### Styling

The checkout UI uses CSS custom properties for theming. Override these in your `style.css`:

```css
:root {
  /* Colors */
  --primary: #2563eb;
  --text-primary: #1e293b;
  --text-secondary: #64748b;
  --border-light: #e2e8f0;
  --bg-secondary: #f8fafc;

  /* Typography */
  --font-family: 'Outfit', sans-serif;

  /* Spacing */
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
}
```

### Gateway Icons

Place your payment gateway icons in the `assets/` folder:

```
frontend/
├── assets/
│   ├── evoc_logo.png
│   ├── payu_logo.svg
│   ├── razorpay_logo.png
│   └── cod_icon.png
```

---

## Error Handling

### Session Expiry (HTTP 410)

When a session expires, the SDK automatically:
1. Shows an alert to the user
2. Resets the checkout workflow
3. Clears localStorage session data

### Network Errors

The SDK implements retry logic for API calls. If the backend is unavailable:
1. Offline mode activates with mock data
2. User can still complete the checkout flow (for testing)
3. Production should always have backend available

### Payment Failures

When payment fails:
1. SDK redirects to failure screen
2. `footerSessionId` shows "Session: Failed"
3. User can retry or choose another payment method

---

## Browser Compatibility

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

### Required Features
- ES6+ JavaScript
- CSS Grid/Flexbox
- sessionStorage API

---

## Security Considerations

1. **HTTPS Required**: Always use HTTPS in production
2. **Callback Validation**: Server must validate payment callbacks with hash verification
3. **Session Tokens**: Session IDs should be UUIDs, not guessable
4. **Amount Verification**: Always verify payment amounts server-side

---

## Troubleshooting

### Payment popup not opening
- Check if popup blocker is active
- Ensure `window.location.href` redirect is working
- Verify PayU redirect URLs are configured correctly

### Callback not received
- Verify PayU dashboard URLs are set correctly
- Check ngrok/public URL is accessible
- Ensure webhook/callback endpoint is publicly reachable

### Session not syncing
- Check `x-store-id` header is being sent
- Verify session hasn't expired (10-minute default)
- Check browser has sessionStorage available

---

## Support

For issues or questions, contact the Evoc Labs team or refer to the main project documentation.