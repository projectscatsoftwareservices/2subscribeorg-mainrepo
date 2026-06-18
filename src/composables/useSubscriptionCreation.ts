import { ref } from 'vue'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { useTransactionsStore } from '@/stores/transactions'
import { useAuthStore } from '@/stores/auth'
import { useHybridValidation } from './useHybridValidation'
import { logger } from '@/utils/logger'
import type { Transaction, Subscription } from '@/domain/models'
import type { SubscriptionRecurrence } from '@/types/subscriptions'
import { calculateNextPaymentDate, getDefaultRecurrenceForMerchant, generateSubscriptionNotes } from '@/utils/subscriptionUtils'

export function useSubscriptionCreation() {
  const subscriptionsStore = useSubscriptionsStore()
  const transactionsStore = useTransactionsStore()
  const authStore = useAuthStore()
  const { validateSubscription } = useHybridValidation()
  
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function createSubscriptionFromTransaction(
    transaction: Transaction, 
    categoryId: string,
    recurrence?: SubscriptionRecurrence
  ): Promise<Subscription> {
    loading.value = true
    error.value = null
    
    try {
      // Determine recurrence - use provided, infer from merchant, or default to monthly
      const subscriptionRecurrence = recurrence || 
        getDefaultRecurrenceForMerchant(transaction.merchantName) || 
        'monthly'
      
      // Calculate next payment date using enhanced utility
      const nextPaymentDate = calculateNextPaymentDate(transaction.date, subscriptionRecurrence)
      
      // Generate contextual notes
      const notes = generateSubscriptionNotes('manual', undefined, transaction.date)
      
      const newSubscription: Subscription = {
        id: crypto.randomUUID(),
        userId: authStore.userId!,
        categoryId: categoryId,
        merchantName: transaction.merchantName,
        amount: transaction.amount,
        recurrence: subscriptionRecurrence,
        nextPaymentDate: nextPaymentDate,
        status: 'active',
        source: 'manual',
        notes: notes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      
      // Validate subscription data before saving
      logger.debug('Validating subscription data...')
      const validation = await validateSubscription({
        amount: typeof newSubscription.amount === 'number' ? newSubscription.amount : newSubscription.amount?.amount || 0,
        merchantName: newSubscription.merchantName,
        categoryId: newSubscription.categoryId,
        userId: newSubscription.userId,
        status: newSubscription.status,
        frequency: newSubscription.recurrence,
        nextBillingDate: newSubscription.nextPaymentDate,
        description: newSubscription.notes,
        isActive: newSubscription.status === 'active',
      })
      
      if (!validation.valid) {
        throw new Error(validation.error || 'Subscription validation failed')
      }
      
      logger.debug('Subscription validation passed', { 
        validationType: validation.usingServer ? 'server' : 'client' 
      })
      
      // Save subscription
      await subscriptionsStore.save(newSubscription)
      
      // Mark the transaction as converted to subscription
      const updatedTransaction = {
        ...transaction,
        subscriptionId: newSubscription.id,
        categoryId: categoryId
      }
      await transactionsStore.updateTransaction(updatedTransaction)
      
      logger.success('Subscription created successfully', { 
        merchantName: newSubscription.merchantName,
        id: newSubscription.id 
      })
      return newSubscription
      
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to create subscription'
      error.value = errorMessage
      logger.error('Failed to create subscription', e)
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    error,
    createSubscriptionFromTransaction
  }
}
