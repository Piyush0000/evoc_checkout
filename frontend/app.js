"use strict";
/**
 * Evoc Labs Centralized Premium Checkout - Dynamic Core Integration
 * TypeScript Implementation
 */
// Configuration
// Configuration — apiBaseUrl can be injected by the host storefront via window.EVOC_CONFIG
const _apiBaseUrl = (window.EVOC_CONFIG && window.EVOC_CONFIG.apiBaseUrl) || '/api/v1';
const API_BASE_URL = _apiBaseUrl;
const STORE_ID = 'store_123'; // Default tenant store seeded in backend
// Application State
let sessionId = null;
let currentStep = 'mobile';
let originalTotal = 6998.00;
let discountAmount = 0.00;
let finalTotal = 6998.00;
let appliedCoupon = null;
let cartItems = [
    { id: 1, name: "Moonstruck MegaMixer 1000W", price: 3499.00, qty: 2, originalPrice: 6999.00 }
];
let userProfile = {
    phone: '',
    firstName: '',
    lastName: '',
    email: '',
    addresses: []
};
// State trackers for address selections
let selectedAddressId = null;
let isCreatingNewAddress = false;
let activeGateways = [];
let currentPaymentMethod = null;

// Debounce helper for reducing API calls
let lastSyncTime = 0;
const MIN_SYNC_INTERVAL = 2000; // 2 seconds minimum between syncs
function shouldDebounceSync() {
    const now = Date.now();
    if (now - lastSyncTime < MIN_SYNC_INTERVAL) {
        return true;
    }
    lastSyncTime = now;
    return false;
}

