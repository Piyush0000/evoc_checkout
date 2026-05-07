# EVOC Checkout Service API 🚀

A high-performance, centralized checkout service built with **Express 5**, **TypeScript 6**, **Prisma 7**, and **Zod**. This service acts as the core "Identity & Checkout" layer for D2C storefronts, enabling seamless guest-to-user transitions and persistent shipping profiles.

---

## 🏗 Architecture: The "Session-First" Flow

Unlike traditional checkouts that require login first, this service follows a **State-Machine Architecture**:

1.  **Anonymous Initiation**: Storefronts create a session with a product snapshot (`PENDING_AUTH`).
2.  **OTP Authentication**: Users verify their phone number, linking their identity to the session (`AUTHENTICATED`).
3.  **Profile Persistence**: User addresses are saved centrally, enabling "1-click" style repeat checkouts (`ADDRESS_CONFIRMED`).
4.  **Payment Intent**: The session is locked once a payment method is selected (`PAYMENT_PENDING`).

---

## 🛠 Tech Stack & Best Practices

- **Prisma 7**: Uses the new **Driver Adapter** pattern (`@prisma/adapter-pg`) for high-performance PostgreSQL connections.
- **Zod**: Strict schema validation for every incoming request.
- **Vitest & Supertest**: Full integration test suite for the checkout funnel.

---

## 📂 Project Structure

```text
src/
├── config/       # Shared configurations (Prisma singleton, Driver Adapters)
├── controllers/  # Business logic (Checkout, Auth, User)
├── generated/    # Prisma Client (Custom output path for v7)
├── routes/       # API route definitions
├── schemas/      # Zod validation schemas
├── test/         # Integration tests (Vitest)
├── app.ts        # Express app definition (Logic layer)
└── index.ts      # Server entry point (Environment layer)
```

---

## 🛣 API Reference

### Checkout Flow
| Method | Endpoint | Description | Status Transition |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/checkout/init` | Create a new session with items | `PENDING_AUTH` |
| `GET` | `/api/v1/checkout/summary/:id` | Get full order & user details | - |
| `POST` | `/api/v1/checkout/finalize` | Choose payment & lock session | `PAYMENT_PENDING` |

### Authentication
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/v1/auth/otp/send` | Request a 6-digit code for a session |
| `POST` | `/api/v1/auth/otp/verify` | Verify OTP and link User to Session |

### User Profile
| Method | Endpoint | Description | Status Transition |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/user/profile` | Update shipping address & email | `ADDRESS_CONFIRMED` |

---

## 💎 Prisma 101 for Contributors

If you are new to Prisma, here is the essential workflow:

*   **`pnpm prisma generate`**: Run this every time you change the `schema.prisma` file. It rebuilds your custom TypeScript SDK in `src/generated/prisma`.
*   **`pnpm prisma migrate dev`**: Use this to sync your schema changes with the local PostgreSQL database. It creates a SQL migration file to keep your DB structure in sync.
*   **`npx prisma studio`**: A powerful GUI to view and edit your database data directly in the browser.

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
    Configure your `DATABASE_URL` in `.env` (Format: `postgresql://user:pass@localhost:5432/evoc_checkout`).
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

1.  **Testing**: Run the full suite (including unique constraint tests).
    ```bash
    pnpm test
    ```
2.  **Linting & Formatting**:
    ```bash
    pnpm lint && pnpm format
    ```

---

## 🚢 Deployment Notes

This project is optimized for **Prisma 7**. When deploying:
- Ensure the environment supports the PostgreSQL Driver Adapter.
- The Prisma Client is generated into `src/generated/prisma`. Ensure this path is included in your build artifacts.
- Use `npx prisma migrate deploy` for production database updates.
