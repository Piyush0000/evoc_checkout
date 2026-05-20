# Evoc Checkout SDK — Integration Guide

A vanilla JS checkout widget for embedding on any merchant website.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Callbacks](#callbacks)
5. [API Reference](#api-reference)
6. [Backend Requirements](#backend-requirements)
7. [Examples](#examples)

---

## Quick Start

### 1. Add the SDK script

```html
<!-- Option A: Self-hosted (recommended for production) -->
<script src="/assets/evoc-checkout-sdk.umd.min.js"></script>

<!-- Option B: Use the source file directly (for development) -->
<script src="/frontend/evoc-checkout-sdk.js"></script>
```

### 2. Add the container element

```html
<div id="evoc-checkout"></div>
```

### 3. Initialize with config

```html
<script>
  EVOC_CHECKOUT.init({
    storeId: 'your_store_id',
    amount: 4999.00,
    apiBaseUrl: 'https://api.your-domain.com/api/v1',
    merchantName: 'Your Store Name',
    upiVpa: 'yourmerchant@oksbi',
    callbacks: {
      onSuccess: (order) => {
        console.log('Order placed:', order);
        window.location.href = '/thank-you';
      },
      onFailure: (err) => console.error('Payment failed:', err)
    }
  });
</script>
```

---

## Installation

### Option A: Script Tag (CDN / Self-hosted)

Download `evoc-checkout-sdk.umd.min.js` from the `dist/` folder and host it on your server or CDN.

```html
<script src="https://cdn.your-domain.com/evoc-checkout-sdk.umd.min.js"></script>
```

### Option B: npm Package

```bash
npm install evoc-checkout-sdk
# or
pnpm add evoc-checkout-sdk
```

```javascript
// ES Module
import EVOC_CHECKOUT from 'evoc-checkout-sdk';

// CommonJS
const { EVOC_CHECKOUT } = require('evoc-checkout-sdk');

// Initialize
EVOC_CHECKOUT.init({ storeId: 'xxx', amount: 4999 });
```

---

## Configuration

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `storeId` | `string` | **Yes** | — | Your merchant store ID |
| `apiBaseUrl` | `string` | No | `/api/v1` | Backend API base URL |
| `amount` | `number` | No | auto | Total amount (overrides items sum) |
| `currency` | `string` | No | `INR` | Currency code |
| `items` | `array` | No | `[]` | Cart items for display |
| `merchantName` | `string` | No | `Evoc Labs` | Store name in header |
| `upiVpa` | `string` | No | `evoclabs@oksbi` | UPI VPA for QR code |
| `successUrl` | `string` | No | current page | Redirect URL after success |
| `cancelUrl` | `string` | No | current page | Redirect URL after cancel |

### Example with all options

```javascript
EVOC_CHECKOUT.init({
  // Required
  storeId: 'merchant_abc_123',

  // API Configuration
  apiBaseUrl: 'https://api.your-domain.com/api/v1',

  // Amount (auto-calculated from items if not provided)
  amount: 6998.00,
  currency: 'INR',

  // Cart items for display
  items: [
    {
      id: 'prod_001',
      name: 'Premium Headphones',
      price: 3499.00,
      qty: 1,
      originalPrice: 6999.00  // Shows strikethrough
    },
    {
      id: 'prod_002',
      name: 'Phone Case',
      price: 999.00,
      qty: 1,
      originalPrice: 1999.00
    }
  ],

  // Branding
  merchantName: 'TechGadgets Store',
  upiVpa: 'techgadgets@oksbi',

  // Redirect URLs
  successUrl: 'https://your-site.com/checkout/success',
  cancelUrl: 'https://your-site.com/checkout',

  // Callbacks
  callbacks: {
    onSuccess: (order) => console.log(order),
    onFailure: (err) => console.error(err),
    onClose: () => console.log('Closed'),
    onStepChange: (step) => console.log(step)
  }
});
```

---

## Callbacks

```javascript
EVOC_CHECKOUT.init({
  storeId: 'your_store_id',
  amount: 4999,
  callbacks: {

    /**
     * Triggered when order is successfully placed
     * @param {Object} order
     * @param {string} order.sessionId - Checkout session ID
     * @param {string} order.status - Order status (PLACED, COMPLETED)
     * @param {string} order.paymentMethod - Payment method used
     * @param {number} order.amount - Final amount paid
     */
    onSuccess: (order) => {
      console.log('Order placed!', order);
      // Redirect to thank you page
      window.location.href = `/thank-you?session=${order.sessionId}`;
    },

    /**
     * Triggered when payment fails
     * @param {Object} error
     * @param {string} error.reason - Failure reason
     * @param {string} error.sessionId - Session ID
     */
    onFailure: (error) => {
      console.error('Payment failed:', error);
      // Show error message to user
    },

    /**
     * Triggered when checkout is reset or closed
     */
    onClose: () => {
      console.log('Checkout closed');
      // Track abandonment if needed
    },

    /**
     * Triggered when user moves between checkout steps
     * @param {string} step - 'mobile' | 'otp' | 'address' | 'payment' | 'success'
     */
    onStepChange: (step) => {
      console.log('User on step:', step);
      // Track funnel progress
    }
  }
});
```

---

## API Reference

### Methods

#### `EVOC_CHECKOUT.init(config)`
Initialize and render the checkout widget.

```javascript
EVOC_CHECKOUT.init({
  storeId: 'xxx',
  amount: 4999
});
```

#### `EVOC_CHECKOUT.updateConfig(newConfig)`
Update configuration at runtime (after initialization).

```javascript
// Update amount
EVOC_CHECKOUT.updateConfig({ amount: 5999 });

// Update merchant name
EVOC_CHECKOUT.updateConfig({ merchantName: 'New Store Name' });
```

#### `EVOC_CHECKOUT.isInitialized()`
Check if SDK is initialized.

```javascript
if (EVOC_CHECKOUT.isInitialized()) {
  console.log('SDK ready');
}
```

#### `EVOC_CHECKOUT.getVersion()`
Get SDK version.

```javascript
console.log(EVOC_CHECKOUT.getVersion()); // "1.0.0"
```

#### `EVOC_CHECKOUT.destroy()`
Remove widget and clean up.

```javascript
EVOC_CHECKOUT.destroy();
// Container is now empty
```

---

## Backend Requirements

The SDK communicates with your backend via these endpoints:

| Method | Endpoint | Description | Request Body |
|--------|----------|-------------|--------------|
| POST | `/checkout/init` | Create session | `{ items, currency, successUrl, cancelUrl }` |
| GET | `/checkout/summary/:sessionId` | Get session state | — |
| POST | `/checkout/finalize` | Create payment | `{ sessionId, paymentMethod }` |
| POST | `/auth/otp/send` | Send OTP | `{ phone, sessionId }` |
| POST | `/auth/otp/verify` | Verify OTP | `{ phone, code, sessionId }` |
| POST | `/user/profile` | Save address | `{ sessionId, email, newAddress? }` |

### Expected Response Format

All endpoints should return:

```json
{
  "success": true,
  "data": { ... },
  "message": "optional message"
}
```

### Session State Machine

```
PENDING_AUTH → AUTHENTICATED → ADDRESS_CONFIRMED → PAYMENT_PENDING → COMPLETED
     ↓              ↓               ↓                    ↓
     └──────────────┴──────────────┴────────────────────┴──→ FAILED
```

---

## Examples

### Minimal Integration

```html
<!DOCTYPE html>
<html>
<head>
  <title>Checkout</title>
</head>
<body>
  <div id="evoc-checkout"></div>

  <script src="evoc-checkout-sdk.umd.min.js"></script>
  <script>
    EVOC_CHECKOUT.init({
      storeId: 'my_store',
      amount: 1999,
      merchantName: 'My Store'
    });
  </script>
</body>
</html>
```

### With React

```jsx
import { useEffect } from 'react';
import EVOC_CHECKOUT from 'evoc-checkout-sdk';

function CheckoutPage({ amount, items }) {
  useEffect(() => {
    EVOC_CHECKOUT.init({
      storeId: 'my_store',
      amount,
      items,
      callbacks: {
        onSuccess: (order) => {
          // Handle success
        }
      }
    });

    return () => EVOC_CHECKOUT.destroy();
  }, []);

  return <div id="evoc-checkout" />;
}
```

### With Angular

```typescript
import { Component, OnInit, OnDestroy } from '@angular/core';

@Component({
  selector: 'app-checkout',
  template: `<div id="evoc-checkout"></div>`
})
export class CheckoutComponent implements OnInit, OnDestroy {
  ngOnInit() {
    (window as any).EVOC_CHECKOUT.init({
      storeId: 'my_store',
      amount: this.amount,
      callbacks: {
        onSuccess: (order) => console.log(order)
      }
    });
  }

  ngOnDestroy() {
    (window as any).EVOC_CHECKOUT.destroy();
  }
}
```

### Dynamic Loading

```javascript
// Load SDK on demand
function loadCheckout(amount) {
  const script = document.createElement('script');
  script.src = 'evoc-checkout-sdk.umd.min.js';
  script.onload = () => {
    EVOC_CHECKOUT.init({
      storeId: 'my_store',
      amount: amount
    });
  };
  document.head.appendChild(script);
}
```

### Multiple Stores (Single Page App)

```javascript
// Store A checkout
EVOC_CHECKOUT.init({
  storeId: 'store_a',
  amount: 1999,
  merchantName: 'Store A'
});

// Later, switch to Store B
EVOC_CHECKOUT.destroy();
EVOC_CHECKOUT.init({
  storeId: 'store_b',
  amount: 2999,
  merchantName: 'Store B'
});
```

---

## Browser Support

| Browser | Minimum Version |
|---------|-----------------|
| Chrome | 60+ |
| Firefox | 55+ |
| Safari | 11+ |
| Edge | 79+ |

---

## Troubleshooting

### Widget not rendering

1. Check that `#evoc-checkout` element exists
2. Verify the SDK script loaded (`window.EVOC_CHECKOUT` should exist)
3. Check browser console for errors

### API calls failing

1. Verify `apiBaseUrl` is correct and accessible
2. Check CORS configuration on your backend
3. Ensure `x-store-id` header is handled

### Styles look broken

The SDK uses Shadow DOM for CSS isolation. If styles aren't applying:
1. Check that styles aren't being overridden by `!important`
2. Verify the container has sufficient height

---

## Support

For issues or questions, contact Evoc Labs support.