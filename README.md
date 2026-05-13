# EVOC Checkout Service API 🚀

A high-performance, centralized checkout service built with **Express 5**, **TypeScript 6**, **Prisma 7**, and **Zod**. This service acts as the core "Identity & Checkout" layer for D2C storefronts, enabling seamless guest-to-user transitions and persistent shipping profiles.

---

## 🏗 Architecture: The "Session-First" Flow

Unlike traditional checkouts that require login first, this service follows a **State-Machine Architecture**:

1.  **Anonymous Initiation**: Storefronts create a session with a product snapshot (`PENDING_AUTH`). **Tenant isolation** is enforced via the `x-store-id` header.
2.  **OTP Authentication**: Users verify their **mandatory phone number**, linking their identity to the session (`AUTHENTICATED`).
3.  **Profile Persistence**: Users provide a **mandatory email** and shipping details. Addresses are saved centrally, enabling "1-click" style repeat checkouts (`ADDRESS_CONFIRMED`).
4.  **Payment Intent**: The session is locked once a payment method is selected. Contact details are verified before creating gateway intents (`PAYMENT_PENDING`).
5.  **Payment Verification (Webhook)**: Secure server-to-server callback verification (e.g., PayU Reverse Hashing) strictly validates the transaction, preventing amount or status tampering (`COMPLETED` or `FAILED`).

---

## 🛠 Tech Stack & Best Practices

- **Prisma 7**: Uses the **Driver Adapter** pattern (`@prisma/adapter-pg`) for high-performance PostgreSQL connections.
- **Zod**: Strict schema validation for every incoming request, ensuring data integrity at the entry point.
- **Security First**: Multi-layered defensive strategy including tenant isolation, cross-user data protection, and state-machine enforcement.
- **Vitest & Supertest**: Comprehensive test suite covering happy paths, defensive security, and input validation.

---

## 📂 Project Structure

```text
src/
├── config/       # Shared configurations (Prisma singleton, Driver Adapters)
├── controllers/  # Business logic (Checkout, Auth, User)
├── generated/    # Prisma Client (Custom output path for v7)
├── routes/       # API route definitions
├── schemas/      # Zod validation schemas
├── test/         # Integration tests (Happy Path, Security, Validation)
├── utils/        # Shared utilities
├── app.ts        # Express app definition (Middleware & Routes)
└── index.ts      # Server entry point
```

---

## 🛣 API Reference

### Mandatory Headers
| Header | Description | Required |
| :--- | :--- | :--- |
| `x-store-id` | Unique identifier for the merchant storefront | **Yes** (All endpoints) |

### Checkout Flow
| Method | Endpoint | Description | Status Transition |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/checkout/init` | Create a new session with items | `PENDING_AUTH` |
| `GET` | `/api/v1/checkout/summary/:id` | Get full order & user details | - |
| `POST` | `/api/v1/checkout/finalize` | Choose payment & verify contact info | `PAYMENT_PENDING` |

### Authentication
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/v1/auth/otp/send` | Request a 6-digit code for a session |
| `POST` | `/api/v1/auth/otp/verify` | Verify OTP and create/link User |

### User Profile
| Method | Endpoint | Description | Status Transition |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/user/profile` | Save mandatory email & shipping address | `ADDRESS_CONFIRMED` |

---

## 🛡 Security & Validation

The service implements strict defensive boundaries:
*   **Tenant Isolation**: All operations are scoped to the `x-store-id`. One store cannot access another's sessions.
*   **Identity Integrity**: `phone` and `email` are mandatory. Payments are blocked if contact details are missing.
*   **Data Ownership**: Users can only use address IDs belonging to their own account.
*   **Address Deduplication**: The system prevents database bloat by querying for an exact identical address match before creating a new shipping profile.
*   **State Locking**: Finalization is blocked unless the session has reached the `ADDRESS_CONFIRMED` state.
*   **Webhook Verification**: Payment callbacks enforce strict reverse-hash calculations (with raw byte matching, avoiding `.trim()` mutations) to prevent spoofed or tampered payment callbacks.

---

## 🛠 Local Development

### Prerequisites
- [pnpm](https://pnpm.io/) (Package Manager)
- [PostgreSQL](https://www.postgresql.org/) (Local or Cloud instance)

### Setup
1.  **Install dependencies**:
    ```bash
    pnpm install
    ```
2.  **Environment Setup**:
    Configure your `DATABASE_URL` in `.env`.
3.  **Generate Prisma Client**:
    ```bash
    pnpm prisma generate
    ```
4.  **Database Migration**:
    ```bash
    pnpm prisma migrate dev
    ```
5.  **Start Dev Server**:
    ```bash
    pnpm dev
    ```

---

## ✅ Quality Control

1.  **Testing**: Run the full suite (Happy Path, Security, Validation).
    ```bash
    pnpm test
    ```
2.  **Linting & Formatting**:
    ```bash
    pnpm lint && pnpm format
    ```
