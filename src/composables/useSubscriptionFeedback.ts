import { ref, watch } from 'vue'
import { logger } from '@/utils/logger'
import { useAuth } from '@/composables/useAuth'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { useTransactionsDataStore } from '@/stores/transactionsData'
import { useCategoryManagement } from '@/composables/useCategoryManagement'
import { FirebaseSubscriptionFeedbackRepo } from '@/data/repo/firebase/FirebaseSubscriptionFeedbackRepo'
import { useLoadingStates } from '@/composables/useLoadingStates'
import { secureStorage } from '@/utils/secureStorage'
import type { Subscription, SubscriptionFeedback } from '@/domain/models'

interface RecordFeedbackParams {
  transactionId: string
  merchantName: string
  amount: {
    amount: number
    currency: 'GBP' | 'EUR' | 'USD'
  }
  date: string
  userAction: 'confirmed' | 'rejected'
  detectionConfidence?: number
  detectionMethod?: 'rule_based' | 'ml_model' | 'pattern_matching'
  suggestedCategoryId?: string
  actualCategoryId?: string
}

interface RejectionCache {
  confirmed: string[]
  pending: PendingRejection[]
  timestamp: number
}

interface PendingRejection {
  merchantName: string
  timestamp: number
  transactionId?: string
  retryCount?: number
  status?: 'pending' | 'failed' | 'confirmed'
}

