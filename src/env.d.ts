/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_BACKEND?: 'MOCK' | 'FIREBASE'
  readonly VITE_BACKEND_API_URL?: string

  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string

  readonly VITE_REVENUECAT_API_KEY?: string

  readonly VITE_USE_PLAID_BACKEND?: 'true' | 'false'
  readonly VITE_PLAID_ENV?: string
  // VITE_PLAID_CLIENT_ID and VITE_PLAID_SECRET must never appear here —
  // Plaid credentials are backend-only and must not be bundled into client JS.

  readonly VITE_REQUIRE_EMAIL_VERIFICATION?: 'true' | 'false'
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
