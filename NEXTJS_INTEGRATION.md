# Evoc Checkout SDK — Next.js Integration Guide

This guide shows how to embed the Evoc Checkout SDK into a Next.js website.

---

## Prerequisites

- Next.js 13+ (App Router)
- Your Evoc Checkout backend running at some URL

---

## Step 1: Copy SDK to Public Folder

Copy the SDK bundle to your Next.js app's `public` folder:

```bash
cp dist/evoc-checkout-sdk.umd.min.js your-nextjs-app/public/
```

Your file structure should look like:

```
your-nextjs-app/
├── public/
│   └── evoc-checkout-sdk.umd.min.js   ← here
├── src/
│   └── app/
│       └── checkout/
│           └── page.tsx               ← we'll create this
└── package.json
```

---

## Step 2: Create Checkout Page Component

Create a client component at `src/app/checkout/page.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    EVOC_CHECKOUT?: typeof import('./types/evoc-checkout').EVOC_CHECKOUT;
  }
}

// Config type
interface EvocConfig {
  storeId: string;
  apiBaseUrl: string;
  amount: number;
  currency?: string;
  items?: Array<{
    id: string | number;
    name: string;
    price: number;
    qty?: number;
    originalPrice?: number;
  }>;
  merchantName?: string;
  upiVpa?: string;
  successUrl?: string;
  cancelUrl?: string;
  callbacks?: {
    onSuccess?: (order: OrderResult) => void;
    onFailure?: (error: { reason?: string; sessionId?: string }) => void;
    onClose?: () => void;
    onStepChange?: (step: string) => void;
  };
}

interface OrderResult {
  sessionId: string;
  status: string;
  paymentMethod: string;
  amount: number;
}

// SDK type
interface EVOC_CHECKOUT {
  init: (config: EvocConfig) => EVOC_CHECKOUT;
  destroy: () => EVOC_CHECKOUT;
  updateConfig: (config: Partial<EvocConfig>) => EVOC_CHECKOUT;
  isInitialized: () => boolean;
  getVersion: () => string;
}

export default function CheckoutPage({
  params,
}: {
  params: { amount: string; merchantName: string };
}) {
  const initialized = useRef(false);

  useEffect(() => {
    // Prevent double initialization in StrictMode
    if (initialized.current) return;
    initialized.current = true;

    // Check if already loaded
    if (window.EVOC_CHECKOUT) {
      initCheckout();
      return;
    }

    // Load SDK script dynamically
    const script = document.createElement('script');
    script.src = '/evoc-checkout-sdk.umd.min.js';
    script.onload = () => initCheckout();
    script.onerror = () => console.error('Failed to load Evoc Checkout SDK');
    document.head.appendChild(script);

    function initCheckout() {
      if (!window.EVOC_CHECKOUT) return;

      window.EVOC_CHECKOUT.init({
        // Required
        storeId: 'store_123',  // Replace with your actual store ID
        apiBaseUrl: process.env.NEXT_PUBLIC_API_URL + '/api/v1', // Your backend URL

        // Checkout amount
        amount: Number(params.amount) || 4999,

        // Branding
        merchantName: params.merchantName || 'My Store',
        upiVpa: 'merchant@oksbi',  // Replace with your UPI VPA

        // Callbacks
        callbacks: {
          onSuccess: (order) => {
            console.log('Order placed:', order);
            // Redirect to success page
            window.location.href = `/checkout/success?session=${order.sessionId}`;
          },

          onFailure: (error) => {
            console.error('Payment failed:', error);
            // Show error or redirect
            window.location.href = `/checkout/failed?reason=${error.reason}`;
          },

          onClose: () => {
            console.log('Checkout closed');
            // Track abandonment
          },

          onStepChange: (step) => {
            console.log('Current step:', step);
            // Track funnel progress
          },
        },
      });
    }

    // Cleanup on unmount
    return () => {
      if (window.EVOC_CHECKOUT?.isInitialized()) {
        window.EVOC_CHECKOUT.destroy();
      }
    };
  }, [params.amount, params.merchantName]);

  // This div is required — SDK renders inside it
  return <div id="evoc-checkout" style={{ minHeight: '100vh' }} />;
}
```

---

## Step 3: Create Route (Optional)

If you want dynamic amounts via URL:

```tsx
// src/app/checkout/[amount]/page.tsx
import CheckoutPage from './CheckoutPage';

export default function Page({
  params,
}: {
  params: { amount: string; merchantName: string };
}) {
  return <CheckoutPage params={params} />;
}
```

---

## Step 4: Style the Container (Optional)

Add to your global CSS if the checkout needs spacing:

```css
/* src/app/globals.css */
#evoc-checkout {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

---

## Step 5: Add Environment Variable

Create `.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000
```

For production:

```bash
NEXT_PUBLIC_API_URL=https://api.your-domain.com
```

---

## Alternative: Load SDK Conditionally

For better performance, only load when user clicks "Checkout":

```tsx
'use client';

