/**
 * Shared reference data — loaded once per session, reused across views.
 * Avoids re-fetching accounts/categories on every menu navigation.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/shared/api/client';

export interface LiteAccount {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  accountType: string;
  isActive: boolean;
}

export interface TxCategory {
  id: string;
  code: string;
  name: string;
  direction: 'income' | 'expense';
  debitAccountId: string | null;
  creditAccountId: string | null;
  isActive: boolean;
}

export const useReferenceDataStore = defineStore('referenceData', () => {
  const accounts = ref<LiteAccount[]>([]);
  const categories = ref<TxCategory[]>([]);
  const accountsReady = ref(false);
  const categoriesReady = ref(false);

  let accountsInflight: Promise<void> | null = null;
  let categoriesInflight: Promise<void> | null = null;

  async function ensureAccounts(force = false): Promise<LiteAccount[]> {
    if (accountsReady.value && !force) return accounts.value;
    if (accountsInflight && !force) {
      await accountsInflight;
      return accounts.value;
    }
    accountsInflight = (async () => {
      const res = await api.get<{ data: LiteAccount[] }>('/api/v1/accounts', { query: { lite: 1 } });
      accounts.value = res.data;
      accountsReady.value = true;
    })();
    try {
      await accountsInflight;
    } finally {
      accountsInflight = null;
    }
    return accounts.value;
  }

  async function ensureCategories(force = false): Promise<TxCategory[]> {
    if (categoriesReady.value && !force) return categories.value;
    if (categoriesInflight && !force) {
      await categoriesInflight;
      return categories.value;
    }
    categoriesInflight = (async () => {
      const res = await api.get<{ data: TxCategory[] }>('/api/v1/transaction-categories');
      categories.value = res.data.filter((c) => c.isActive);
      categoriesReady.value = true;
    })();
    try {
      await categoriesInflight;
    } finally {
      categoriesInflight = null;
    }
    return categories.value;
  }

  function invalidate(): void {
    accountsReady.value = false;
    categoriesReady.value = false;
  }

  return {
    accounts,
    categories,
    accountsReady,
    categoriesReady,
    ensureAccounts,
    ensureCategories,
    invalidate,
  };
});