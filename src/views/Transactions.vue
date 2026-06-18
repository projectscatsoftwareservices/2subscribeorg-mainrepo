<template>
  <div class="max-w-full overflow-x-hidden">
    <!-- Page Header -->
    <div class="mb-6 space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-xs uppercase tracking-[0.3em] text-slate-400">Transactions</p>
          <h2 class="text-3xl font-bold text-gray-900">Overview</h2>
        </div>
      </div>

      <ErrorBoundary component="TransactionFilterPanel">
        <TransactionFilterPanel
          :filters="filters"
          :accounts="accounts"
          :categories="categoriesStore.categories"
          :active-filter-count="activeFilterCount"
          mode="realtime"
          @update:selected-account="selectedAccount = $event"
          @update:subscription-filter="subscriptionFilter = $event"
          @update:merchant-search="handleMerchantSearchUpdate"
          @update:date-range="handleDateRangeUpdate"
          @update:amount-range="handleAmountRangeUpdate"
          @update:categories="handleCategoriesUpdate"
          @apply-filters="handleApplyFilters"
          @clear-all="handleClearAllFilters"
          @clear-filter="handleClearFilter"
        />
      </ErrorBoundary>
    </div>

    <LoadingSpinner v-if="loading" />

    <template v-else>
      <!-- Transactions List -->
      <AsyncErrorBoundary loading-message="Loading transactions...">
        <ErrorBoundary component="TransactionList">
          <TransactionList
            v-if="paginatedTransactions.length > 0"
            :transactions="paginatedTransactions"
            :categories="categoriesStore.categories"
            :pagination="pagination"
            :get-account-name="getAccountName"
            :get-amount-color="getAmountColor"
            @go-to-page="goToPage"
            @create-subscription="handleCreateSubscription"
            @edit-subscription="handleEditSubscription"
            @category-change="handleCategoryChange"
            @link-to-existing-subscription="handleLinkToExistingSubscription"
          />
        </ErrorBoundary>

        <!-- Empty State -->
        <ErrorBoundary component="EmptyState">
          <EmptyState
            v-if="paginatedTransactions.length === 0"
        title="No transactions found"
        description="Connect a bank account to see your transactions here."
        action-text="Connect Bank Account"
        action-to="/settings"
      />
        </ErrorBoundary>
      </AsyncErrorBoundary>
    </template>

    <!-- Category Selection Modal -->
    <ErrorBoundary component="CategorySelectionModal">
      <CategorySelectionModal
        :show="showCategoryModal"
        :merchant-name="selectedTransaction?.merchantName || ''"
        :categories="categoriesStore.categories"
        @confirm="handleCategorySelected"
        @create-and-confirm="handleCreateCategoryAndConfirm"
        @cancel="handleCategoryModalCancel"
      />
    </ErrorBoundary>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useTransactions } from '@/composables/useTransactions'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { useTransactionsStore } from '@/stores/transactions'
import { useCategoriesStore } from '@/stores/categories'
import { useAuthStore } from '@/stores/auth'
import { useCategoryManagement } from '@/composables/useCategoryManagement'
import type { Transaction } from '@/domain/models'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import TransactionFilterPanel from '@/components/transactions/TransactionFilterPanel.vue'
import TransactionList from '@/components/transactions/TransactionList.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import CategorySelectionModal from '@/components/CategorySelectionModal.vue'
import ErrorBoundary from '@/components/ui/ErrorBoundary.vue'
import AsyncErrorBoundary from '@/components/ui/AsyncErrorBoundary.vue'

// Use the composable for all business logic
const {
  loading,
  accounts,
  selectedAccount,
  subscriptionFilter,
  paginatedTransactions,
  pagination,
  goToPage,
  getAccountName,
  getAmountColor,
  filters,
  activeFilterCount,
  refreshTransactions,
  // Use filtering functions from useTransactions (same instance)
  setMerchantSearchFilter,
  setDateRangeFilter,
  setAmountRangeFilter,
  setCategoriesFilter,
  clearAllFilters,
  clearFilter
} = useTransactions()

const subscriptionsStore = useSubscriptionsStore()
const transactionsStore = useTransactionsStore()
const categoriesStore = useCategoriesStore()
const authStore = useAuthStore()
const { createCategory } = useCategoryManagement()

// Load transactions on component mount
onMounted(() => {
  refreshTransactions()
})


// Modal state
const showCategoryModal = ref(false)
const selectedTransaction = ref<Transaction | null>(null)


async function handleCreateSubscription(transaction: Transaction) {
  // Store transaction and show category selection modal
  selectedTransaction.value = transaction
  showCategoryModal.value = true
}

