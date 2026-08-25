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
    path: '/transparansi/pap',
    name: 'public-pap-transparency',
    component: () => import('@/features/public-pap/PublicPapView.vue'),
    meta: { public: true },
  },
  {
    path: '/transparansi/:tenantSlug/pap',
    name: 'public-pap-transparency-slug',
    component: () => import('@/features/public-pap/PublicPapView.vue'),
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
  if (to.meta.public && to.name !== 'login') {
    return true;
  }
  if (!auth.initialized) {
    await auth.init();
  }
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    // better-auth redirects OAuth errors it can't resolve to baseURL root
    // (not our errorCallbackURL) when the flow's state can't be recognized —
    // e.g. https://.../?error=please_restart_the_process. That lands here as
    // an unauthenticated hit on a requiresAuth route, and `error` must be
    // forwarded as its own query param or LoginView's `?error=` banner never
    // sees it — it'd otherwise be buried inside the opaque `redirect` value.
    const query: Record<string, string> = { redirect: to.fullPath };
    if (typeof to.query.error === 'string') query.error = to.query.error;
    return { path: '/login', query };
  }
  if (to.path === '/login' && auth.isAuthenticated) {
    return { path: '/' };
  }
  return true;
});