// Initialize when DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    initOtpNavigation();
    initCheckoutSession();
});
// Setup event listeners
function setupEventListeners() {
    // Accordion drawer toggle
    const toggleBtn = document.getElementById('toggleOrderSummary');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleOrderSummaryDrawer);
    }
    // Coupon code logic
    const applyBtn = document.getElementById('applyCouponBtn');
    if (applyBtn) {
        applyBtn.addEventListener('click', applyCouponCode);
    }
    // Step event handlers
    document.getElementById('sendOtpBtn')?.addEventListener('click', handleSendOtp);
    document.getElementById('verifyOtpBtn')?.addEventListener('click', handleVerifyOtp);
    document.getElementById('backToMobileBtn')?.addEventListener('click', () => transitionToStep('mobile'));
    document.getElementById('resendOtpBtn')?.addEventListener('click', handleSendOtp);
    // Address steps
    document.getElementById('editAddressBtn')?.addEventListener('click', handleAddressChangeClick);
    document.getElementById('saveAddressBtn')?.addEventListener('click', saveAddressDetails);
    document.getElementById('confirmAddressBtn')?.addEventListener('click', confirmAddressDetails);
    // Payments and Finalization
    document.getElementById('submitPaymentBtn')?.addEventListener('click', finalizeCheckoutPayment);
    // Simulator Modal Actions (removed - using real payment gateway)
    // Success Reset
    document.getElementById('resetCheckoutBtn')?.addEventListener('click', resetCheckoutWorkflow);
}
// Reset workflow
function resetCheckoutWorkflow() {
    console.log('[DEBUG] resetCheckoutWorkflow triggered');
    sessionId = null;
    localStorage.removeItem('evoc_checkout_session_id');
    appliedCoupon = null;
    discountAmount = 0;
    selectedAddressId = null;
    isCreatingNewAddress = false;
    userProfile = {
        phone: '',
        firstName: '',
        lastName: '',
        email: '',
        addresses: []
    };
    cartItems = [
        { id: 1, name: "Moonstruck MegaMixer 1000W", price: 3499.00, qty: 2, originalPrice: 6999.00 }
    ];
    recalculateCart();
    transitionToStep('mobile');
    const mobileInput = document.getElementById('mobileNumber');
    if (mobileInput) {
        mobileInput.value = '';
    }
    document.querySelectorAll('.otp-box').forEach(box => {
        box.value = '';
    });
    // Clear address form fields
    document.getElementById('addrType').value = 'HOME';
    document.getElementById('addrFirstName').value = '';
    document.getElementById('addrLastName').value = '';
    document.getElementById('addrFlat').value = '';
    document.getElementById('addrArea').value = '';
    document.getElementById('addrLandmark').value = '';
    document.getElementById('addrCity').value = '';
    document.getElementById('addrState').value = '';
    document.getElementById('addrPincode').value = '';
    document.getElementById('addrPhone').value = '';
    document.getElementById('addrEmail').value = '';
    // Clear display values
    document.getElementById('displayRecipient').textContent = '---';
    document.getElementById('displayFullAddress').textContent = 'Please enter your delivery address';
    document.getElementById('displayPhone').textContent = '---';
    document.getElementById('displayEmail').textContent = '---';
    initCheckoutSession();
}
// Session Initializer (Safe fallbacks for Offline Mode)
async function initCheckoutSession() {
    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);
    const paramSessionId = params.get('sessionId');

    // Check sessionStorage for return from payment gateway
    const pendingPaymentStr = sessionStorage.getItem('evoc_pending_payment');
    if (pendingPaymentStr) {
        try {
            const pendingData = JSON.parse(pendingPaymentStr);
            console.log('[INIT] Returning from payment gateway:', pendingData);
            sessionStorage.removeItem('evoc_pending_payment');
            sessionId = pendingData.sessionId;
            localStorage.setItem('evoc_checkout_session_id', sessionId);
            await checkPaymentStatus(pendingData.txnId, pendingData.paymentMethod, 0);
            return;
        } catch (e) {
            sessionStorage.removeItem('evoc_pending_payment');
        }
    }

    // Check for success/failure redirect from payment gateway
    const urlStatus = params.get('status');
    const urlReason = params.get('reason');

    // Handle successful payment redirect
    if (paramSessionId && (urlStatus === 'success' || window.location.pathname.includes('/success'))) {
        console.log('[INIT] Payment successful redirect detected');
        sessionId = paramSessionId;
        await checkPaymentStatus(paramSessionId, currentPaymentMethod || 'PAYU_V2');
        return;
    }

    // Handle failed/cancelled payment redirect
    if (urlStatus === 'failure' || urlStatus === 'cancel' || urlReason) {
        console.log('[INIT] Payment failure/cancel redirect detected:', urlReason);
        sessionId = paramSessionId || localStorage.getItem('evoc_checkout_session_id');
        if (sessionId) {
            showFailureScreen({ reason: urlReason || 'payment_failed' });
        }
        return;
    }

    if (paramSessionId) {
        console.log(`[INIT] Found session from URL: ${paramSessionId}`);
        sessionId = paramSessionId;
        localStorage.setItem('evoc_checkout_session_id', sessionId);
        await syncSessionState();
        return;
    }

    const storedSessionId = localStorage.getItem('evoc_checkout_session_id');
    if (storedSessionId) {
        console.log(`[INIT] Found active session in storage: ${storedSessionId}`);
        sessionId = storedSessionId;
        await syncSessionState();
        return;
    }
    try {
        const payload = {
            items: cartItems.map(item => ({
                productId: `prod_mixer_${item.id}`,
                sku: `SKU-MEGAMIXER-${item.id}000`,
                name: item.name,
                price: item.price,
                quantity: item.qty
            })),
            currency: 'INR',
            successUrl: window.location.origin + '/index.html',
            cancelUrl: window.location.origin + '/index.html'
        };
        const response = await fetch(`${API_BASE_URL}/checkout/init`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-store-id': STORE_ID
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.success && data.data && data.data.sessionId) {
            sessionId = data.data.sessionId;
            localStorage.setItem('evoc_checkout_session_id', sessionId);
            updateSessionDisplay(sessionId);
            console.log('[INIT] New checkout session initialized successfully:', sessionId);
            await syncSessionState();
        }
        else {
            useFallbackSession();
        }
    }
    catch (error) {
        console.warn('[INIT] Backend connection failed, using fallback offline mode.', error);
        useFallbackSession();
    }
}
// Sync current session state from backend summary
async function syncSessionState() {
    if (!sessionId)
        return;
    // Debounce frequent syncs to reduce server load
    if (shouldDebounceSync()) {
        console.log('[SYNC] Skipping sync - too soon since last request');
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/checkout/summary/${sessionId}`, {
            headers: {
                'x-store-id': STORE_ID
            }
        });

        // Handle expired session (410 Gone)
        if (response.status === 410) {
            console.warn('[SYNC] Session expired, resetting checkout');
            resetCheckoutWorkflow();
            alert('Your checkout session has expired. Please start a new checkout.');
            return;
        }

        if (response.status === 404) {
            console.warn('[SYNC] Session not found, resetting checkout');
            resetCheckoutWorkflow();
            return;
        }

        const data = await response.json();
        if (data.success && data.data) {
            const state = data.data;
            console.log('[SYNC] Synced session state:', state);
            // Render merchant name dynamically
            const merchantNameEls = document.querySelectorAll('.brand-logo-container');
            merchantNameEls.forEach(el => {
                el.innerHTML = `<span style="font-size: 20px; font-weight: 800; color: var(--text-primary); letter-spacing: -0.5px;">${state.merchantName}</span>`;
            });
            // Update total price and cart
            originalTotal = state.totalAmount;
            recalculateCart();
            // Update enabled gateways (filter COD based on amount if backend didn't)
            const COD_MAX_AMOUNT = 15000; // Match backend MAX_COD_AMOUNT
            activeGateways = (state.paymentProviders || []).map(gw => {
                if (gw.name === 'COD' && state.totalAmount > COD_MAX_AMOUNT) {
                    return { ...gw, disabled: true, disabledReason: `COD not available for orders above ₹${COD_MAX_AMOUNT.toLocaleString()}` };
                }
                return gw;
            });
            // Restore user details
            if (state.user) {
                userProfile.id = state.user.id;
                userProfile.phone = state.user.phone;
                userProfile.firstName = state.user.firstName || '';
                userProfile.lastName = state.user.lastName || '';
                userProfile.email = state.user.email || '';
                userProfile.addresses = state.user.addresses || [];
                const displayMob = document.getElementById('displayMobile');
                if (displayMob) {
                    const raw = (state.user.phone || '').replace('+91', '');
                    displayMob.textContent = raw.length === 10 ? `+91 ${raw.substring(0, 5)} ${raw.substring(5)}` : (state.user.phone || '');
                }
            }
            // Route to correct step depending on session state
            if (state.status === 'PENDING_AUTH') {
                transitionToStep('mobile');
            }
            else if (state.status === 'AUTHENTICATED') {
                renderAddresses();
                transitionToStep('address');
            }
            else if (state.status === 'ADDRESS_CONFIRMED') {
                renderGatewaysList();
                transitionToStep('payment');
            }
            else if (state.status === 'PAYMENT_PENDING') {
                // Payment pending — user should continue from gateway popup
                renderGatewaysList();
                transitionToStep('payment');
            }
            else if (state.status === 'COMPLETED' || state.status === 'PLACED') {
                showSuccessScreen({
                    sessionId: state.id,
                    status: state.status,
                    paymentMethod: state.transaction?.paymentMethod || 'COD'
                });
            }
            else {
                // Session expired, failed, or unknown state - reset
                console.warn('[SYNC] Session in unexpected state:', state.status, '- resetting flow');
                resetCheckoutWorkflow();
                alert('Your checkout session has expired. Starting fresh checkout.');
            }
        }
    }
    catch (e) {
        console.error('[SYNC] Failed to fetch session summary from backend:', e);
    }
}
// Fallback session helper
function useFallbackSession() {
    sessionId = '907517dc-fa43-4aed-98c8-53098edf464e';
    localStorage.setItem('evoc_checkout_session_id', sessionId);
    updateSessionDisplay(sessionId);
    console.log('[INIT] Fallback Offline Session Initialized:', sessionId);
    // Render default providers in offline mode (using local assets)
    activeGateways = [
        { name: 'COD', type: 'COD', image: 'assets/cod_icon.png', description: 'Pay cash when your order is delivered' },
        { name: 'Razorpay', type: 'UPI', image: 'assets/razorpay_logo.png', description: 'Pay via Google Pay, PhonePe, or Any UPI App' },
        { name: 'PayU', type: 'CARD', image: 'assets/payu_logo.svg', description: 'Credit/Debit Cards and Netbanking' }
    ];
}
function updateSessionDisplay(id) {
    const footerEl = document.getElementById('footerSessionId');
    if (footerEl)
        footerEl.textContent = `Session: ${id.substring(0, 8)}...`;
    const receiptEl = document.getElementById('receiptSessionId');
    if (receiptEl)
        receiptEl.textContent = id;
}
// Recalculate cart prices
function recalculateCart() {
    if (cartItems.length === 0) {
        const inner = document.querySelector('.drawer-inner');
        if (inner) {
            inner.innerHTML = `
        <div class="text-center py-20 text-secondary">
          <p>Your cart is empty</p>
        </div>
      `;
        }
        originalTotal = 0;
        const countEl = document.querySelector('.item-count');
        if (countEl)
            countEl.textContent = '(0 Items)';
    }
    else {
        originalTotal = cartItems.reduce((acc, i) => acc + (i.price * i.qty), 0);
        const count = cartItems.reduce((acc, i) => acc + i.qty, 0);
        const countEl = document.querySelector('.item-count');
        if (countEl)
            countEl.textContent = `(${count} Item${count > 1 ? 's' : ''})`;
    }
    if (appliedCoupon === 'EVOC20') {
        discountAmount = originalTotal * 0.20;
    }
    else if (appliedCoupon === 'EVOC50') {
        discountAmount = originalTotal * 0.50;
    }
    else {
        discountAmount = 0;
    }
    finalTotal = originalTotal - discountAmount;
    const formattedOriginal = '₹' + (originalTotal * 2).toFixed(2);
    const formattedFinal = '₹' + finalTotal.toFixed(2);
    const oldPriceEl = document.querySelector('.summary-prices .old-price');
    if (oldPriceEl)
        oldPriceEl.textContent = formattedOriginal;
    const sumTotalEl = document.getElementById('summaryTotal');
    if (sumTotalEl)
        sumTotalEl.textContent = formattedFinal;
    const upiPriceEl = document.getElementById('upiPrice');
    if (upiPriceEl)
        upiPriceEl.textContent = formattedFinal;
    const paymentMethods = document.querySelectorAll('.payment-method-item .method-price');
    paymentMethods.forEach(priceSpan => {
        if (!priceSpan.closest('#methodCOD')) {
            priceSpan.textContent = formattedFinal;
        }
    });
    const payBtnTotal = document.getElementById('paymentSubmitBtnTotal');
    if (payBtnTotal)
        payBtnTotal.textContent = formattedFinal;
    updateUpiQrCode();
}
function updateUpiQrCode() {
    const realQrImg = document.getElementById('realUpiQr');
    if (realQrImg) {
        const upiUrl = `upi://pay?pa=evoclabs@oksbi&pn=Evoc%20Labs&am=${finalTotal.toFixed(2)}&cu=INR`;
        realQrImg.src = `https://chart.googleapis.com/chart?chs=180x180&cht=qr&chl=${encodeURIComponent(upiUrl)}`;
    }
}
// Coupon system
function applyCouponCode() {
    const codeEl = document.getElementById('couponCode');
    if (!codeEl)
        return;
    const code = codeEl.value.trim().toUpperCase();
    if (!code) {
        showCouponMessage('Please enter a coupon code.', 'error');
        return;
    }
    if (code === 'EVOC20' || code === 'EVOC50') {
        appliedCoupon = code;
        recalculateCart();
        const discountPercent = code === 'EVOC20' ? '20%' : '50%';
        showCouponMessage(`🎉 Coupon code "${code}" applied! You saved ${discountPercent}.`, 'success');
    }
    else {
        showCouponMessage('Invalid coupon code. Try "EVOC20" or "EVOC50".', 'error');
    }
}
function showCouponMessage(text, type) {
    const msgEl = document.getElementById('couponMessage');
    if (msgEl) {
        msgEl.textContent = text;
        msgEl.className = 'coupon-message ' + type;
    }
}
function toggleOrderSummaryDrawer() {
    const summaryCard = document.querySelector('.order-summary-card');
    if (summaryCard) {
        summaryCard.classList.toggle('expanded');
    }
}
// Step Transitions
function transitionToStep(targetStep) {
    currentStep = targetStep;
    // Deactivate all cards
    const cards = document.querySelectorAll('.workflow-card');
    cards.forEach(card => card.classList.remove('active'));
    // Activate target card
    const targetCard = document.getElementById('step' + capitalizeFirstLetter(targetStep));
    if (targetCard) {
        targetCard.classList.add('active');
    }
}
function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
function setButtonLoading(buttonEl, isLoading) {
    if (!buttonEl)
        return;
    const span = buttonEl.querySelector('span');
    if (!span)
        return;
    if (isLoading) {
        buttonEl.disabled = true;
        buttonEl.dataset.originalText = span.textContent || '';
        span.textContent = 'Loading...';
        buttonEl.classList.add('loading');
    }
    else {
        buttonEl.disabled = false;
        if (buttonEl.dataset.originalText) {
            span.textContent = buttonEl.dataset.originalText;
        }
        buttonEl.classList.remove('loading');
    }
}
// Step 1: Mobile verification
async function handleSendOtp() {
    const mobileInput = document.getElementById('mobileNumber');
    if (!mobileInput)
        return;
    const phoneInput = mobileInput.value.trim();
    const errorEl = document.getElementById('mobileError');
    if (!errorEl)
        return;
    const phoneDigits = phoneInput.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
        errorEl.textContent = 'Please enter a valid 10-digit mobile number.';
        return;
    }
    errorEl.textContent = '';
    userProfile.phone = '+91' + phoneDigits;
    const displayMob = document.getElementById('displayMobile');
    if (displayMob) {
        displayMob.textContent = `+91 ${phoneDigits.substring(0, 5)} ${phoneDigits.substring(5)}`;
    }
    const sendBtn = document.getElementById('sendOtpBtn');
    setButtonLoading(sendBtn, true);
    try {
        const response = await fetch(`${API_BASE_URL}/auth/otp/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-store-id': STORE_ID
            },
            body: JSON.stringify({
                phone: userProfile.phone,
                sessionId: sessionId
            })
        });
        const data = await response.json();
        setButtonLoading(sendBtn, false);
        if (data.success) {
            console.log('OTP sent successfully. Mock OTP is 6666');
            transitionToStep('otp');
            setTimeout(() => {
                document.querySelector('.otp-box')?.focus();
            }, 300);
        }
        else {
            console.warn('API error, falling back to offline OTP simulation');
            transitionToStep('otp');
        }
    }
    catch (error) {
        setButtonLoading(sendBtn, false);
        console.warn('Backend offline, proceeding in simulated OTP mode (Code: 6666)');
        transitionToStep('otp');
    }
}
// OTP Auto focus/navigation
function initOtpNavigation() {
    const boxes = document.querySelectorAll('.otp-box');
    boxes.forEach((box, idx) => {
        box.addEventListener('input', (e) => {
            const val = e.target.value;
            if (val.length === 1 && idx < boxes.length - 1) {
                boxes[idx + 1].focus();
            }
        });
        box.addEventListener('keydown', (e) => {
            const keyEvent = e;
            if (keyEvent.key === 'Backspace' && !box.value && idx > 0) {
                boxes[idx - 1].focus();
            }
        });
    });
}
// Verify OTP
async function handleVerifyOtp() {
    const boxes = document.querySelectorAll('.otp-box');
    const errorEl = document.getElementById('otpError');
    if (!errorEl)
        return;
    let code = '';
    boxes.forEach(box => code += box.value.trim());
    if (code.length !== 4) {
        errorEl.textContent = 'Please enter the complete 4-digit OTP code.';
        return;
    }
    errorEl.textContent = '';
    const verifyBtn = document.getElementById('verifyOtpBtn');
    setButtonLoading(verifyBtn, true);
    try {
        const response = await fetch(`${API_BASE_URL}/auth/otp/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-store-id': STORE_ID
            },
            body: JSON.stringify({
                phone: userProfile.phone,
                code: code,
                sessionId: sessionId
            })
        });
        const data = await response.json();
        setButtonLoading(verifyBtn, false);
        if (data.success) {
            console.log('OTP verified successfully!');
            await syncSessionState();
        }
        else {
            errorEl.textContent = data.message || 'Invalid OTP. Please enter code 6666.';
        }
    }
    catch (error) {
        setButtonLoading(verifyBtn, false);
        console.warn('Backend offline, running fallback OTP validation (Accepts: 6666)');
        if (code === '6666') {
            updateDisplayValues();
            transitionToStep('address');
        }
        else {
            errorEl.textContent = 'Invalid OTP code. Please enter 6666 to verify.';
        }
    }
}
function updateDisplayValues() {
    const displayRecip = document.getElementById('displayRecipient');
    if (displayRecip)
        displayRecip.textContent = `${userProfile.firstName} ${userProfile.lastName}`.trim() || '---';
    const displayPhone = document.getElementById('displayPhone');
    if (displayPhone) {
        const raw = (userProfile.phone || '').replace('+91', '').replace(/\D/g, '');
        displayPhone.textContent = raw.length === 10 ? `+91 ${raw.substring(0, 5)} ${raw.substring(5)}` : (userProfile.phone || '---');
    }
    const displayEmail = document.getElementById('displayEmail');
    if (displayEmail)
        displayEmail.textContent = userProfile.email || '---';
    const displayAddress = document.getElementById('displayFullAddress');
    if (displayAddress && userProfile.addresses && userProfile.addresses.length > 0) {
        const active = userProfile.addresses.find(a => a.id === selectedAddressId) || userProfile.addresses[0];
        if (active) {
            displayAddress.textContent = `${active.flatHouse}, ${active.areaStreet}, ${active.city}, ${active.state}, ${active.pincode}`;
        }
    }
}
// Render dynamic address list
function renderAddresses() {
    const addressDisplayBox = document.getElementById('addressDisplayBox');
    const addressEditForm = document.getElementById('addressEditForm');
    if (!addressDisplayBox || !addressEditForm)
        return;
    // Clear existing dynamically generated elements
    const containerId = 'savedAddressesContainer';
    let container = document.getElementById(containerId);
    if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        container.className = 'saved-addresses-list';
        addressDisplayBox.parentNode?.insertBefore(container, addressDisplayBox);
    }
    else {
        container.innerHTML = '';
    }
    // Clear any existing Add New button
    const newBtnId = 'btnNewAddressToggle';
    document.getElementById(newBtnId)?.remove();
    const hasSavedAddresses = userProfile.addresses && userProfile.addresses.length > 0;
    // Form toggles strictly depending on isCreatingNewAddress
    if (isCreatingNewAddress) {
        addressDisplayBox.classList.add('hidden');
        addressEditForm.classList.remove('hidden');
    }
    else if (hasSavedAddresses) {
        addressDisplayBox.classList.remove('hidden');
        addressEditForm.classList.add('hidden');
    }
    else {
        // No saved addresses -> Force form
        addressDisplayBox.classList.add('hidden');
        addressEditForm.classList.remove('hidden');
        isCreatingNewAddress = true;
        selectedAddressId = null;
    }
    // Render list of addresses if we have saved profiles
    if (hasSavedAddresses) {
        // Set default selected address ID if none set
        if (!selectedAddressId) {
            const firstAddr = userProfile.addresses[0];
            selectedAddressId = firstAddr?.id || 'mock_addr_0';
        }
        userProfile.addresses.forEach((addr, idx) => {
            const addrId = addr.id || `mock_addr_${idx}`;
            const card = document.createElement('div');
            const isActive = addrId === selectedAddressId;
            card.className = `saved-address-card ${isActive ? 'active' : ''}`;
            card.dataset.id = addrId;
            card.innerHTML = `
        <div class="radio-outer">
          <div class="radio-inner"></div>
        </div>
        <div class="address-card-content">
          <div class="address-card-name">${addr.firstName} ${addr.lastName}</div>
          <div class="address-card-text">${addr.flatHouse}, ${addr.areaStreet}, ${addr.city}, ${addr.state} - ${addr.pincode}</div>
          <div class="address-card-phone">📞 ${addr.receiversPhone}</div>
        </div>
      `;
            card.addEventListener('click', () => {
                selectedAddressId = addrId;
                isCreatingNewAddress = false;
                // Populate form fields with selected address data
                document.getElementById('addrType').value = addr.type || 'HOME';
                document.getElementById('addrFirstName').value = addr.firstName || '';
                document.getElementById('addrLastName').value = addr.lastName || '';
                document.getElementById('addrFlat').value = addr.flatHouse || '';
                document.getElementById('addrArea').value = addr.areaStreet || '';
                document.getElementById('addrLandmark').value = addr.landmark || '';
                document.getElementById('addrCity').value = addr.city || '';
                document.getElementById('addrState').value = addr.state || '';
                document.getElementById('addrPincode').value = addr.pincode || '';
                document.getElementById('addrPhone').value = addr.receiversPhone || '';
                document.getElementById('addrEmail').value = userProfile.email || '';
                renderAddresses();
                updateDisplayValues();
            });
            // Auto-select first address and populate form
            if (idx === 0 && !selectedAddressId) {
                selectedAddressId = addrId;
                document.getElementById('addrType').value = addr.type || 'HOME';
                document.getElementById('addrFirstName').value = addr.firstName || '';
                document.getElementById('addrLastName').value = addr.lastName || '';
                document.getElementById('addrFlat').value = addr.flatHouse || '';
                document.getElementById('addrArea').value = addr.areaStreet || '';
                document.getElementById('addrLandmark').value = addr.landmark || '';
                document.getElementById('addrCity').value = addr.city || '';
                document.getElementById('addrState').value = addr.state || '';
                document.getElementById('addrPincode').value = addr.pincode || '';
                document.getElementById('addrPhone').value = addr.receiversPhone || '';
                document.getElementById('addrEmail').value = userProfile.email || '';
            }
            container?.appendChild(card);
        });
        // Append a toggle button to add a new address
        const newBtn = document.createElement('button');
        newBtn.id = newBtnId;
        newBtn.className = 'btn-new-address';
        newBtn.innerHTML = '<span>➕ Add New Delivery Address</span>';
        newBtn.addEventListener('click', () => {
            isCreatingNewAddress = true;
            selectedAddressId = null;
            // Clear inputs for fresh address
            document.getElementById('addrType').value = 'HOME';
            document.getElementById('addrFirstName').value = '';
            document.getElementById('addrLastName').value = '';
            document.getElementById('addrFlat').value = '';
            document.getElementById('addrArea').value = '';
            document.getElementById('addrLandmark').value = '';
            document.getElementById('addrPincode').value = '';
            document.getElementById('addrCity').value = '';
            document.getElementById('addrState').value = '';
            document.getElementById('addrPhone').value = '';
            document.getElementById('addrEmail').value = '';
            renderAddresses(); // Refresh layout to show edit form
        });
        // Insert toggle button above the addressEditForm
        addressEditForm.parentNode?.insertBefore(newBtn, addressEditForm);
    }
}
// Handle Address edit click
function handleAddressChangeClick() {
    const box = document.getElementById('addressDisplayBox');
    const form = document.getElementById('addressEditForm');
    const editLink = document.getElementById('editAddressBtn');
    if (!box || !form || !editLink)
        return;
    if (form.classList.contains('hidden') || !isCreatingNewAddress) {
        isCreatingNewAddress = true;
        editLink.textContent = 'Cancel';
    }
    else {
        isCreatingNewAddress = false;
        editLink.textContent = 'Change';
    }
    renderAddresses();
}
// Save address locally (for draft/visual state)
function saveAddressDetails() {
    const addrType = document.getElementById('addrType')?.value || 'HOME';
    const fName = document.getElementById('addrFirstName').value.trim();
    const lName = document.getElementById('addrLastName').value.trim();
    const flat = document.getElementById('addrFlat').value.trim();
    const area = document.getElementById('addrArea').value.trim();
    const landmark = document.getElementById('addrLandmark')?.value.trim() || '';
    const city = document.getElementById('addrCity').value.trim();
    const state = document.getElementById('addrState').value.trim();
    const pincode = document.getElementById('addrPincode').value.trim();
    const receiverPhone = document.getElementById('addrPhone')?.value.trim() || '';
    const email = document.getElementById('addrEmail')?.value.trim() || '';

    // Basic validation
    if (!fName || !flat || !area || !city || !state || !pincode) {
        alert('Please fill all mandatory address details.');
        return;
    }
    if (!/^\d{6}$/.test(pincode)) {
        alert('Please enter a valid 6-digit pincode.');
        return;
    }
    if (receiverPhone && !/^\d{10}$/.test(receiverPhone.replace(/\D/g, ''))) {
        alert('Please enter a valid 10-digit receiver phone.');
        return;
    }

    userProfile.firstName = fName;
    userProfile.lastName = lName;
    userProfile.email = email;

    // Create a local draft address
    const draftAddress = {
        id: 'draft_address_id',
        type: addrType,
        firstName: fName,
        lastName: lName,
        flatHouse: flat,
        areaStreet: area,
        landmark: landmark || null,
        city,
        state,
        pincode,
        receiversPhone: receiverPhone || userProfile.phone.replace('+91', '')
    };
    // Switch back to displays
    userProfile.addresses = [draftAddress];
    selectedAddressId = 'draft_address_id';
    isCreatingNewAddress = false;
    updateDisplayValues();
    const editLink = document.getElementById('editAddressBtn');
    if (editLink) {
        editLink.textContent = 'Change';
    }
    renderAddresses();
}
// Confirm Profile & Address (API Post)
async function confirmAddressDetails() {
    const confirmBtn = document.getElementById('confirmAddressBtn');
    setButtonLoading(confirmBtn, true);
    const errorEl = document.getElementById('addressError');
    if (errorEl)
        errorEl.textContent = '';
    const emailInput = document.getElementById('addrEmail');
    const email = emailInput ? emailInput.value.trim() : (userProfile.email || '');
    if (!email) {
        setButtonLoading(confirmBtn, false);
        if (errorEl)
            errorEl.textContent = 'Email address is required to proceed.';
        return;
    }
    let payload = {
        sessionId: sessionId,
        email: email
    };
    if (isCreatingNewAddress || selectedAddressId === 'draft_address_id' || !selectedAddressId) {
        const addrType = document.getElementById('addrType')?.value || 'HOME';
        const fName = document.getElementById('addrFirstName').value.trim();
        const lName = document.getElementById('addrLastName').value.trim();
        const flat = document.getElementById('addrFlat').value.trim();
        const area = document.getElementById('addrArea').value.trim();
        const landmark = document.getElementById('addrLandmark')?.value.trim() || '';
        const city = document.getElementById('addrCity').value.trim();
        const state = document.getElementById('addrState').value.trim();
        const pincode = document.getElementById('addrPincode').value.trim();
        const receiverPhone = document.getElementById('addrPhone')?.value.trim() || userProfile.phone.replace('+91', '');

        if (!fName || !flat || !area || !city || !state || !pincode) {
            setButtonLoading(confirmBtn, false);
            if (errorEl)
                errorEl.textContent = 'Please fill all mandatory address details.';
            return;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            setButtonLoading(confirmBtn, false);
            if (errorEl)
                errorEl.textContent = 'Please enter a valid email address.';
            return;
        }

        // Validate pincode (6 digits)
        if (!/^\d{6}$/.test(pincode)) {
            setButtonLoading(confirmBtn, false);
            if (errorEl)
                errorEl.textContent = 'Please enter a valid 6-digit pincode.';
            return;
        }

        // Validate phone (10 digits)
        const phoneDigits = receiverPhone.replace(/\D/g, '');
        if (phoneDigits.length !== 10) {
            setButtonLoading(confirmBtn, false);
            if (errorEl)
                errorEl.textContent = 'Please enter a valid 10-digit receiver phone number.';
            return;
        }

        payload.newAddress = {
            type: addrType,
            firstName: fName,
            lastName: lName,
            flatHouse: flat,
            areaStreet: area,
            landmark: landmark || undefined,
            city: city,
            state: state,
            receiversPhone: receiverPhone,
            pincode: pincode
        };
    }
    else if (selectedAddressId) {
        if (selectedAddressId.startsWith('mock_addr_')) {
            // Offline/Mock fallback: database returned mock addresses without real UUIDs.
            // We safely serialize that selected card's fields as newAddress to satisfy backend.
            const idx = parseInt(selectedAddressId.replace('mock_addr_', ''), 10);
            const active = userProfile.addresses?.[idx];
            if (active) {
                payload.newAddress = {
                    type: 'HOME',
                    firstName: active.firstName,
                    lastName: active.lastName,
                    flatHouse: active.flatHouse,
                    areaStreet: active.areaStreet,
                    city: active.city,
                    state: active.state,
                    receiversPhone: active.receiversPhone || userProfile.phone.replace('+91', ''),
                    pincode: active.pincode
                };
            }
            else {
                setButtonLoading(confirmBtn, false);
                if (errorEl)
                    errorEl.textContent = 'Selected address is invalid.';
                return;
            }
        }
        else {
            payload.addressId = selectedAddressId;
        }
    }
    else {
        setButtonLoading(confirmBtn, false);
        if (errorEl)
            errorEl.textContent = 'Please select or add a delivery address.';
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/user/profile`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-store-id': STORE_ID
            },
            body: JSON.stringify(payload)
        });

        // Handle expired session (410 Gone)
        if (response.status === 410) {
            console.warn('[PROFILE] Session expired, resetting checkout');
            resetCheckoutWorkflow();
            alert('Your checkout session has expired. Please start a new checkout.');
            return;
        }

        const data = await response.json();
        setButtonLoading(confirmBtn, false);
        if (data.success) {
            console.log('Shipping address and email registered successfully!');
            await syncSessionState();
        }
        else {
            if (errorEl)
                errorEl.textContent = data.message || 'Failed to save profile. Please check inputs.';
        }
    }
    catch (error) {
        setButtonLoading(confirmBtn, false);
        console.warn('Backend database offline or timeout. Proceeding using offline transition state.');
        transitionToStep('payment');
    }
}
// Render dynamic gateways
function renderGatewaysList() {
    const COD_MAX_AMOUNT = 15000; // Match backend MAX_COD_AMOUNT in .env
    const container = document.querySelector('.payment-methods-list');
    if (!container)
        return;
    container.innerHTML = '';
    activeGateways.forEach((provider, index) => {
        const isCOD = provider.name.toUpperCase() === 'COD';
        // COD Cap logic: limit COD based on MAX_COD_AMOUNT
        const isCodCapped = isCOD && finalTotal > COD_MAX_AMOUNT;
        // Check if gateway is disabled by backend
        const isDisabled = provider.disabled || isCodCapped;
        const card = document.createElement('div');
        const isActive = index === 0 && !isDisabled; // Default first active unless disabled
        if (isActive) {
            currentPaymentMethod = provider.name;
        }
        card.className = `payment-method-item ${provider.name.toLowerCase()}-method ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`;
        card.id = `method${provider.name}`;
        card.dataset.gateway = provider.name;
        const disableReason = provider.disabledReason || (isCodCapped ? `COD not available for orders above ₹${COD_MAX_AMOUNT.toLocaleString()}` : '');
        card.innerHTML = `
      <div class="method-header">
        <div class="method-meta">
          <span class="method-icon" style="background: white; padding: 4px; border: 1.5px solid var(--border-light); width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
            <img src="${provider.image}" style="width: 22px; height: 22px; object-fit: contain;">
          </span>
          <div>
            <span class="method-label">${provider.name} payment</span>
            <span class="method-subtext">${provider.description || ''}</span>
            ${isDisabled ? `<span class="method-error-badge">${disableReason}</span>` : ''}
          </div>
        </div>
        <span class="method-price">${isCOD ? '₹80.00' : '₹' + finalTotal.toFixed(2)}</span>
        <span class="method-chevron">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </span>
      </div>

      ${provider.type === 'UPI' ? `
        <div class="method-drawer" id="upiDrawer" style="display: ${isActive ? 'block' : 'none'};">
          <p class="drawer-instruction">Scan the QR code & pay via any UPI app</p>
          <div class="qr-container">
             <div class="qr-code-wrapper" style="background: white; padding: 12px; border-radius: 12px; display: inline-block;">
               <img id="realUpiQr" src="https://chart.googleapis.com/chart?chs=180x180&cht=qr&chl=upi%3A%2F%2Fpay%3Fpa%3Devoclabs%40oksbi%26pn%3DEvoc%2520Labs%26am%3D${finalTotal.toFixed(2)}%26cu%3DINR" alt="UPI QR Code" style="width: 150px; height: 150px; display: block; margin: 0 auto; object-fit: contain;">
             </div>
          </div>
        </div>
      ` : ''}
    `;
        // Radio click
        if (!isDisabled) {
            card.addEventListener('click', () => {
                document.querySelectorAll('.payment-method-item').forEach(i => {
                    i.classList.remove('active');
                    const drawer = i.querySelector('.method-drawer');
                    if (drawer)
                        drawer.style.display = 'none';
                });
                card.classList.add('active');
                currentPaymentMethod = provider.name;
                const drawer = card.querySelector('.method-drawer');
                if (drawer)
                    drawer.style.display = 'block';
            });
        }
        container.appendChild(card);
    });
}
// Map frontend provider names to backend gateway names
function mapToBackendGateway(providerName) {
    const name = providerName.toUpperCase();
    if (name === 'COD') return 'COD';
    if (name === 'PAYU') return 'PAYU_V2';
    if (name === 'RAZORPAY' || name === 'RAZORPAY_UPI' || name === 'UPI') return 'RAZORPAY';
    // Default to PayU V2 for other types (CARD, NET_BANKING, WALLET)
    return 'PAYU_V2';
}

// Finalize payment logic (COD vs Online callback loop)
async function finalizeCheckoutPayment() {
    if (!currentPaymentMethod) {
        alert('Please select a payment method to buy now.');
        return;
    }
    const errorEl = document.getElementById('paymentError');
    if (errorEl)
        errorEl.textContent = '';
    const payBtn = document.getElementById('submitPaymentBtn');
    setButtonLoading(payBtn, true);
    try {
        const response = await fetch(`${API_BASE_URL}/checkout/finalize`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-store-id': STORE_ID
            },
            body: JSON.stringify({
                sessionId: sessionId,
                paymentMethod: mapToBackendGateway(currentPaymentMethod)
            })
        });
        const data = await response.json();
        setButtonLoading(payBtn, false);
        if (data.success && data.data) {
            const intentData = data.data;
            if (intentData.status === 'PLACED') {
                // COD immediate success
                showSuccessScreen({
                    sessionId: intentData.sessionId,
                    status: intentData.status,
                    paymentMethod: 'COD'
                });
            }
            else if (intentData.paymentUrl) {
                // Online Gateway — Open payment gateway URL in popup
                openPaymentGateway(intentData.paymentUrl, intentData.gatewayTransactionId, intentData.paymentMethod);
            }
            else {
                if (errorEl)
                    errorEl.textContent = data.message || 'Payment processing failed.';
            }
        }
        else {
            if (errorEl)
                errorEl.textContent = data.message || 'Payment processing failed. Please select another method.';
        }
    }
    catch (error) {
        setButtonLoading(payBtn, false);
        if (errorEl)
            errorEl.textContent = 'Unable to connect to payment server. Please try again.';
    }
}

// Open payment gateway URL - redirects full page to payment gateway
// After payment, gateway redirects back to this page with status
function openPaymentGateway(paymentUrl, txnId, paymentMethod) {
    // Build redirect URL that returns here after payment
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');
    const redirectUrl = `${baseUrl}?sessionId=${sessionId}&txnId=${txnId}&paymentMethod=${paymentMethod}`;

    // Append our callback URL to PayU's payment URL
    let finalPaymentUrl = paymentUrl;
    try {
        const url = new URL(paymentUrl);
        // PayU uses 'curl' for success and 'furl' for failure redirects
        url.searchParams.set('curl', redirectUrl);
        url.searchParams.set('furl', redirectUrl);
        finalPaymentUrl = url.toString();
    } catch (e) {
        console.warn('[PAYMENT] Could not parse payment URL, using as-is');
    }

    // Store session ID in sessionStorage (survives redirect, cleared on same-origin nav)
    sessionStorage.setItem('evoc_pending_payment', JSON.stringify({
        sessionId,
        txnId,
        paymentMethod,
        timestamp: Date.now()
    }));

    console.log('[PAYMENT] Redirecting to payment gateway:', finalPaymentUrl);
    // Full page redirect to payment gateway
    window.location.href = finalPaymentUrl;
}

// Check payment status after gateway interaction with retry logic
async function checkPaymentStatus(txnId, paymentMethod, retryCount = 0) {
    const maxRetries = 3;
    const retryDelay = 1000;

    try {
        const response = await fetch(`${API_BASE_URL}/checkout/summary/${sessionId}`, {
            headers: { 'x-store-id': STORE_ID }
        });

        // Handle expired session
        if (response.status === 410) {
            console.warn('[PAYMENT_STATUS] Session expired');
            resetCheckoutWorkflow();
            return;
        }

        const data = await response.json();

        if (data.success && data.data) {
            const state = data.data;
            console.log(`[PAYMENT_STATUS] Session status: ${state.status}`);

            if (state.status === 'COMPLETED' || state.status === 'PLACED') {
                showSuccessScreen({
                    sessionId: state.id,
                    status: state.status,
                    paymentMethod: paymentMethod
                });
                return;
            }

            if (state.status === 'FAILED') {
                showFailureScreen({ sessionId: state.id, reason: 'payment_failed' });
                return;
            }

            // If still pending and we have retries left, wait and retry
            if (retryCount < maxRetries) {
                console.log(`[PAYMENT_STATUS] Status still pending, retrying in ${retryDelay}ms (${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                return checkPaymentStatus(txnId, paymentMethod, retryCount + 1);
            }

            // If still pending after all retries, show failure
            showFailureScreen({ reason: 'payment_timeout' });
        }
    } catch (error) {
        console.error('[PAYMENT] Status check failed:', error);
        // Retry on network errors
        if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return checkPaymentStatus(txnId, paymentMethod, retryCount + 1);
        }
        showFailureScreen({ reason: 'connection_error' });
    }
}
// Success Screen display
function showSuccessScreen(orderData) {
    // Clear URL parameters to prevent re-trigger on refresh/back
    if (window.location.search.includes('sessionId')) {
        history.replaceState({}, '', window.location.pathname);
    }

    const receiptId = document.getElementById('receiptSessionId');
    if (receiptId)
        receiptId.textContent = orderData.sessionId || sessionId || '';
    const receiptStatus = document.getElementById('receiptStatus');
    if (receiptStatus) {
        receiptStatus.textContent = orderData.status;
        if (orderData.status === 'PLACED') {
            receiptStatus.className = 'value text-blue';
        }
        else {
            receiptStatus.className = 'value text-green';
        }
    }
    const receiptAmount = document.getElementById('receiptAmount');
    if (receiptAmount)
        receiptAmount.textContent = '₹' + finalTotal.toFixed(2);

    // Clear footer session display
    const footerSessionId = document.getElementById('footerSessionId');
    if (footerSessionId) {
        footerSessionId.textContent = 'Session: Complete';
    }

    // Show success screen
    transitionToStep('success');
    // Clear session data
    localStorage.removeItem('evoc_checkout_session_id');
    sessionStorage.removeItem('evoc_pending_payment');
    sessionId = null;

    // Disable the back button to prevent double-click
    const resetBtn = document.getElementById('resetCheckoutBtn');
    if (resetBtn) {
        resetBtn.disabled = true;
        resetBtn.style.opacity = '0.7';
        setTimeout(() => {
            resetBtn.disabled = false;
            resetBtn.style.opacity = '1';
        }, 1000);
    }
}

