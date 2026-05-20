# Evoc Checkout SDK

A production-ready, vanilla JS checkout widget that can be embedded on any merchant website. Zero dependencies, Shadow DOM isolated, works with any backend.

---

## Features

- **Zero Dependencies** — Pure vanilla JS, no frameworks required
- **Shadow DOM Isolation** — CSS won't conflict with your site's styles
- **UMD/ESM/CJS** — Works with `<script>` tags, npm bundlers, and Node.js
- **Full Checkout Flow** — OTP verification, address management, payment (UPI/COD/Card)
- **Configurable** — Store ID, amount, currency, UPI VPA, merchant branding
- **Callbacks** — `onSuccess`, `onFailure`, `onClose`, `onStepChange`
- **Offline Fallback** — Demo mode when backend is unreachable

---

## Quick Start

### Option 1: Script Tag (CDN/Self-hosted)

```html
<!-- Download dist/evoc-checkout-sdk.umd.min.js and host it -->
<script src="evoc-checkout-sdk.min.js"></script>

<div id="evoc-checkout"></div>

<script>
  EVOC_CHECKOUT.init({
    storeId: 'your_store_id',
    apiBaseUrl: 'https://api.your-domain.com/api/v1',
    amount: 4999.00,
    currency: 'INR',
    merchantName: 'Your Store Name',
    upiVpa: 'merchant@oksbi',
    callbacks: {
      onSuccess: (order) => {
        console.log('Order placed!', order);
        // Redirect to thank you page
      },
      onFailure: (error) => {
        console.error('Payment failed:', error);
        // Show error message
      }
    }
  });
</script>
```

### Option 2: npm

```bash
npm install evoc-checkout-sdk
```

```javascript
import { EVOC_CHECKOUT } from 'evoc-checkout-sdk';
// or
const { EVOC_CHECKOUT } = require('evoc-checkout-sdk');

EVOC_CHECKOUT.init({
  storeId: 'your_store_id',
  amount: 4999
});
```

---

## Configuration

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `storeId` | `string` | Yes | — | Your merchant store ID |
| `apiBaseUrl` | `string` | No | `/api/v1` | Backend API base URL |
| `amount` | `number` | No | auto | Total checkout amount (auto-calculated from items) |
| `currency` | `string` | No | `INR` | Currency code |
| `items` | `array` | No | `[{...}]` | Cart items for display |
| `merchantName` | `string` | No | `Evoc Labs` | Name shown in header |
| `upiVpa` | `string` | No | `evoclabs@oksbi` | UPI VPA for QR codes |
| `successUrl` | `string` | No | current page | Redirect URL on success |
| `cancelUrl` | `string` | No | current page | Redirect URL on cancel |
| `callbacks` | `object` | No | `{}` | Event callback functions |

### Callbacks

```javascript
EVOC_CHECKOUT.init({
  // ... config
  callbacks: {
    // Called when order is successfully placed
    onSuccess: (order) => {
      // order = { sessionId, status, paymentMethod, amount }
    },

    // Called when payment fails
    onFailure: (error) => {
      // error = { reason, sessionId }
    },

    // Called when user closes/resets checkout
    onClose: () => {
      // User clicked "Back to Start"
    },

    // Called when checkout step changes
    onStepChange: (step) => {
      // step = 'mobile' | 'otp' | 'address' | 'payment' | 'success'
    }
  }
});
```

### Items Format

```javascript
items: [
  {
    id: 'prod_001',
    name: 'Product Name',
    price: 2499.00,
    qty: 2,
    originalPrice: 4999.00  // Optional, for strikethrough display
  }
]
```

---

## Methods

### `EVOC_CHECKOUT.init(config)`
Initialize and render the checkout widget.

### `EVOC_CHECKOUT.updateConfig(newConfig)`
Update configuration at runtime.

### `EVOC_CHECKOUT.isInitialized()`
Returns `true` if SDK is initialized.

### `EVOC_CHECKOUT.getVersion()`
Returns the SDK version string.

### `EVOC_CHECKOUT.destroy()`
Remove the widget and clean up.

---

## API Endpoints Required

The SDK expects these backend endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/checkout/init` | Create checkout session |
| GET | `/checkout/summary/:sessionId` | Get session state |
| POST | `/checkout/finalize` | Create payment intent |
| POST | `/auth/otp/send` | Send OTP to phone |
| POST | `/auth/otp/verify` | Verify OTP code |
| POST | `/user/profile` | Save address/email |

---

## Build

```bash
# Install dependencies
npm install

# Build SDK bundles
npm run build:sdk

# Build both backend + SDK
npm run build:all

# Output in dist/
# - evoc-checkout-sdk.umd.js
# - evoc-checkout-sdk.umd.min.js  (for CDN/script tag)
# - evoc-checkout-sdk.esm.js
# - evoc-checkout-sdk.cjs.js
```

---

## Browser Support

- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

---

## License

Proprietary — Evoc Labs