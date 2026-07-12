import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/features/auth/store';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/features/auth/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('@/app/AppShell.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'dashboard',
        component: () => import('@/features/dashboard/DashboardView.vue'),
      },
      {
        path: 'announcements',
        name: 'announcements',
        component: () => import('@/features/announcements/AnnouncementsView.vue'),
      },
      {
        path: 'mosque-profile',
        name: 'mosque-profile',
        component: () => import('@/features/mosque-profile/MosqueProfileView.vue'),
      },
      {
        path: 'programs',
        name: 'programs',
        component: () => import('@/features/programs/ProgramsView.vue'),
      },
      {
        path: 'events',
        name: 'events',
        component: () => import('@/features/events/EventsView.vue'),
      },
      {
        path: 'posts',
        name: 'posts',
        component: () => import('@/features/posts/PostsView.vue'),
      },
      {
        path: 'galleries',
        name: 'galleries',
        component: () => import('@/features/galleries/GalleriesView.vue'),
      },
      {
        path: 'accounts',
        name: 'accounts',
        component: () => import('@/features/accounts/AccountsView.vue'),
      },
      {
        path: 'transaction-categories',
        name: 'transaction-categories',
        component: () => import('@/features/transaction-categories/TransactionCategoriesView.vue'),
      },
      {
        path: 'funds',
        name: 'funds',
        component: () => import('@/features/funds/FundsView.vue'),
      },
      {
        path: 'transactions',
        name: 'transactions',
        component: () => import('@/features/transactions/TransactionsView.vue'),
      },
      {
        path: 'transactions/import/pap',
        name: 'transactions-import-pap',
        component: () => import('@/features/transactions/PapImportView.vue'),
      },
      {
        path: 'transactions/import',
        name: 'transactions-import',
        component: () => import('@/features/transactions/TransactionImportView.vue'),
      },
      {
        path: 'reports',
        name: 'reports',
        component: () => import('@/features/reports/ReportsView.vue'),
      },
      {
        path: 'tenants',
        name: 'tenants',
        component: () => import('@/features/tenants/TenantsView.vue'),
      },
      {
        path: 'changelog',
        name: 'changelog',
        component: () => import('@/features/changelog/ChangelogView.vue'),
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.initialized) {
    await auth.init();
  }
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.path === '/login' && auth.isAuthenticated) {
    return { path: '/' };
  }
  return true;
});