// Failure Screen display
function showFailureScreen(orderData) {
    // Clear URL parameters to prevent re-trigger on refresh/back
    if (window.location.search.includes('sessionId')) {
        history.replaceState({}, '', window.location.pathname);
    }

    const receiptId = document.getElementById('receiptSessionId');
    if (receiptId)
        receiptId.textContent = orderData.sessionId || sessionId || '';
    const receiptStatus = document.getElementById('receiptStatus');
    if (receiptStatus) {
        receiptStatus.textContent = 'FAILED';
        receiptStatus.className = 'value text-red';
    }
    const receiptAmount = document.getElementById('receiptAmount');
    if (receiptAmount)
        receiptAmount.textContent = '₹' + finalTotal.toFixed(2);

    // Show failure reason in order ID field if available
    const receiptOrderId = document.getElementById('receiptOrderId');
    if (receiptOrderId && orderData.reason) {
        receiptOrderId.textContent = 'Reason: ' + orderData.reason;
    }

    // Clear footer session display
    const footerSessionId = document.getElementById('footerSessionId');
    if (footerSessionId) {
        footerSessionId.textContent = 'Session: ' + (orderData.reason || 'Failed');
    }

    // Switch to success card but with failure styling
    transitionToStep('success');
    // Clear session data
    localStorage.removeItem('evoc_checkout_session_id');
    sessionStorage.removeItem('evoc_pending_payment');
    sessionId = null;

    // Disable the back button to prevent double-click
    const resetBtn = document.getElementById('resetCheckoutBtn');
    if (resetBtn) {
        resetBtn.disabled = true;
        resetBtn.style.opacity = '0.7';
        setTimeout(() => {
            resetBtn.disabled = false;
            resetBtn.style.opacity = '1';
        }, 1000);
    }
}