async function handleCategorySelected(categoryId: string) {
  if (!selectedTransaction.value) return
  
  try {
    // Create subscription with selected category
    const subscription = {
      id: `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Generate unique ID
      merchantName: selectedTransaction.value.merchantName,
      amount: selectedTransaction.value.amount,
      recurrence: 'monthly' as const, // Default to monthly
      nextPaymentDate: selectedTransaction.value.date,
      categoryId: categoryId,
      status: 'active' as const,
      source: 'manual' as const,
      userId: authStore.userId!,
      plaidTransactionIds: [selectedTransaction.value.id],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    
    // Save the subscription
    await subscriptionsStore.save(subscription)
    
    // Update the transaction to link it to the subscription
    const updatedTransaction = {
      ...selectedTransaction.value,
      subscriptionId: subscription.id,
      categoryId: categoryId
    }
    await transactionsStore.save(updatedTransaction)
    
    alert(`✅ Subscription created for ${selectedTransaction.value.merchantName}!`)
    
  } catch {
    alert('❌ Failed to create subscription')
  } finally {
    showCategoryModal.value = false
    selectedTransaction.value = null
  }
}

function handleCategoryModalCancel() {
  showCategoryModal.value = false
  selectedTransaction.value = null
}

async function handleEditSubscription(_transaction: Transaction) {
  // TODO: Open modal to edit subscription details
}

async function handleCategoryChange(transaction: Transaction, categoryId: string) {
  try {
    // Update the transaction with the new category
    const updatedTransaction = {
      ...transaction,
      categoryId: categoryId || undefined, // Set to undefined if empty string
      updatedAt: new Date().toISOString()
    }
    
    // Save the updated transaction
    await transactionsStore.save(updatedTransaction)
    
  } catch {
    alert('Failed to update category. Please try again.')
  }
}

async function handleLinkToExistingSubscription(_transaction: Transaction, data: { transactionId: string; subscriptionId: string; categoryId: string }) {
  try {
    // Update the transaction to link it to the existing subscription
    const updatedTransaction = {
      ..._transaction,
      subscriptionId: data.subscriptionId,
      categoryId: data.categoryId
    }
    
    // Save the updated transaction
    await transactionsStore.save(updatedTransaction)
    
  } catch {
    // Failed to link transaction to existing subscription
  }
}

async function handleCreateCategoryAndConfirm(categoryData: { name: string; colour: string; icon?: string }) {
  if (!selectedTransaction.value) return
  
  const { name: categoryName, colour: color, icon } = categoryData
  
  // Close modal immediately to prevent validation errors from showing while we create
  const transactionToProcess = selectedTransaction.value
  showCategoryModal.value = false
  selectedTransaction.value = null
  
  try {
    // Modal already validated - no duplicates, so create the category
    const newCategory = await createCategory({
      name: categoryName,
      colour: color,
      icon: icon
    })
    
    // Then create subscription with the new category
    const subscription = {
      id: `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Generate unique ID
      merchantName: transactionToProcess.merchantName,
      amount: transactionToProcess.amount,
      recurrence: 'monthly' as const, // Default to monthly
      nextPaymentDate: transactionToProcess.date,
      categoryId: newCategory.id,
      status: 'active' as const,
      source: 'manual' as const,
      userId: authStore.userId!,
      plaidTransactionIds: [transactionToProcess.id],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    
    // Save the subscription
    await subscriptionsStore.save(subscription)
    
    // Update the transaction to link it to the subscription
    const updatedTransaction = {
      ...transactionToProcess,
      subscriptionId: subscription.id,
      categoryId: newCategory.id
    }
    await transactionsStore.save(updatedTransaction)
    
    alert(`✅ New category "${categoryName}" created and subscription assigned!`)
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    alert(`❌ Failed to create category and subscription: ${errorMessage}`)
  }
}

// Filter panel event handlers - now connected to actual filtering
function handleMerchantSearchUpdate(search: string) {
  setMerchantSearchFilter(search)
}

function handleDateRangeUpdate(dateRange: { start: string; end: string }) {
  setDateRangeFilter(dateRange.start, dateRange.end)
}

function handleAmountRangeUpdate(amountRange: { min: number; max: number }) {
  setAmountRangeFilter(amountRange.min, amountRange.max)
}

function handleCategoriesUpdate(categories: string[]) {
  setCategoriesFilter(categories)
}

function handleClearAllFilters() {
  clearAllFilters()
}

function handleApplyFilters() {
  // In real-time mode, filters are already applied
  // In manual mode, this would trigger a refresh
}

function handleClearFilter(filterKey: string) {
  clearFilter(filterKey as any)
}
</script>