import { useState } from 'react';

export default function ProductPage() {
  const [showCheckout, setShowCheckout] = useState(false);

  const handleCheckout = () => {
    setShowCheckout(true);

    // Load SDK
    const script = document.createElement('script');
    script.src = '/evoc-checkout-sdk.umd.min.js';
    script.onload = () => {
      window.EVOC_CHECKOUT?.init({
        storeId: 'store_123',
        apiBaseUrl: process.env.NEXT_PUBLIC_API_URL + '/api/v1',
        amount: 4999,
        merchantName: 'My Store',
        callbacks: {
          onSuccess: (order) => {
            console.log('Order:', order);
          },
        },
      });
    };
    document.head.appendChild(script);
  };

  return (
    <div>
      {showCheckout ? (
        <div id="evoc-checkout" style={{ minHeight: '100vh' }} />
      ) : (
        <button onClick={handleCheckout}>Buy Now</button>
      )}
    </div>
  );
}
```

---

## Alternative: Use in Server Component with Dynamic Import

```tsx
// src/app/checkout/page.tsx
import dynamic from 'next/dynamic';

// Dynamically import client component (avoids SSR issues)
const CheckoutClient = dynamic(() => import('./CheckoutClient'), {
  ssr: false,
  loading: () => <div>Loading checkout...</div>,
});

export default function CheckoutPage() {
  return <CheckoutClient />;
}
```

---

## TypeScript Types File

Create `src/types/evoc-checkout.d.ts`:

```ts
export interface EvocConfig {
  storeId: string;
  apiBaseUrl?: string;
  amount?: number;
  currency?: string;
  items?: CartItem[];
  merchantName?: string;
  upiVpa?: string;
  successUrl?: string;
  cancelUrl?: string;
  callbacks?: EvocCallbacks;
}

export interface CartItem {
  id: string | number;
  name: string;
  price: number;
  qty?: number;
  originalPrice?: number;
}

export interface EvocCallbacks {
  onSuccess?: (order: OrderResult) => void;
  onFailure?: (error: OrderError) => void;
  onClose?: () => void;
  onStepChange?: (step: CheckoutStep) => void;
}

export interface OrderResult {
  sessionId: string;
  status: string;
  paymentMethod: string;
  amount: number;
}

export interface OrderError {
  reason?: string;
  sessionId?: string;
}

export type CheckoutStep = 'mobile' | 'otp' | 'address' | 'payment' | 'success';

export interface EVOC_CHECKOUT {
  init: (config: EvocConfig) => EVOC_CHECKOUT;
  destroy: () => EVOC_CHECKOUT;
  updateConfig: (config: Partial<EvocConfig>) => EVOC_CHECKOUT;
  isInitialized: () => boolean;
  getVersion: () => string;
  getSessionId: () => string | null;
}

declare global {
  interface Window {
    EVOC_CHECKOUT?: EVOC_CHECKOUT;
  }
}
```

---

## Troubleshooting

### "EVOC_CHECKOUT is not defined"

1. Make sure the SDK file is in `public/` folder
2. Check browser console for 404 on the script
3. Verify script URL: `/evoc-checkout-sdk.umd.min.js`

### SSR/Hydration Issues

Add `'use client'` directive or use `dynamic` import with `ssr: false`:

```tsx
const CheckoutClient = dynamic(() => import('./CheckoutClient'), {
  ssr: false,
});
```

### Styles Look Broken

The SDK uses Shadow DOM. Make sure the container has `min-height`:

```tsx
<div id="evoc-checkout" style={{ minHeight: '100vh' }} />
```

---

## API Reference

### `EVOC_CHECKOUT.init(config)`

Initialize the checkout widget.

```tsx
EVOC_CHECKOUT.init({
  storeId: 'your_store_id',
  apiBaseUrl: 'https://api.your-domain.com/api/v1',
  amount: 4999,
  merchantName: 'Your Store',
  upiVpa: 'merchant@oksbi',
  callbacks: {
    onSuccess: (order) => { /* ... */ },
  },
});
```

### `EVOC_CHECKOUT.destroy()`

Remove the widget and clean up.

```tsx
useEffect(() => {
  return () => {
    window.EVOC_CHECKOUT?.destroy();
  };
}, []);
```

### `EVOC_CHECKOUT.updateConfig(config)`

Update config at runtime.

```tsx
window.EVOC_CHECKOUT?.updateConfig({ amount: 5999 });
```

### `EVOC_CHECKOUT.isInitialized()`

Check if SDK is ready.

```tsx
if (window.EVOC_CHECKOUT?.isInitialized()) {
  // SDK ready
}
```

---

## Next Steps

1. Replace `store_123` with your actual store ID
2. Replace `merchant@oksbi` with your UPI VPA
3. Set `NEXT_PUBLIC_API_URL` to your backend URL
4. Handle callbacks for success/failure redirects
