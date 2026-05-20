/**
 * Evoc Labs Checkout SDK
 * A vanilla JS widget for embedding premium checkout flows on any merchant website.
 *
 * Usage:
 *   <script src="evoc-checkout-sdk.js"></script>
 *   <div id="evoc-checkout"></div>
 *   <script>
 *     EVOC_CHECKOUT.init({
 *       storeId: 'merchant_xyz',
 *       apiBaseUrl: 'https://api.your-domain.com/api/v1',
 *       amount: 4999.00,
 *       currency: 'INR',
 *       items: [{ id: 1, name: 'Product Name', price: 4999, qty: 1, originalPrice: 9999 }],
 *       merchantName: 'Your Store',
 *       upiVpa: 'merchant@oksbi',
 *       theme: 'light', // or 'dark' (optional)
 *       onSuccess: (order) => console.log('Order placed:', order),
 *       onFailure: (err) => console.log('Payment failed:', err),
 *       onClose: () => console.log('Checkout closed')
 *     });
 *   </script>
 */

(function(global) {
  'use strict';

  const SDK_VERSION = '1.0.0';
  const DEFAULT_CONFIG = {
    storeId: 'store_123',
    apiBaseUrl: '/api/v1',
    currency: 'INR',
    merchantName: 'Evoc Labs',
    upiVpa: 'evoclabs@oksbi',
    theme: 'light',
    items: [
      { id: 1, name: 'Premium Product', price: 6998, qty: 1, originalPrice: 13998 }
    ],
    amount: null, // Auto-calculated from items if not provided
    successUrl: null, // Defaults to current page
    cancelUrl: null, // Defaults to current page
    callbacks: {
      onSuccess: null,
      onFailure: null,
      onClose: null,
      onStepChange: null
    }
  };

  // Global configuration store
  let sdkConfig = {};
  let isInitialized = false;
  let checkoutRoot = null;

  /**
   * Deep merge objects
   */
  function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  /**
   * Validate required config fields
   */
  function validateConfig(config) {
    if (!config.storeId) {
      throw new Error('EVOC_CHECKOUT: storeId is required');
    }
    return true;
  }

  /**
   * Calculate total from items
   */
  function calculateAmount(items) {
    if (!items || !Array.isArray(items)) return 0;
    return items.reduce((sum, item) => sum + (item.price * (item.qty || 1)), 0);
  }

  /**
   * Create Shadow DOM container
   */
  function createShadowContainer(targetId) {
    const container = document.getElementById(targetId);
    if (!container) {
      throw new Error(`EVOC_CHECKOUT: Target element #${targetId} not found`);
    }

    // Create shadow root for style isolation
    checkoutRoot = container.attachShadow({ mode: 'open' });

    // Inject styles into shadow DOM
    const styleEl = document.createElement('style');
    styleEl.textContent = getShadowStyles();
    checkoutRoot.appendChild(styleEl);

    // Create wrapper div
    const wrapper = document.createElement('div');
    wrapper.id = 'evoc-checkout-widget';
    wrapper.className = 'evoc-checkout-wrapper';
    checkoutRoot.appendChild(wrapper);

    return wrapper;
  }

  /**
   * Get isolated CSS styles for Shadow DOM
   */
  function getShadowStyles() {
    return `
      /* Reset for shadow DOM */
      *, *::before, *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      /* CSS Variables - Scoped to widget */
      :host {
        --evoc-primary: #0288d1;
        --evoc-primary-dark: #01579b;
        --evoc-primary-light: #03a9f4;
        --evoc-accent: #e1f5fe;
        --evoc-success: #2e7d32;
        --evoc-error: #d32f2f;
        --evoc-bg: #f8fafc;
        --evoc-card: #ffffff;
        --evoc-border: #e2e8f0;
        --evoc-text: #0f172a;
        --evoc-text-secondary: #475569;
        --evoc-text-muted: #94a3b8;
        --evoc-shadow-sm: 0 1px 3px rgba(15, 23, 42, 0.03);
        --evoc-shadow-md: 0 4px 20px rgba(15, 23, 42, 0.05);
        --evoc-shadow-lg: 0 20px 40px rgba(15, 23, 42, 0.12);
        --evoc-radius-sm: 8px;
        --evoc-radius-md: 14px;
        --evoc-radius-lg: 20px;
        --evoc-transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        --evoc-transition-bounce: all 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .evoc-checkout-wrapper {
        font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: rgba(10, 25, 47, 0.45);
        backdrop-filter: blur(12px) saturate(120%);
        -webkit-backdrop-filter: blur(12px) saturate(120%);
        min-height: 100vh;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px 16px;
        color: var(--evoc-text);
        line-height: 1.5;
      }

      .evoc-checkout-panel {
        width: 480px;
        max-width: 100%;
        max-height: 90vh;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(20px);
        border-radius: 24px;
        box-shadow: var(--evoc-shadow-lg);
        border: 1px solid rgba(226, 232, 240, 0.8);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: evocScaleUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }

      @keyframes evocScaleUp {
        from { opacity: 0; transform: scale(0.96) translateY(10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }

      /* Header */
      .evoc-checkout-header {
        height: 68px;
        padding: 0 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid var(--evoc-border);
        background: var(--evoc-card);
      }

      .evoc-header-action { width: 24px; }

      .evoc-merchant-name {
        font-size: 20px;
        font-weight: 800;
        color: var(--evoc-text);
        letter-spacing: -0.5px;
      }

      /* Content area */
      .evoc-checkout-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .evoc-checkout-content::-webkit-scrollbar { width: 6px; }
      .evoc-checkout-content::-webkit-scrollbar-track { background: transparent; }
      .evoc-checkout-content::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }

      /* Cards */
      .evoc-card {
        background: var(--evoc-card);
        border: 1px solid var(--evoc-border);
        border-radius: var(--evoc-radius-md);
        padding: 16px;
        box-shadow: var(--evoc-shadow-sm);
        transition: var(--evoc-transition);
      }

      .evoc-card:hover {
        box-shadow: var(--evoc-shadow-md);
        border-color: var(--evoc-primary-light);
      }

      .evoc-order-summary { border-left: 4px solid var(--evoc-primary); }

      .evoc-card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        user-select: none;
      }

      .evoc-summary-info { display: flex; flex-direction: column; gap: 2px; }

      .evoc-summary-title {
        font-weight: 700;
        font-size: 15px;
        color: var(--evoc-text);
      }

      .evoc-item-count {
        color: var(--evoc-text-secondary);
        font-weight: 500;
        font-size: 14px;
      }

      .evoc-summary-prices {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .evoc-old-price {
        font-size: 13px;
        text-decoration: line-through;
        color: var(--evoc-text-muted);
      }

      .evoc-new-price {
        font-size: 16px;
        font-weight: 800;
        color: var(--evoc-primary);
      }

      .evoc-toggle-icon {
        color: var(--evoc-text-secondary);
        transition: transform 0.3s ease;
        display: flex;
        align-items: center;
      }

      .evoc-order-summary.expanded .evoc-toggle-icon {
        transform: rotate(180deg);
      }

      /* Cart drawer */
      .evoc-order-drawer {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.35s ease;
      }

      .evoc-order-summary.expanded .evoc-order-drawer {
        max-height: 250px;
      }

      .evoc-drawer-inner {
        padding-top: 15px;
        border-top: 1px dashed var(--evoc-border);
        margin-top: 12px;
      }

      .evoc-cart-item {
        display: grid;
        grid-template-columns: 50px 1fr 90px;
        gap: 15px;
        align-items: center;
      }

      .evoc-item-image {
        width: 50px;
        height: 50px;
        background: #f1f5f9;
        border-radius: var(--evoc-radius-sm);
        border: 1px solid var(--evoc-border);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .evoc-item-image img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }

      .evoc-item-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--evoc-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 4px;
      }

      /* Qty controls */
      .evoc-qty-control {
        display: inline-flex;
        align-items: center;
        background: #f1f5f9;
        border-radius: 8px;
        border: 1px solid var(--evoc-border);
        padding: 2px;
      }

      .evoc-qty-btn {
        background: white;
        border: none;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: var(--evoc-transition);
      }

      .evoc-qty-btn:hover {
        background: var(--evoc-accent);
        color: var(--evoc-primary);
      }

      .evoc-qty-val {
        font-size: 13px;
        font-weight: 700;
        width: 25px;
        text-align: center;
      }

      .evoc-item-price-col {
        text-align: right;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
      }

      .evoc-item-price {
        font-weight: 700;
        font-size: 14px;
      }

      .evoc-remove-btn {
        background: transparent;
        border: none;
        color: var(--evoc-text-muted);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: var(--evoc-transition);
        display: flex;
      }

      .evoc-remove-btn:hover {
        color: var(--evoc-error);
        background: #ffebee;
      }

      /* Coupon */
      .evoc-coupon-wrapper {
        display: flex;
        align-items: center;
        background: white;
        border: 1px solid var(--evoc-border);
        border-radius: var(--evoc-radius-sm);
        padding: 2px 2px 2px 10px;
        transition: var(--evoc-transition);
      }

      .evoc-coupon-wrapper:focus-within {
        border-color: var(--evoc-primary);
        box-shadow: 0 0 0 3px rgba(3, 169, 244, 0.15);
      }

      .evoc-coupon-icon {
        display: flex;
        align-items: center;
        margin-right: 8px;
      }

      .evoc-coupon-input {
        border: none;
        outline: none;
        flex: 1;
        font-size: 14px;
        font-weight: 500;
        color: var(--evoc-text);
      }

      .evoc-coupon-input::placeholder {
        color: var(--evoc-text-muted);
      }

      .evoc-apply-btn {
        background: transparent;
        border: none;
        color: var(--evoc-primary);
        font-weight: 700;
        font-size: 14px;
        padding: 10px 16px;
        cursor: pointer;
        transition: var(--evoc-transition);
        border-radius: 6px;
      }

      .evoc-apply-btn:hover {
        background: var(--evoc-accent);
      }

      .evoc-coupon-message {
        margin-top: 8px;
        font-size: 12px;
        font-weight: 600;
        padding-left: 6px;
      }

      .evoc-coupon-message.success { color: var(--evoc-success); }
      .evoc-coupon-message.error { color: var(--evoc-error); }

      /* Workflow */
      .evoc-workflow { position: relative; display: flex; flex-direction: column; }

      .evoc-step-card {
        display: none;
        flex-direction: column;
        animation: evocSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }

      .evoc-step-card.active { display: flex; }

      @keyframes evocSlideIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .evoc-step-header { margin-bottom: 16px; }

      .evoc-step-title {
        font-size: 18px;
        font-weight: 700;
        color: var(--evoc-text);
        margin-bottom: 4px;
      }

      .evoc-step-subtitle {
        font-size: 13px;
        color: var(--evoc-text-secondary);
        font-weight: 500;
      }

      .evoc-action-btn {
        width: 100%;
        padding: 16px;
        border-radius: var(--evoc-radius-md);
        font-size: 16px;
        border: none;
        cursor: pointer;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: var(--evoc-transition-bounce);
      }

      .evoc-btn-primary {
        background: var(--evoc-primary);
        color: white;
        box-shadow: 0 4px 20px rgba(3, 169, 244, 0.25);
      }

      .evoc-btn-primary:hover {
        background: var(--evoc-primary-dark);
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(3, 169, 244, 0.35);
      }

      .evoc-btn-primary:active { transform: translateY(-0.5px); }

      .evoc-btn-secondary {
        background: white;
        color: var(--evoc-text);
        border: 1.5px solid var(--evoc-border);
        box-shadow: var(--evoc-shadow-sm);
      }

      .evoc-btn-secondary:hover {
        border-color: var(--evoc-primary);
        color: var(--evoc-primary);
        transform: translateY(-2px);
      }

      .evoc-btn-back {
        background: transparent;
        color: var(--evoc-text-secondary);
        font-size: 13px;
        padding: 8px 16px;
        text-decoration: underline;
        border: none;
        cursor: pointer;
      }

      .evoc-btn-back:hover { color: var(--evoc-primary); }

      .evoc-error {
        color: var(--evoc-error);
        font-size: 12px;
        font-weight: 600;
        margin-top: 8px;
        min-height: 18px;
      }

      /* Mobile input */
      .evoc-mobile-container {
        display: flex;
        align-items: center;
        border: 1px solid var(--evoc-border);
        border-radius: var(--evoc-radius-md);
        background: white;
        padding: 4px 6px;
        transition: var(--evoc-transition);
      }

      .evoc-mobile-container:focus-within {
        border-color: var(--evoc-primary);
        box-shadow: 0 0 0 3px rgba(3, 169, 244, 0.15);
      }

      .evoc-country-picker {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 14px;
        border-right: 1.5px solid var(--evoc-border);
        font-weight: 700;
        font-size: 15px;
      }

      .evoc-tel-input {
        flex: 1;
        border: none;
        outline: none;
        padding: 12px 16px;
        font-size: 16px;
        font-weight: 600;
        letter-spacing: 0.5px;
        color: var(--evoc-text);
        width: 100%;
      }

      .evoc-tel-input::placeholder {
        color: var(--evoc-text-muted);
        font-weight: 500;
      }

      /* OTP */
      .evoc-otp-container {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        margin-top: 10px;
      }

      .evoc-otp-box {
        width: 52px;
        height: 52px;
        border: 1.5px solid var(--evoc-border);
        border-radius: var(--evoc-radius-sm);
        text-align: center;
        font-size: 20px;
        font-weight: 800;
        color: var(--evoc-primary);
        background: white;
        outline: none;
        transition: var(--evoc-transition-bounce);
        box-shadow: var(--evoc-shadow-sm);
      }

      .evoc-otp-box:focus {
        border-color: var(--evoc-primary);
        transform: scale(1.06);
        box-shadow: 0 0 0 4px rgba(3, 169, 244, 0.15);
      }

      .evoc-otp-helper {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 15px;
        font-size: 13px;
        font-weight: 500;
        color: var(--evoc-text-secondary);
      }

      .evoc-resend-btn {
        background: transparent;
        border: none;
        color: var(--evoc-primary);
        font-weight: 700;
        cursor: pointer;
        text-decoration: underline;
      }

      .evoc-resend-btn:hover { color: var(--evoc-primary-dark); }

      /* Address */
      .evoc-address-display {
        padding: 5px 0;
      }

      .evoc-recipient-name {
        font-size: 15px;
        font-weight: 700;
        color: var(--evoc-text);
        margin-bottom: 4px;
      }

      .evoc-full-address {
        font-size: 13.5px;
        color: var(--evoc-text-secondary);
        line-height: 1.45;
        margin-bottom: 12px;
        font-weight: 500;
      }

      .evoc-contact-details {
        display: flex;
        flex-direction: column;
        gap: 6px;
        border-top: 1px dashed var(--evoc-border);
        padding-top: 12px;
        margin-top: 8px;
      }

      .evoc-contact-item {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--evoc-text-secondary);
        font-weight: 500;
      }

      .evoc-change-btn {
        background: transparent;
        border: none;
        color: var(--evoc-error);
        font-weight: 700;
        font-size: 14px;
        cursor: pointer;
        text-decoration: underline;
        transition: var(--evoc-transition);
      }

      .evoc-change-btn:hover { color: #b71c1c; }

      /* Form grid */
      .evoc-form-grid {
        display: grid;
        grid-template-columns: repeat(12, 1fr);
        gap: 12px;
        margin-top: 10px;
        border-top: 1px solid var(--evoc-border);
        padding-top: 15px;
      }

      .evoc-col-6 { grid-column: span 6; }
      .evoc-col-12 { grid-column: span 12; }

      .evoc-form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .evoc-form-group label {
        font-size: 11px;
        font-weight: 700;
        color: var(--evoc-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .evoc-form-input {
        padding: 10px 12px;
        border: 1px solid var(--evoc-border);
        border-radius: var(--evoc-radius-sm);
        font-size: 13px;
        font-weight: 500;
        color: var(--evoc-text);
        outline: none;
        transition: var(--evoc-transition);
      }

      .evoc-form-input:focus {
        border-color: var(--evoc-primary);
        box-shadow: 0 0 0 3px rgba(3, 169, 244, 0.12);
      }

      /* Shipping info */
      .evoc-shipping-row {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-top: 16px;
        padding: 12px 14px;
        background: #f1f5f9;
        border-radius: var(--evoc-radius-sm);
        border: 1.5px solid var(--evoc-border);
      }

      .evoc-delivery-text {
        font-size: 13px;
        font-weight: 500;
        color: var(--evoc-text);
        margin-bottom: 2px;
      }

      .evoc-delivery-promo {
        font-size: 12px;
        color: var(--evoc-success);
        font-weight: 700;
      }

      /* Payment methods */
      .evoc-payment-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .evoc-payment-item {
        background: white;
        border: 1.5px solid var(--evoc-border);
        border-radius: var(--evoc-radius-sm);
        overflow: hidden;
        transition: var(--evoc-transition-bounce);
        cursor: pointer;
      }

      .evoc-payment-item:hover {
        border-color: var(--evoc-primary-light);
        transform: translateY(-2px);
      }

      .evoc-payment-item.active {
        border-color: var(--evoc-primary);
        box-shadow: 0 0 0 4px rgba(3, 169, 244, 0.12), var(--evoc-shadow-md);
      }

      .evoc-payment-item.disabled {
        opacity: 0.5;
        cursor: not-allowed;
        pointer-events: none;
        background: #f1f5f9;
      }

      .evoc-method-header {
        padding: 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .evoc-method-meta {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .evoc-method-icon {
        font-size: 18px;
        background: #f1f5f9;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: var(--evoc-transition);
      }

      .evoc-payment-item.active .evoc-method-icon {
        background: var(--evoc-accent);
      }

      .evoc-method-label {
        font-weight: 700;
        font-size: 14px;
        color: var(--evoc-text);
      }

      .evoc-method-subtext {
        display: block;
        font-size: 11px;
        color: var(--evoc-text-secondary);
        margin-top: 1px;
      }

      .evoc-method-price {
        font-size: 14px;
        font-weight: 700;
        color: var(--evoc-text);
      }

      .evoc-method-chevron {
        color: var(--evoc-text-muted);
        display: flex;
        align-items: center;
        transition: transform 0.35s ease;
      }

      .evoc-payment-item.active .evoc-method-chevron {
        transform: rotate(180deg);
        color: var(--evoc-primary);
      }

      .evoc-method-error {
        background: #ffebee;
        color: var(--evoc-error);
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        margin-top: 4px;
        display: inline-block;
      }

      /* UPI drawer */
      .evoc-method-drawer {
        display: none;
        background: #f8fafc;
        border-top: 1px dashed var(--evoc-border);
        padding: 16px;
        animation: evocSlideDown 0.3s ease forwards;
      }

      @keyframes evocSlideDown {
        from { opacity: 0; transform: translateY(-5px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .evoc-drawer-instruction {
        font-size: 13px;
        text-align: center;
        color: var(--evoc-text-secondary);
        font-weight: 500;
        margin-bottom: 12px;
      }

      .evoc-qr-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }

      .evoc-qr-wrapper {
        background: white;
        padding: 12px;
        border-radius: var(--evoc-radius-sm);
        border: 1px solid var(--evoc-border);
        box-shadow: var(--evoc-shadow-sm);
      }

      .evoc-upi-method.active {
        background: linear-gradient(135deg, #ffffff 0%, #f0f7ff 100%);
      }

      .evoc-upi-method.active .evoc-method-label {
        color: var(--evoc-primary);
      }

      /* Success */
      .evoc-success-illustration {
        display: flex;
        justify-content: center;
        margin-top: 15px;
      }

      .evoc-checkmark-circle {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: #e8f5e9;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid #a5d6a7;
        animation: evocPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }

      @keyframes evocPop {
        0% { transform: scale(0.6); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }

      .evoc-checkmark {
        width: 40px;
        height: 20px;
        border-left: 4px solid var(--evoc-success);
        border-bottom: 4px solid var(--evoc-success);
        transform: rotate(-45deg);
        margin-top: -6px;
      }

      .evoc-receipt {
        background: #f1f5f9;
        border-radius: var(--evoc-radius-sm);
        border: 1px dashed var(--evoc-border);
        padding: 16px;
        margin-top: 15px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .evoc-receipt-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 13.5px;
      }

      .evoc-receipt-label {
        color: var(--evoc-text-secondary);
        font-weight: 500;
      }

      .evoc-receipt-value {
        color: var(--evoc-text);
        font-weight: 600;
      }

      .evoc-receipt-code {
        font-family: monospace;
        font-size: 12px;
        background: white;
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid var(--evoc-border);
      }

      /* Trust badges */
      .evoc-trust-badges {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 5px;
        padding: 12px 10px;
        border-top: 1px solid var(--evoc-border);
        background: white;
        margin-top: auto;
      }

      .evoc-badge-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        gap: 4px;
        color: var(--evoc-text-secondary);
      }

      .evoc-badge-item svg {
        color: var(--evoc-text-muted);
        width: 18px;
        height: 18px;
      }

      .evoc-badge-item:hover svg {
        color: var(--evoc-primary);
        transform: scale(1.1);
      }

      .evoc-badge-item span {
        font-size: 9px;
        font-weight: 600;
        letter-spacing: -0.2px;
        line-height: 1.2;
      }

      /* Footer */
      .evoc-footer {
        height: 52px;
        padding: 0 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #f8fafc;
        border-top: 1px solid var(--evoc-border);
      }

      .evoc-footer-links {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        font-weight: 600;
        color: var(--evoc-text-secondary);
      }

      .evoc-footer-links a {
        text-decoration: none;
        color: var(--evoc-text-secondary);
        transition: var(--evoc-transition);
      }

      .evoc-footer-links a:hover {
        color: var(--evoc-primary);
        text-decoration: underline;
      }

      .evoc-session-id {
        color: var(--evoc-text-muted);
        font-family: monospace;
      }

      .evoc-powered-by {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        font-weight: 700;
        color: var(--evoc-text-secondary);
      }

      /* Saved addresses */
      .evoc-address-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 20px;
      }

      .evoc-address-card {
        border: 1.5px solid var(--evoc-border);
        border-radius: var(--evoc-radius-md);
        padding: 16px;
        cursor: pointer;
        background: white;
        transition: var(--evoc-transition);
        position: relative;
        display: flex;
        align-items: flex-start;
        gap: 12px;
        box-shadow: var(--evoc-shadow-sm);
      }

      .evoc-address-card:hover {
        border-color: var(--evoc-primary-light);
        transform: translateY(-1px);
      }

      .evoc-address-card.active {
        border-color: var(--evoc-primary);
        background: linear-gradient(135deg, #ffffff 0%, #f0f7ff 100%);
        box-shadow: 0 0 0 4px rgba(3, 169, 244, 0.12), var(--evoc-shadow-md);
      }

      .evoc-radio-outer {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid var(--evoc-border);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: 2px;
      }

      .evoc-address-card.active .evoc-radio-outer {
        border-color: var(--evoc-primary);
      }

      .evoc-radio-inner {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: transparent;
      }

      .evoc-address-card.active .evoc-radio-inner {
        background: var(--evoc-primary);
      }

      .evoc-address-content { flex: 1; }

      .evoc-address-name {
        font-size: 14px;
        font-weight: 700;
        color: var(--evoc-text);
        margin-bottom: 4px;
      }

      .evoc-address-text {
        font-size: 12.5px;
        color: var(--evoc-text-secondary);
        line-height: 1.4;
        margin-bottom: 6px;
      }

      .evoc-address-phone {
        font-size: 12px;
        color: var(--evoc-text-muted);
        font-weight: 600;
      }

      .evoc-btn-new-address {
        background: transparent;
        border: 1.5px dashed var(--evoc-border);
        border-radius: var(--evoc-radius-md);
        padding: 12px;
        width: 100%;
        color: var(--evoc-text-secondary);
        font-weight: 600;
        font-size: 13.5px;
        cursor: pointer;
        transition: var(--evoc-transition);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        margin-bottom: 20px;
      }

      .evoc-btn-new-address:hover {
        border-color: var(--evoc-primary);
        color: var(--evoc-primary);
        background: var(--evoc-accent);
      }

      /* Utilities */
      .evoc-hidden { display: none !important; }
      .evoc-mt-10 { margin-top: 10px; }
      .evoc-mt-15 { margin-top: 15px; }
      .evoc-mt-20 { margin-top: 20px; }
      .evoc-mb-20 { margin-bottom: 20px; }
      .evoc-text-center { text-align: center; }
      .evoc-text-green { color: var(--evoc-success) !important; }
      .evoc-text-blue { color: var(--evoc-primary) !important; }
      .evoc-text-red { color: var(--evoc-error) !important; }
      .evoc-text-bold { font-weight: 700; }
      .evoc-font-medium { font-weight: 500; }
      .evoc-py-18 { padding-top: 18px !important; padding-bottom: 18px !important; }

      /* Loading state */
      .evoc-loading {
        position: relative;
        pointer-events: none;
      }

      .evoc-loading::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 20px;
        height: 20px;
        margin: -10px 0 0 -10px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: evocSpin 0.8s linear infinite;
      }

      @keyframes evocSpin {
        to { transform: rotate(360deg); }
      }

      /* Responsive */
      @media (max-width: 480px) {
        .evoc-checkout-panel {
          width: 100vw;
          height: 100vh;
          max-height: 100vh;
          border-radius: 0;
          border: none;
        }

        .evoc-checkout-content {
          padding: 16px 20px;
        }

        .evoc-form-grid {
          grid-template-columns: 1fr;
        }

        .evoc-col-6 { grid-column: span 12; }
      }
    `;
  }

  /**
   * Build the checkout HTML content
   */
  function buildCheckoutHTML() {
    const items = sdkConfig.items || [];
    const itemCount = items.reduce((sum, item) => sum + (item.qty || 1), 0);
    const amount = sdkConfig.amount || calculateAmount(items);
    const originalAmount = amount * 2; // Demo strikethrough

    return `
      <!-- Checkout Panel -->
      <div class="evoc-checkout-panel">
        <header class="evoc-checkout-header">
          <div class="evoc-header-action"></div>
          <div class="evoc-merchant-name">${sdkConfig.merchantName || 'Evoc Labs'}</div>
          <div class="evoc-header-action"></div>
        </header>

        <div class="evoc-checkout-content">
          <!-- Order Summary -->
          <div class="evoc-card evoc-order-summary" id="evocOrderSummary">
            <div class="evoc-card-header" id="evocToggleSummary">
              <div class="evoc-summary-info">
                <span class="evoc-summary-title">
                  Order summary <span class="evoc-item-count">(${itemCount} Item${itemCount !== 1 ? 's' : ''})</span>
                </span>
                <div class="evoc-summary-prices">
                  <span class="evoc-old-price">₹${originalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  <span class="evoc-new-price" id="evocTotal">₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
              <span class="evoc-toggle-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </span>
            </div>
            <div class="evoc-order-drawer" id="evocOrderDrawer">
              <div class="evoc-drawer-inner" id="evocCartItems">
                ${items.map((item, idx) => `
                  <div class="evoc-cart-item" data-index="${idx}">
                    <div class="evoc-item-image">
                      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Crect fill='%23f5f5f5' width='80' height='80' rx='8'/%3E%3Ctext x='40' y='45' text-anchor='middle' fill='%23999' font-family='sans-serif' font-size='12'%3E${encodeURIComponent(item.name || 'Product')}%3C/text%3E%3C/svg%3E" alt="${item.name}">
                    </div>
                    <div class="evoc-item-details">
                      <h4 class="evoc-item-name">${item.name || 'Product'}</h4>
                      <div class="evoc-qty-control">
                        <button class="evoc-qty-btn evoc-qty-minus">-</button>
                        <span class="evoc-qty-val">${item.qty || 1}</span>
                        <button class="evoc-qty-btn evoc-qty-plus">+</button>
                      </div>
                    </div>
                    <div class="evoc-item-price-col">
                      <span class="evoc-item-price">₹${(item.price * (item.qty || 1)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      <button class="evoc-remove-btn evoc-remove-item">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
                      </button>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <!-- Coupon -->
          <div class="evoc-card">
            <div class="evoc-coupon-wrapper">
              <span class="evoc-coupon-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
              </span>
              <input type="text" class="evoc-coupon-input" id="evocCouponCode" placeholder="Enter coupon code">
              <button class="evoc-apply-btn" id="evocApplyCoupon">Apply</button>
            </div>
            <div class="evoc-coupon-message" id="evocCouponMessage"></div>
          </div>

          <!-- Workflow Steps -->
          <div class="evoc-workflow">
            <!-- Step: Mobile -->
            <div class="evoc-card evoc-step-card active" id="evocStepMobile">
              <div class="evoc-step-header">
                <h3 class="evoc-step-title">Enter mobile number</h3>
                <p class="evoc-step-subtitle">Provide your mobile number to continue</p>
              </div>
              <div class="evoc-mobile-container">
                <div class="evoc-country-picker">
                  <span>🇮🇳</span>
                  <span>+91</span>
                </div>
                <input type="tel" class="evoc-tel-input" id="evocMobileNumber" placeholder="10-digit mobile number" maxlength="10">
              </div>
              <div class="evoc-error" id="evocMobileError"></div>
              <button class="evoc-action-btn evoc-btn-primary mt-10" id="evocSendOtp">
                <span>Proceed to Verify</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
              </button>
            </div>

            <!-- Step: OTP -->
            <div class="evoc-card evoc-step-card" id="evocStepOtp">
              <div class="evoc-step-header">
                <h3 class="evoc-step-title">Verify mobile number</h3>
                <p class="evoc-step-subtitle">Enter the 4-digit OTP sent to <strong id="evocDisplayMobile">+91 99999 99999</strong></p>
              </div>
              <div class="evoc-otp-container">
                <input type="text" class="evoc-otp-box" maxlength="1" inputmode="numeric" pattern="[0-9]">
                <input type="text" class="evoc-otp-box" maxlength="1" inputmode="numeric" pattern="[0-9]">
                <input type="text" class="evoc-otp-box" maxlength="1" inputmode="numeric" pattern="[0-9]">
                <input type="text" class="evoc-otp-box" maxlength="1" inputmode="numeric" pattern="[0-9]">
              </div>
              <div class="evoc-error" id="evocOtpError"></div>
              <div class="evoc-otp-helper">
                <span>Didn't receive OTP?</span>
                <button class="evoc-resend-btn" id="evocResendOtp">Resend OTP</button>
              </div>
              <button class="evoc-action-btn evoc-btn-primary mt-15" id="evocVerifyOtp">
                <span>Verify & Continue</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </button>
              <button class="evoc-btn-back mt-10" id="evocBackToMobile">Change Mobile Number</button>
            </div>

            <!-- Step: Address -->
            <div class="evoc-card evoc-step-card" id="evocStepAddress">
              <div class="evoc-step-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                <h3 class="evoc-step-title">Delivery details</h3>
                <button class="evoc-change-btn" id="evocEditAddress">Change</button>
              </div>
              <div class="evoc-address-display" id="evocAddressDisplay">
                <h4 class="evoc-recipient-name" id="evocDisplayRecipient">---</h4>
                <p class="evoc-full-address" id="evocDisplayAddress">Please enter your delivery address</p>
                <div class="evoc-contact-details">
                  <span class="evoc-contact-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"></path></svg>
                    <span id="evocDisplayPhone">---</span>
                  </span>
                  <span class="evoc-contact-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                    <span id="evocDisplayEmail">---</span>
                  </span>
                </div>
              </div>
              <div class="evoc-address-list" id="evocSavedAddresses"></div>
              <div class="evoc-form-grid evoc-hidden" id="evocAddressForm">
                <div class="evoc-form-group evoc-col-12">
                  <label>Address Type</label>
                  <select class="evoc-form-input" id="evocAddrType">
                    <option value="HOME" selected>🏠 Home</option>
                    <option value="WORK">🏢 Work</option>
                    <option value="OTHER">📍 Other</option>
                  </select>
                </div>
                <div class="evoc-form-group evoc-col-6">
                  <label>First Name *</label>
                  <input type="text" class="evoc-form-input" id="evocAddrFirstName" placeholder="Enter first name">
                </div>
                <div class="evoc-form-group evoc-col-6">
                  <label>Last Name *</label>
                  <input type="text" class="evoc-form-input" id="evocAddrLastName" placeholder="Enter last name">
                </div>
                <div class="evoc-form-group evoc-col-12">
                  <label>Flat, House No, Building *</label>
                  <input type="text" class="evoc-form-input" id="evocAddrFlat" placeholder="Enter flat/house/building">
                </div>
                <div class="evoc-form-group evoc-col-12">
                  <label>Area, Street, Sector *</label>
                  <input type="text" class="evoc-form-input" id="evocAddrArea" placeholder="Enter area/street/sector">
                </div>
                <div class="evoc-form-group evoc-col-12">
                  <label>Landmark (Optional)</label>
                  <input type="text" class="evoc-form-input" id="evocAddrLandmark" placeholder="Enter landmark (optional)">
                </div>
                <div class="evoc-form-group evoc-col-6">
                  <label>City *</label>
                  <input type="text" class="evoc-form-input" id="evocAddrCity" placeholder="Enter city">
                </div>
                <div class="evoc-form-group evoc-col-6">
                  <label>State *</label>
                  <input type="text" class="evoc-form-input" id="evocAddrState" placeholder="Enter state">
                </div>
                <div class="evoc-form-group evoc-col-6">
                  <label>Pincode *</label>
                  <input type="text" class="evoc-form-input" id="evocAddrPincode" placeholder="6-digit pincode" maxlength="6">
                </div>
                <div class="evoc-form-group evoc-col-6">
                  <label>Receiver Phone *</label>
                  <input type="tel" class="evoc-form-input" id="evocAddrPhone" placeholder="10-digit mobile number" maxlength="10">
                </div>
                <div class="evoc-form-group evoc-col-12">
                  <label>Email ID *</label>
                  <input type="email" class="evoc-form-input" id="evocAddrEmail" placeholder="Enter email address">
                </div>
              </div>
              <button class="evoc-action-btn evoc-btn-secondary mt-10 evoc-hidden" id="evocSaveAddress">Save & Confirm</button>
              <div class="evoc-shipping-row">
                <span>🚚</span>
                <div>
                  <p class="evoc-delivery-text">Standard delivery: <strong id="evocDeliveryDate">${getDeliveryDate()}</strong></p>
                  <p class="evoc-delivery-promo">Free shipping for you</p>
                </div>
              </div>
              <div class="evoc-error" id="evocAddressError"></div>
              <button class="evoc-action-btn evoc-btn-primary mt-15" id="evocConfirmAddress">
                <span>Proceed to Payment</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
              </button>
            </div>

            <!-- Step: Payment -->
            <div class="evoc-card evoc-step-card" id="evocStepPayment">
              <div class="evoc-step-header">
                <h3 class="evoc-step-title">Pay via</h3>
              </div>
              <div class="evoc-payment-list" id="evocPaymentList">
                <!-- UPI -->
                <div class="evoc-payment-item evoc-upi-method active" id="evocMethodUPI" data-gateway="UPI">
                  <div class="evoc-method-header">
                    <div class="evoc-method-meta">
                      <span class="evoc-method-icon">⚡</span>
                      <div>
                        <span class="evoc-method-label">UPI payment</span>
                        <span class="evoc-method-subtext">Google Pay, PhonePe, Any UPI</span>
                      </div>
                    </div>
                    <span class="evoc-method-price" id="evocUpiPrice">₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    <span class="evoc-method-chevron"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg></span>
                  </div>
                  <div class="evoc-method-drawer" id="evocUpiDrawer" style="display: block;">
                    <p class="evoc-drawer-instruction">Scan the QR code & pay via any UPI app</p>
                    <div class="evoc-qr-container">
                      <div class="evoc-qr-wrapper">
                        <img id="evocUpiQr" src="" alt="UPI QR Code" style="width: 150px; height: 150px;">
                      </div>
                    </div>
                  </div>
                </div>

                <!-- COD -->
                <div class="evoc-payment-item" id="evocMethodCOD" data-gateway="COD">
                  <div class="evoc-method-header">
                    <div class="evoc-method-meta">
                      <span class="evoc-method-icon">💵</span>
                      <div>
                        <span class="evoc-method-label">Partial COD</span>
                        <span class="evoc-method-subtext">Pay <strong>₹80</strong> now, balance at delivery</span>
                      </div>
                    </div>
                    <span class="evoc-method-price">₹80.00</span>
                    <span class="evoc-method-chevron"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg></span>
                  </div>
                </div>

                <!-- Card -->
                <div class="evoc-payment-item" id="evocMethodCard" data-gateway="CARD">
                  <div class="evoc-method-header">
                    <div class="evoc-method-meta">
                      <span class="evoc-method-icon">💳</span>
                      <span class="evoc-method-label">Credit/Debit Card</span>
                    </div>
                    <span class="evoc-method-price">₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    <span class="evoc-method-chevron"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg></span>
                  </div>
                </div>
              </div>

              <div class="evoc-error" id="evocPaymentError"></div>
              <button class="evoc-action-btn evoc-btn-primary mt-20 evoc-py-18" id="evocSubmitPayment">
                <span>BUY NOW — <span id="evocPayBtnTotal">₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
              </button>
            </div>

            <!-- Success -->
            <div class="evoc-card evoc-step-card" id="evocStepSuccess">
              <div class="evoc-success-illustration">
                <div class="evoc-checkmark-circle">
                  <div class="evoc-checkmark"></div>
                </div>
              </div>
              <h3 class="evoc-step-title text-center evoc-text-green mt-15">Order Placed Successfully!</h3>
              <p class="evoc-step-subtitle text-center mb-20">Thank you for shopping with us.</p>
              <div class="evoc-receipt">
                <div class="evoc-receipt-row">
                  <span class="evoc-receipt-label">Session ID:</span>
                  <span class="evoc-receipt-value evoc-receipt-code" id="evocReceiptSessionId">---</span>
                </div>
                <div class="evoc-receipt-row">
                  <span class="evoc-receipt-label">Order Status:</span>
                  <span class="evoc-receipt-value evoc-text-green" id="evocReceiptStatus">COMPLETED</span>
                </div>
                <div class="evoc-receipt-row">
                  <span class="evoc-receipt-label">Amount Paid:</span>
                  <span class="evoc-receipt-value evoc-text-bold" id="evocReceiptAmount">₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
              <button class="evoc-action-btn evoc-btn-primary mt-20" id="evocResetCheckout">
                <span>Back to Start</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Trust Badges -->
        <div class="evoc-trust-badges">
          <div class="evoc-badge-item">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 12 2 2 4-4"></path></svg>
            <span>PCI DSS</span>
          </div>
          <div class="evoc-badge-item">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0110 0v4"></path></svg>
            <span>Secure</span>
          </div>
          <div class="evoc-badge-item">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
            <span>Insured</span>
          </div>
          <div class="evoc-badge-item">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            <span>Verified</span>
          </div>
        </div>

        <!-- Footer -->
        <footer class="evoc-footer">
          <div class="evoc-footer-links">
            <a href="#">T&C</a>
            <span>|</span>
            <a href="#">Privacy</a>
            <span>|</span>
            <span class="evoc-session-id" id="evocFooterSessionId">Session: Pending</span>
          </div>
          <div class="evoc-powered-by">
            <span>Powered By</span>
            <span style="font-weight: 800; color: var(--evoc-primary);">Evoc</span>
          </div>
        </footer>
      </div>
    `;
  }

  /**
   * Get delivery date string
   */
  function getDeliveryDate() {
    const date = new Date();
    date.setDate(date.getDate() + 3);
    return date.toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  /**
   * Update UPI QR code
   */
  function updateUpiQr() {
    if (!checkoutRoot) return;
    const qrImg = checkoutRoot.querySelector('#evocUpiQr');
    if (qrImg) {
      const amount = sdkConfig.amount || calculateAmount(sdkConfig.items || []);
      const upiVpa = sdkConfig.upiVpa || 'evoclabs@oksbi';
      const upiUrl = `upi://pay?pa=${upiVpa}&pn=Merchant&am=${amount.toFixed(2)}&cu=INR`;
      qrImg.src = `https://chart.googleapis.com/chart?chs=180x180&cht=qr&chl=${encodeURIComponent(upiUrl)}`;
    }
  }

  /**
   * Initialize checkout logic
   */
  function initCheckoutLogic() {
    if (!checkoutRoot) return;

    // State
    let sessionId = null;
    let currentStep = 'mobile';
    let currentAmount = sdkConfig.amount || calculateAmount(sdkConfig.items || []);
    let discountAmount = 0;
    let appliedCoupon = null;
    let userProfile = { phone: '', firstName: '', lastName: '', email: '', addresses: [] };
    let selectedAddressId = null;
    let isCreatingNewAddress = false;
    let currentPaymentMethod = 'UPI';

    const API_BASE_URL = sdkConfig.apiBaseUrl || '/api/v1';
    const STORE_ID = sdkConfig.storeId;

    // Helper: query within shadow DOM
    const $ = (sel) => checkoutRoot.querySelector(sel);
    const $$ = (sel) => checkoutRoot.querySelectorAll(sel);

    // Update total display
    function updateTotals() {
      const total = currentAmount - discountAmount;
      const formatted = `₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

      const totalEl = $('@evocTotal');
      const upiPriceEl = $('@evocUpiPrice');
      const payBtnTotalEl = $('@evocPayBtnTotal');

      if (totalEl) totalEl.textContent = formatted;
      if (upiPriceEl) upiPriceEl.textContent = formatted;

      // Update all payment method prices except COD
      $$('.evoc-payment-item').forEach(item => {
        const priceEl = item.querySelector('.evoc-method-price');
        if (priceEl && !item.id.includes('COD')) {
          priceEl.textContent = formatted;
        }
      });

      if (payBtnTotalEl) payBtnTotalEl.textContent = formatted;
      updateUpiQr();
    }

    // Step transition
    function transitionToStep(step) {
      currentStep = step;
      $$('.evoc-step-card').forEach(card => card.classList.remove('active'));
      const target = $(`#evocStep${step.charAt(0).toUpperCase() + step.slice(1)}`);
      if (target) target.classList.add('active');

      // Callback
      if (sdkConfig.callbacks.onStepChange) {
        sdkConfig.callbacks.onStepChange(step);
      }
    }

    // Button loading
    function setButtonLoading(btn, isLoading) {
      if (!btn) return;
      if (isLoading) {
        btn.disabled = true;
        btn.classList.add('evoc-loading');
        const span = btn.querySelector('span');
        if (span) span.dataset.original = span.textContent;
      } else {
        btn.disabled = false;
        btn.classList.remove('evoc-loading');
        const span = btn.querySelector('span');
        if (span && span.dataset.original) span.textContent = span.dataset.original;
      }
    }

    // Session initialization
    async function initSession() {
      const items = sdkConfig.items || [];

      try {
        const response = await fetch(`${API_BASE_URL}/checkout/init`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-store-id': STORE_ID
          },
          body: JSON.stringify({
            items: items.map(item => ({
              productId: `prod_${item.id}`,
              sku: `SKU-${item.id}`,
              name: item.name,
              price: item.price,
              quantity: item.qty || 1
            })),
            currency: sdkConfig.currency || 'INR',
            successUrl: sdkConfig.successUrl || window.location.href,
            cancelUrl: sdkConfig.cancelUrl || window.location.href
          })
        });

        const data = await response.json();
        if (data.success && data.data?.sessionId) {
          sessionId = data.data.sessionId;
          updateSessionDisplay();
        } else {
          sessionId = 'local_' + Date.now();
          updateSessionDisplay();
        }
      } catch (e) {
        sessionId = 'local_' + Date.now();
        updateSessionDisplay();
      }
    }

    function updateSessionDisplay() {
      const el = $('@evocFooterSessionId');
      if (el) el.textContent = `Session: ${sessionId ? sessionId.substring(0, 8) + '...' : 'Local'}`;
    }

    // OTP handlers
    async function handleSendOtp() {
      const mobileInput = $('@evocMobileNumber');
      const errorEl = $('@evocMobileError');
      const phone = mobileInput?.value.trim() || '';

      if (!/^\d{10}$/.test(phone)) {
        if (errorEl) errorEl.textContent = 'Please enter a valid 10-digit mobile number.';
        return;
      }

      if (errorEl) errorEl.textContent = '';
      userProfile.phone = '+91' + phone;

      const displayMob = $('@evocDisplayMobile');
      if (displayMob) displayMob.textContent = `+91 ${phone.substring(0, 5)} ${phone.substring(5)}`;

      const btn = $('@evocSendOtp');
      setButtonLoading(btn, true);

      try {
        await fetch(`${API_BASE_URL}/auth/otp/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-store-id': STORE_ID
          },
          body: JSON.stringify({ phone: userProfile.phone, sessionId })
        });
      } catch (e) {
        // Fallback: offline mode
      }

      setButtonLoading(btn, false);
      transitionToStep('otp');
      setTimeout(() => {
        const firstOtp = checkoutRoot.querySelector('.evoc-otp-box');
        if (firstOtp) firstOtp.focus();
      }, 300);
    }

    async function handleVerifyOtp() {
      const boxes = $$('.evoc-otp-box');
      const errorEl = $('@evocOtpError');
      let code = '';
      boxes.forEach(box => code += box.value);

      if (code.length !== 4) {
        if (errorEl) errorEl.textContent = 'Please enter the complete 4-digit OTP.';
        return;
      }

      if (errorEl) errorEl.textContent = '';
      const btn = $('@evocVerifyOtp');
      setButtonLoading(btn, true);

      try {
        const response = await fetch(`${API_BASE_URL}/auth/otp/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-store-id': STORE_ID
          },
          body: JSON.stringify({ phone: userProfile.phone, code, sessionId })
        });

        const data = await response.json();
        if (data.success) {
          transitionToStep('address');
        } else {
          if (code === '6666') {
            transitionToStep('address');
          } else if (errorEl) {
            errorEl.textContent = data.message || 'Invalid OTP. Enter 6666 for demo.';
          }
        }
      } catch (e) {
        // Offline fallback
        if (code === '6666') {
          transitionToStep('address');
        } else if (errorEl) {
          errorEl.textContent = 'Invalid OTP. Enter 6666 for demo.';
        }
      }

      setButtonLoading(btn, false);
    }

    // Address handlers
    function updateDisplayValues() {
      const recipientEl = $('@evocDisplayRecipient');
      const addressEl = $('@evocDisplayAddress');
      const phoneEl = $('@evocDisplayPhone');
      const emailEl = $('@evocDisplayEmail');

      if (recipientEl) {
        const name = `${userProfile.firstName} ${userProfile.lastName}`.trim();
        recipientEl.textContent = name || '---';
      }

      if (userProfile.addresses?.length > 0) {
        const addr = userProfile.addresses.find(a => a.id === selectedAddressId) || userProfile.addresses[0];
        if (addr && addressEl) {
          addressEl.textContent = `${addr.flatHouse}, ${addr.areaStreet}, ${addr.city}, ${addr.state}, ${addr.pincode}`;
        }
      }

      if (phoneEl) {
        const raw = (userProfile.phone || '').replace('+91', '').replace(/\D/g, '');
        phoneEl.textContent = raw.length === 10 ? `+91 ${raw.substring(0, 5)} ${raw.substring(5)}` : '---';
      }

      if (emailEl) emailEl.textContent = userProfile.email || '---';
    }

    async function handleSaveAddress() {
      const firstName = $('@evocAddrFirstName')?.value.trim() || '';
      const lastName = $('@evocAddrLastName')?.value.trim() || '';
      const flat = $('@evocAddrFlat')?.value.trim() || '';
      const area = $('@evocAddrArea')?.value.trim() || '';
      const city = $('@evocAddrCity')?.value.trim() || '';
      const state = $('@evocAddrState')?.value.trim() || '';
      const pincode = $('@evocAddrPincode')?.value.trim() || '';
      const receiverPhone = $('@evocAddrPhone')?.value.trim() || '';
      const email = $('@evocAddrEmail')?.value.trim() || '';

      if (!firstName || !flat || !area || !city || !state || !pincode) {
        const err = $('@evocAddressError');
        if (err) err.textContent = 'Please fill all mandatory fields.';
        return;
      }

      if (!/^\d{6}$/.test(pincode)) {
        const err = $('@evocAddressError');
        if (err) err.textContent = 'Please enter a valid 6-digit pincode.';
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        const err = $('@evocAddressError');
        if (err) err.textContent = 'Please enter a valid email address.';
        return;
      }

      userProfile.firstName = firstName;
      userProfile.lastName = lastName;
      userProfile.email = email;
      userProfile.addresses = [{
        id: 'draft_' + Date.now(),
        type: $('@evocAddrType')?.value || 'HOME',
        firstName, lastName, flatHouse: flat, areaStreet: area,
        city, state, pincode, receiversPhone: receiverPhone || userProfile.phone.replace('+91', '')
      }];
      selectedAddressId = userProfile.addresses[0].id;
      isCreatingNewAddress = false;

      updateDisplayValues();

      const addressForm = $('@evocAddressForm');
      const saveBtn = $('@evocSaveAddress');
      const editBtn = $('@evocEditAddress');

      if (addressForm) addressForm.classList.add('evoc-hidden');
      if (saveBtn) saveBtn.classList.add('evoc-hidden');
      if (editBtn) editBtn.textContent = 'Change';
    }

    async function handleConfirmAddress() {
      const errorEl = $('@evocAddressError');
      const btn = $('@evocConfirmAddress');

      // Validate we have an address
      if (!userProfile.addresses.length) {
        if (errorEl) errorEl.textContent = 'Please add a delivery address.';
        return;
      }

      setButtonLoading(btn, true);

      try {
        const response = await fetch(`${API_BASE_URL}/user/profile`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-store-id': STORE_ID
          },
          body: JSON.stringify({
            sessionId,
            email: userProfile.email,
            newAddress: {
              type: userProfile.addresses[0].type,
              firstName: userProfile.addresses[0].firstName,
              lastName: userProfile.addresses[0].lastName,
              flatHouse: userProfile.addresses[0].flatHouse,
              areaStreet: userProfile.addresses[0].areaStreet,
              city: userProfile.addresses[0].city,
              state: userProfile.addresses[0].state,
              receiversPhone: userProfile.addresses[0].receiversPhone,
              pincode: userProfile.addresses[0].pincode
            }
          })
        });

        const data = await response.json();
        if (data.success || response.status === 200) {
          transitionToStep('payment');
          updateUpiQr();
        } else {
          if (errorEl) errorEl.textContent = data.message || 'Failed to save address.';
        }
      } catch (e) {
        // Offline: proceed anyway
        transitionToStep('payment');
        updateUpiQr();
      }

      setButtonLoading(btn, false);
    }

    // Payment handlers
    function handlePaymentSelection(e) {
      const item = e.target.closest('.evoc-payment-item');
      if (!item || item.classList.contains('evoc-disabled')) return;

      $$('.evoc-payment-item').forEach(p => {
        p.classList.remove('active');
        const drawer = p.querySelector('.evoc-method-drawer');
        if (drawer) drawer.style.display = 'none';
      });

      item.classList.add('active');
      currentPaymentMethod = item.dataset.gateway || 'UPI';

      const drawer = item.querySelector('.evoc-method-drawer');
      if (drawer) drawer.style.display = 'block';
    }

    async function handleFinalizePayment() {
      const errorEl = $('@evocPaymentError');
      const btn = $('@evocSubmitPayment');

      if (!currentPaymentMethod) {
        if (errorEl) errorEl.textContent = 'Please select a payment method.';
        return;
      }

      setButtonLoading(btn, true);

      try {
        const response = await fetch(`${API_BASE_URL}/checkout/finalize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-store-id': STORE_ID
          },
          body: JSON.stringify({
            sessionId,
            paymentMethod: currentPaymentMethod === 'UPI' ? 'PAYU_V2' : currentPaymentMethod
          })
        });

        const data = await response.json();
        setButtonLoading(btn, false);

        if (data.success && data.data) {
          const intentData = data.data;

          if (intentData.status === 'PLACED' || currentPaymentMethod === 'COD') {
            showSuccess({ sessionId, status: 'PLACED', paymentMethod: currentPaymentMethod });
          } else if (intentData.paymentUrl) {
            // Redirect to payment gateway
            window.location.href = intentData.paymentUrl;
          } else {
            if (errorEl) errorEl.textContent = data.message || 'Payment failed.';
          }
        } else {
          if (errorEl) errorEl.textContent = data.message || 'Payment failed.';
        }
      } catch (e) {
        setButtonLoading(btn, false);
        if (errorEl) errorEl.textContent = 'Unable to connect to payment server.';
      }
    }

    // Success/Failure screens
    function showSuccess(orderData) {
      const receiptId = $('@evocReceiptSessionId');
      const receiptStatus = $('@evocReceiptStatus');
      const receiptAmount = $('@evocReceiptAmount');

      if (receiptId) receiptId.textContent = orderData.sessionId || sessionId;
      if (receiptStatus) {
        receiptStatus.textContent = orderData.status;
        receiptStatus.className = 'evoc-receipt-value ' + (orderData.status === 'PLACED' ? 'evoc-text-blue' : 'evoc-text-green');
      }
      if (receiptAmount) {
        const amount = currentAmount - discountAmount;
        receiptAmount.textContent = `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
      }

      transitionToStep('success');

      // Callback
      if (sdkConfig.callbacks.onSuccess) {
        sdkConfig.callbacks.onSuccess({
          sessionId: orderData.sessionId || sessionId,
          status: orderData.status,
          paymentMethod: orderData.paymentMethod,
          amount: currentAmount - discountAmount
        });
      }
    }

    // Reset
    function handleReset() {
      sessionId = null;
      userProfile = { phone: '', firstName: '', lastName: '', email: '', addresses: [] };
      selectedAddressId = null;
      isCreatingNewAddress = false;
      discountAmount = 0;
      appliedCoupon = null;
      currentAmount = sdkConfig.amount || calculateAmount(sdkConfig.items || []);

      // Clear form fields
      const mobileInput = $('@evocMobileNumber');
      if (mobileInput) mobileInput.value = '';
      $$('.evoc-otp-box').forEach(box => box.value = '');

      // Clear address form
      ['@evocAddrFirstName', '@evocAddrLastName', '@evocAddrFlat', '@evocAddrArea',
       '@evocAddrLandmark', '@evocAddrCity', '@evocAddrState', '@evocAddrPincode',
       '@evocAddrPhone', '@evocAddrEmail'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
      });

      updateTotals();
      initSession();
      transitionToStep('mobile');

      // Callback
      if (sdkConfig.callbacks.onClose) {
        sdkConfig.callbacks.onClose();
      }
    }

    // Coupon
    function handleApplyCoupon() {
      const input = $('@evocCouponCode');
      const msgEl = $('@evocCouponMessage');
      const code = input?.value.trim().toUpperCase();

      if (!code) {
        if (msgEl) {
          msgEl.textContent = 'Please enter a coupon code.';
          msgEl.className = 'evoc-coupon-message error';
        }
        return;
      }

      if (code === 'EVOC20') {
        discountAmount = currentAmount * 0.20;
        appliedCoupon = code;
        if (msgEl) {
          msgEl.textContent = '20% discount applied!';
          msgEl.className = 'evoc-coupon-message success';
        }
      } else if (code === 'EVOC50') {
        discountAmount = currentAmount * 0.50;
        appliedCoupon = code;
        if (msgEl) {
          msgEl.textContent = '50% discount applied!';
          msgEl.className = 'evoc-coupon-message success';
        }
      } else {
        if (msgEl) {
          msgEl.textContent = 'Invalid coupon code.';
          msgEl.className = 'evoc-coupon-message error';
        }
      }

      updateTotals();
    }

    // Toggle order summary
    function toggleOrderSummary() {
      const summary = $('@evocOrderSummary');
      if (summary) summary.classList.toggle('expanded');
    }

    // Event bindings
    $('@evocToggleSummary')?.addEventListener('click', toggleOrderSummary);
    $('@evocSendOtp')?.addEventListener('click', handleSendOtp);
    $('@evocVerifyOtp')?.addEventListener('click', handleVerifyOtp);
    $('@evocBackToMobile')?.addEventListener('click', () => transitionToStep('mobile'));
    $('@evocResendOtp')?.addEventListener('click', handleSendOtp);
    $('@evocEditAddress')?.addEventListener('click', () => {
      const addressForm = $('@evocAddressForm');
      const saveBtn = $('@evocSaveAddress');
      const editBtn = $('@evocEditAddress');

      isCreatingNewAddress = true;
      if (addressForm) addressForm.classList.remove('evoc-hidden');
      if (saveBtn) saveBtn.classList.remove('evoc-hidden');
      if (editBtn) editBtn.textContent = 'Cancel';
    });
    $('@evocSaveAddress')?.addEventListener('click', handleSaveAddress);
    $('@evocConfirmAddress')?.addEventListener('click', handleConfirmAddress);
    $('@evocApplyCoupon')?.addEventListener('click', handleApplyCoupon);

    // Payment selection
    const paymentList = $('@evocPaymentList');
    if (paymentList) {
      paymentList.addEventListener('click', handlePaymentSelection);
    }

    $('@evocSubmitPayment')?.addEventListener('click', handleFinalizePayment);
    $('@evocResetCheckout')?.addEventListener('click', handleReset);

    // OTP auto-navigation
    checkoutRoot.querySelectorAll('.evoc-otp-box').forEach((box, idx, boxes) => {
      box.addEventListener('input', (e) => {
        if (e.target.value.length === 1 && idx < boxes.length - 1) {
          boxes[idx + 1].focus();
        }
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && idx > 0) {
          boxes[idx - 1].focus();
        }
      });
    });

    // Initialize
    initSession();
    updateUpiQr();
  }

  /**
   * Public SDK API
   */
  const EVOC_CHECKOUT = {
    version: SDK_VERSION,

    /**
     * Initialize the checkout SDK
     * @param {Object} config - Configuration object
     * @param {string} config.storeId - Merchant store ID (required)
     * @param {string} [config.apiBaseUrl] - Backend API base URL
     * @param {number} [config.amount] - Total amount (auto-calculated from items if not provided)
     * @param {string} [config.currency] - Currency code (default: 'INR')
     * @param {Array} [config.items] - Cart items array
     * @param {string} [config.merchantName] - Merchant/store name for display
     * @param {string} [config.upiVpa] - UPI VPA for QR codes
     * @param {Object} [config.callbacks] - Callback functions
     * @param {Function} [config.callbacks.onSuccess] - Called on successful order
     * @param {Function} [config.callbacks.onFailure] - Called on payment failure
     * @param {Function} [config.callbacks.onClose] - Called when checkout is reset/closed
     * @param {Function} [config.callbacks.onStepChange] - Called when step changes
     */
    init: function(config = {}) {
      if (isInitialized) {
        console.warn('EVOC_CHECKOUT: Already initialized. Call destroy() first.');
        return this;
      }

      try {
        validateConfig(config);
        sdkConfig = deepMerge(DEFAULT_CONFIG, config);
        sdkConfig.callbacks = deepMerge(DEFAULT_CONFIG.callbacks, config.callbacks || {});

        const wrapper = createShadowContainer('evoc-checkout');
        wrapper.innerHTML = buildCheckoutHTML();

        // Initialize checkout logic after DOM is ready
        setTimeout(() => initCheckoutLogic(), 0);

        isInitialized = true;
        console.log(`EVOC_CHECKOUT v${SDK_VERSION} initialized`);

      } catch (error) {
        console.error('EVOC_CHECKOUT init error:', error.message);
        throw error;
      }

      return this;
    },

    /**
     * Update configuration at runtime
     */
    updateConfig: function(newConfig) {
      if (!isInitialized) {
        console.warn('EVOC_CHECKOUT: Not initialized yet.');
        return this;
      }
      sdkConfig = deepMerge(sdkConfig, newConfig);
      return this;
    },

    /**
     * Get current SDK version
     */
    getVersion: function() {
      return SDK_VERSION;
    },

    /**
     * Check if SDK is initialized
     */
    isInitialized: function() {
      return isInitialized;
    },

    /**
     * Get current session ID
     */
    getSessionId: function() {
      // Could be exposed if needed
      return null;
    },

    /**
     * Destroy the SDK instance
     */
    destroy: function() {
      const container = document.getElementById('evoc-checkout');
      if (container && container.shadowRoot) {
        container.shadowRoot.innerHTML = '';
      }
      isInitialized = false;
      sdkConfig = {};
      checkoutRoot = null;
      return this;
    }
  };

  // Expose to global
  global.EVOC_CHECKOUT = EVOC_CHECKOUT;

  // Also support AMD/CommonJS if available
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = EVOC_CHECKOUT;
  } else if (typeof define === 'function' && define.amd) {
    define([], function() { return EVOC_CHECKOUT; });
  }

})(typeof window !== 'undefined' ? window : this);