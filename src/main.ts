import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
import { bootstrapApp } from './config/bootstrap'
import { initializeStorageMigration } from './utils/storageMigration'
import { App as CapacitorApp } from '@capacitor/app'
import { billingService } from './services/billingService'
import { installApiFetchLogger } from './utils/apiFetchLogger'

installApiFetchLogger()

const app = createApp(App)

// Initialize Pinia BEFORE bootstrap (bootstrap uses stores)
app.use(createPinia())
app.use(router)

// Bootstrap application (initializes Firebase if needed)
;(async () => {
  try {
    await bootstrapApp()
  } catch (error) {
    console.error('Bootstrap failed, mounting app anyway:', error)
  }

  // Initialize storage migration for PII protection
  try {
    await initializeStorageMigration()
  } catch (error) {
    console.warn('Storage migration initialization failed:', error)
  }

  CapacitorApp.addListener('appStateChange', async ({ isActive }: { isActive: boolean }) => {
    if (isActive) {
      await billingService.refreshSubscriptionStatus()
    }
  })

  app.mount('#app')
})()

