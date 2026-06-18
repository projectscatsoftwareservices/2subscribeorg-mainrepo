import { initializeApp, FirebaseApp } from 'firebase/app'
import { getAuth, Auth, RecaptchaVerifier } from 'firebase/auth'
import { initializeFirestore, Firestore, persistentLocalCache, persistentSingleTabManager, memoryLocalCache } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

// Singleton instances
let app: FirebaseApp | null = null
let auth: Auth | null = null
let firestore: Firestore | null = null

/**
 * Initialize Firebase
 * Safe to call multiple times (only initializes once)
 * 
 * @internal - Use bootstrapApp() from config/bootstrap.ts instead
 */
export function initializeFirebase(): void {
  if (app) return // Already initialized
  
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  // persistentMultipleTabManager requires SharedWorker which Android WebView doesn't support.
  // Use single-tab persistent cache on mobile, memory cache as fallback.
  try {
    firestore = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
    })
  } catch {
    firestore = initializeFirestore(app, { localCache: memoryLocalCache() })
  }
}

/**
 * Get Firebase Auth instance
 * @throws Error if Firebase not initialized
 */
export function getFirebaseAuth(): Auth {
  if (!auth) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.')
  }
  return auth
}

/**
 * Get Firestore instance
 * @throws Error if Firebase not initialized
 */
export function getFirebaseDb(): Firestore {
  if (!firestore) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.')
  }
  return firestore
}

export function createRecaptchaVerifier(element: HTMLElement | string): RecaptchaVerifier {
  const authInstance = getFirebaseAuth()
  return new RecaptchaVerifier(authInstance, element, { size: 'invisible' })
}