export function useSubscriptionFeedback() {
  const { user } = useAuth()
  const subscriptionsStore = useSubscriptionsStore()
  const transactionsStore = useTransactionsDataStore()
  const { createCategory } = useCategoryManagement()
  const feedbackRepo = new FirebaseSubscriptionFeedbackRepo()
  
  const { withLoading, isLoading } = useLoadingStates()
  const loading = isLoading('feedback')
  const error = ref<string | null>(null)
  
  // Category selection modal state
  const showCategoryModal = ref(false)
  const pendingSubscriptionData = ref<any>(null)

  /**
   * Helper functions for encrypted cache management
   */
  async function getRejectionCache(cacheKey: string): Promise<RejectionCache> {
    try {
      const cached = await secureStorage.get(cacheKey, user.value?.id)
      if (!cached) {
        return { confirmed: [], pending: [], timestamp: Date.now() }
      }
      
      // Handle legacy format (old array format)
      if (Array.isArray(cached)) {
        return { confirmed: cached, pending: [], timestamp: Date.now() }
      }
      
      // Ensure structure is valid
      const cache = cached as RejectionCache
      return {
        confirmed: cache.confirmed || [],
        pending: cache.pending || [],
        timestamp: cache.timestamp || Date.now()
      }
    } catch (err) {
      logger.warn('Failed to parse rejection cache, using default', { error: err })
      return { confirmed: [], pending: [], timestamp: Date.now() }
    }
  }

  async function saveRejectionCache(cacheKey: string, cache: RejectionCache): Promise<void> {
    try {
      await secureStorage.set(cacheKey, cache, user.value?.id)
    } catch (err) {
      logger.warn('Failed to save rejection cache', { error: err })
    }
  }

  /**
   * Clean up stale pending rejections (older than 5 minutes)
   * This should be called on app initialization
   */
  async function cleanupStalePendingRejections(cacheKey: string): Promise<void> {
    try {
      const cache = await getRejectionCache(cacheKey)
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000)
      
      const originalLength = cache.pending.length
      cache.pending = cache.pending.filter((pending: PendingRejection) => pending.timestamp > fiveMinutesAgo)
      
      if (cache.pending.length !== originalLength) {
        await saveRejectionCache(cacheKey, cache)
        logger.debug(`Cleaned up ${originalLength - cache.pending.length} stale pending rejections`)
      }
    } catch (err) {
      logger.warn('Failed to cleanup stale pending rejections', { error: err })
    }
  }

  // Initialize cleanup of stale pending rejections and retry failed ones
  watch(user, async (newUser) => {
    if (newUser?.id) {
      const cacheKey = `rejected_merchants_${newUser.id}`
      await cleanupStalePendingRejections(cacheKey)
      
      // Retry failed rejections after a short delay to ensure app is fully loaded
      setTimeout(async () => {
        await retryFailedRejections()
      }, 2000)
    }
  }, { immediate: true })

  async function recordFeedback(params: RecordFeedbackParams): Promise<SubscriptionFeedback | null> {
    return await withLoading('feedback', async () => {
      error.value = null

      try {
        if (!user.value?.id) {
          throw new Error('User not authenticated')
        }

      const feedback = await feedbackRepo.recordFeedback(
        user.value.id,
        params.transactionId,
        params.merchantName,
        params.amount,
        params.date,
        params.userAction,
        params.detectionConfidence,
        params.detectionMethod
      )

        return feedback
      } catch (err: any) {
        error.value = err.message || 'Failed to record feedback'
        logger.error('❌ Failed to record feedback:', err)
        return null
      }
    })
  }

  async function confirmSubscription(params: Omit<RecordFeedbackParams, 'userAction'>): Promise<boolean> {
    return await withLoading('feedback', async () => {
      error.value = null

      try {
      // 1. First, record the feedback for ML improvement
      const feedbackSuccess = await recordFeedback({
        ...params,
        userAction: 'confirmed',
        detectionMethod: params.detectionMethod || 'pattern_matching',
      })

      if (!feedbackSuccess) {
        logger.error('❌ Feedback recording failed, but continuing with subscription creation')
        // Don't throw error here - continue with subscription creation even if feedback fails
      }

      // 2. Store subscription data and show category selection modal
      pendingSubscriptionData.value = {
        ...params,
        feedbackRecorded: !!feedbackSuccess
      }
      
      showCategoryModal.value = true
      return true // Return true to indicate the process has started

      } catch (err: any) {
        error.value = err.message
        logger.error('Error confirming subscription:', err)
        return false
      }
    })
  }

  async function handleCategorySelection(categoryId: string): Promise<boolean> {
    if (!pendingSubscriptionData.value) {
      error.value = 'No pending subscription data'
      return false
    }

    return await withLoading('feedback', async () => {
      error.value = null

      try {
        const params = pendingSubscriptionData.value

        // Create the actual subscription with selected category - following the same pattern as Transactions.vue
        const newSubscription: Subscription = {
          id: crypto.randomUUID(),
          userId: user.value!.id,
          merchantName: params.merchantName,
          amount: {
            amount: params.amount.amount,
            currency: params.amount.currency
          },
          recurrence: 'monthly',
          nextPaymentDate: params.date,
          categoryId: categoryId,
          status: 'active',
          source: 'pattern_detection',
          notes: `Created from pattern detection with ${Math.round(params.detectionConfidence * 100)}% confidence`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }

        // Use the correct save method
        await subscriptionsStore.save(newSubscription)

        // Update the transaction to link it to the subscription
        // First get the full transaction, then update it
        const existingTransaction = await transactionsStore.getById(params.transactionId)
        if (!existingTransaction) {
          throw new Error('Transaction not found')
        }
        
        const updatedTransaction = {
          ...existingTransaction,
          subscriptionId: newSubscription.id,
          isSubscription: true,
          categoryId: categoryId,
          updatedAt: new Date().toISOString()
        }
        
        await transactionsStore.save(updatedTransaction)

        logger.success(`Subscription created and linked: ${params.merchantName}`)
        
        // Clean up
        pendingSubscriptionData.value = null
        showCategoryModal.value = false
        
        return true

      } catch (err: any) {
        error.value = err.message
        logger.error('Error creating subscription:', err)
        return false
      }
    })
  }

  async function handleCategoryCreation(categoryData: { name: string; colour: string; icon?: string }): Promise<boolean> {
    if (!pendingSubscriptionData.value) {
      error.value = 'No pending subscription data'
      return false
    }

    // Store pending data and close modal immediately to prevent validation errors
    const pendingData = pendingSubscriptionData.value
    showCategoryModal.value = false
    pendingSubscriptionData.value = null

    return await withLoading('feedback', async () => {
      error.value = null

      try {
        // Modal already validated - create the category
        const newCategory = await createCategory({
          name: categoryData.name,
          colour: categoryData.colour,
          icon: categoryData.icon
        })
        
        // Restore pending data temporarily to create subscription
        pendingSubscriptionData.value = pendingData
        
        // Then create subscription with the new category
        const result = await handleCategorySelection(newCategory.id)
        
        // Clear pending data after creation
        pendingSubscriptionData.value = null
        
        return result

      } catch (err: any) {
        error.value = err.message || 'Failed to create category and subscription'
        logger.error('❌ Failed to create category and subscription:', err)
        return false
      }
    })
  }

  function cancelCategorySelection() {
    pendingSubscriptionData.value = null
    showCategoryModal.value = false
  }

  async function rejectSubscription(params: Omit<RecordFeedbackParams, 'userAction'>): Promise<string | null> {
    const cacheKey = user.value?.id ? `rejected_merchants_${user.value.id}` : null
    const merchantLower = params.merchantName.toLowerCase()
    
    if (!cacheKey) {
      // No cache key, proceed with database only
      const result = await recordFeedback({
        ...params,
        userAction: 'rejected',
        detectionMethod: params.detectionMethod || 'pattern_matching',
      })
      return result?.id || null
    }

    // Atomic cache operation with validation
    let operationId: string | null = null
    try {
      const cache = await getRejectionCache(cacheKey)
      
      // Check if already processed (idempotency check)
      if (cache.confirmed.includes(merchantLower)) {
        logger.debug('Merchant already confirmed', { merchant: merchantLower })
        return null
      }
      
      // Check if already pending (avoid duplicate operations)
      const existingPending = cache.pending.find(p => p.merchantName === merchantLower)
      if (existingPending && existingPending.status !== 'failed') {
        logger.debug('Merchant already pending', { merchant: merchantLower })
        return null
      }
      
      // Generate operation ID for tracking
      operationId = `${merchantLower}_${Date.now()}`
      
      // Add to pending state with operation tracking
      cache.pending = cache.pending.filter(p => p.merchantName !== merchantLower) // Remove any existing failed entries
      cache.pending.push({
        merchantName: merchantLower,
        timestamp: Date.now(),
        transactionId: params.transactionId,
        retryCount: 0,
        status: 'pending'
      })
      
      await saveRejectionCache(cacheKey, cache)
      logger.debug('Added merchant to pending state', { merchant: merchantLower, operationId })
      
      // Attempt database write
      const result = await recordFeedback({
        ...params,
        userAction: 'rejected',
        detectionMethod: params.detectionMethod || 'pattern_matching',
      })
      
      // Success: move from pending to confirmed
      const updatedCache = await getRejectionCache(cacheKey)
      updatedCache.pending = updatedCache.pending.filter(p => p.merchantName !== merchantLower)
      if (!updatedCache.confirmed.includes(merchantLower)) {
        updatedCache.confirmed.push(merchantLower)
      }
      await saveRejectionCache(cacheKey, updatedCache)
      
      logger.success('Merchant rejection confirmed', { merchant: merchantLower, operationId })
      return result?.id || null
      
    } catch (err) {
      logger.error('Database write failed for merchant rejection', { merchant: merchantLower, operationId, error: err })
      
      // Mark as failed but keep in pending for retry logic
      try {
        const cache = await getRejectionCache(cacheKey)
        const pendingItem = cache.pending.find(p => p.merchantName === merchantLower)
        if (pendingItem) {
          pendingItem.status = 'failed'
          pendingItem.retryCount = (pendingItem.retryCount || 0) + 1
          
          // If too many retries, remove from pending to prevent infinite loops
          if (pendingItem.retryCount >= 3) {
            cache.pending = cache.pending.filter(p => p.merchantName !== merchantLower)
            logger.warn('Merchant rejection failed after 3 retries, removing from pending', { merchant: merchantLower })
          }
        }
        await saveRejectionCache(cacheKey, cache)
      } catch (cleanupErr) {
        logger.error('Failed to update pending state after database error', { error: cleanupErr })
      }
      
      // Re-throw the original error to maintain existing error handling behavior
      throw err
    }
  }

  /**
   * Retry failed merchant rejections
   * Called on app initialization to handle temporary database failures
   */
  async function retryFailedRejections(): Promise<void> {
    if (!user.value?.id) return
    
    const cacheKey = `rejected_merchants_${user.value.id}`
    try {
      const cache = await getRejectionCache(cacheKey)
      const failedRejections = cache.pending.filter(p => p.status === 'failed' && (p.retryCount || 0) < 3)
      
      if (failedRejections.length > 0) {
        logger.info('Retrying failed merchant rejections', { count: failedRejections.length })
        
        for (const failed of failedRejections) {
          try {
            // Find the original transaction if available
            const transaction = failed.transactionId ? 
              await transactionsStore.getById(failed.transactionId) : null
            
            if (transaction) {
              await rejectSubscription({
                transactionId: transaction.id,
                merchantName: failed.merchantName,
                amount: transaction.amount,
                date: transaction.date,
                detectionConfidence: 0.8, // Default confidence for retries
                detectionMethod: 'pattern_matching'
              })
              logger.success('Successfully retried merchant rejection', { merchant: failed.merchantName })
            } else {
              // Remove stale entry if transaction no longer exists
              cache.pending = cache.pending.filter(p => p.merchantName !== failed.merchantName)
              await saveRejectionCache(cacheKey, cache)
            }
          } catch (err) {
            logger.warn('Failed to retry merchant rejection', { merchant: failed.merchantName, error: err })
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to retry failed rejections', { error: err })
    }
  }

  async function getUserFeedback(limit: number = 100): Promise<SubscriptionFeedback[]> {
    return await withLoading('feedback', async () => {
      error.value = null

      try {
        if (!user.value?.id) {
          return []
        }

        const dbFeedback = await feedbackRepo.getUserFeedback(user.value.id, limit)
        
        // Merge with locally cached rejections to handle race conditions
        try {
          const cacheKey = `rejected_merchants_${user.value.id}`
          const cache = await getRejectionCache(cacheKey)
          const dbMerchants = new Set(dbFeedback.map(f => f.merchantName.toLowerCase()))
          
          // Add synthetic feedback entries for confirmed merchants not yet in DB
          cache.confirmed.forEach((merchantName: string) => {
            if (!dbMerchants.has(merchantName)) {
              dbFeedback.push({
                id: `cached_${merchantName}`,
                transactionId: 'pending',
                userId: user.value!.id,
                merchantName: merchantName,
                amount: { amount: 0, currency: 'GBP' },
                date: new Date().toISOString(),
                userAction: 'rejected',
                timestamp: new Date().toISOString()
              } as SubscriptionFeedback)
            }
          })
          
          // Add synthetic feedback entries for pending merchants
          cache.pending.forEach((pending: PendingRejection) => {
            if (!dbMerchants.has(pending.merchantName)) {
              dbFeedback.push({
                id: `pending_${pending.merchantName}`,
                transactionId: pending.transactionId || 'pending',
                userId: user.value!.id,
                merchantName: pending.merchantName,
                amount: { amount: 0, currency: 'GBP' },
                date: new Date(pending.timestamp).toISOString(),
                userAction: 'rejected',
                timestamp: new Date(pending.timestamp).toISOString()
              } as SubscriptionFeedback)
            }
          })
        } catch (err) {
          logger.warn('Failed to merge cached rejections', { error: err })
        }
        
        return dbFeedback
      } catch (err: any) {
        error.value = err.message
        logger.error('Error fetching feedback:', err)
        return []
      }
    })
  }

  async function getFeedbackStats() {
    return await withLoading('feedback', async () => {
      error.value = null

      try {
        if (!user.value?.id) {
          return { confirmed: 0, rejected: 0, total: 0 }
        }

        const feedback = await feedbackRepo.getUserFeedback(user.value.id, 1000)
        const confirmed = feedback.filter(f => f.userAction === 'confirmed').length
        const rejected = feedback.filter(f => f.userAction === 'rejected').length
        
        return {
          confirmed,
          rejected,
          total: feedback.length
        }
      } catch (err: any) {
        error.value = err.message
        logger.error('Error fetching stats:', err)
        return null
      }
    })
  }

  async function undoFeedback(feedbackId: string, merchantName?: string): Promise<boolean> {
    return await withLoading('feedback', async () => {
      error.value = null

      try {
        // Remove from encrypted cache if merchant name provided
        if (merchantName && user.value?.id) {
          try {
            const cacheKey = `rejected_merchants_${user.value.id}`
            const cache = await getRejectionCache(cacheKey)
            
            // Remove from confirmed list
            cache.confirmed = cache.confirmed.filter(m => m !== merchantName.toLowerCase())
            
            // Remove from pending list
            cache.pending = cache.pending.filter(p => p.merchantName !== merchantName.toLowerCase())
            
            await saveRejectionCache(cacheKey, cache)
          } catch (err) {
            logger.warn('Failed to remove from encrypted cache', { error: err })
          }
        }

        await feedbackRepo.deleteFeedback(feedbackId)
        return true
      } catch (err: any) {
        error.value = err.message
        logger.error('Error undoing feedback:', err)
        return false
      }
    })
  }

  return {
    loading,
    error,
    recordFeedback,
    confirmSubscription,
    rejectSubscription,
    getUserFeedback,
    getFeedbackStats,
    undoFeedback,
    // Category selection modal state and handlers
    showCategoryModal,
    pendingSubscriptionData,
    handleCategorySelection,
    handleCategoryCreation,
    cancelCategorySelection,
    retryFailedRejections,
  }
}