<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '@/shared/api/client';

interface Announcement {
  id: string;
  title: string;
  body: string;
  slug: string;
  scope: 'public' | 'internal' | 'urgent';
  publishedAt: string | null;
  status: 'draft' | 'published';
  updatedAt: string;
}

const loading = ref(true);
const items = ref<Announcement[]>([]);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.get<{ data: Announcement[] }>('/api/v1/announcements', {
      query: { status: 'all', limit: 50 },
    });
    items.value = res.data;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Pengumuman</h1>
        <p class="text-sm text-slate-500">Daftar pengumuman terbaru ({{ items.length }})</p>
      </div>
    </header>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 4" :key="i" class="h-16 animate-pulse rounded-xl bg-white border border-slate-200" />
    </div>

    <ul v-else-if="items.length > 0" class="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
      <li v-for="a in items" :key="a.id" class="flex items-start justify-between gap-4 px-5 py-4">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-slate-900">{{ a.title }}</p>
          <p class="mt-0.5 line-clamp-2 text-xs text-slate-500">{{ a.body }}</p>
        </div>
        <div class="text-right text-xs text-slate-500">
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
            :class="
              a.status === 'published'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-600'
            "
          >
            {{ a.status }}
          </span>
          <p class="mt-1">{{ a.scope }}</p>
        </div>
      </li>
    </ul>

    <p v-else class="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
      Belum ada pengumuman.
    </p>
  </div>
</template>
