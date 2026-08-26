<script setup lang="ts">
/**
 * Team Management — list, invite, and remove team members within a tenant.
 *
 * Invitation flow:
 *   1. Admin enters email → POST /api/v1/team/invite
 *   2. `users` row created with status='invited'
 *   3. Invitee signs up via /register with same email
 *   4. On login, syncUserAuthId links their auth account automatically
 */
import { onMounted, reactive, ref } from 'vue';
import { Mail, Trash2, UserPlus, Users } from 'lucide-vue-next';
import { api, formatApiError } from '@/shared/api/client';
import { useAuthStore } from '@/features/auth/store';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import Button from '@/shared/ui/Button.vue';
import FormField from '@/shared/ui/FormField.vue';
import PageHeader from '@/shared/ui/PageHeader.vue';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  status: 'active' | 'inactive' | 'invited';
  lastLoginAt: string | null;
  createdAt: string;
  roles: Array<{ code: string; name: string }>;
}

const auth = useAuthStore();
const members = ref<TeamMember[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const inviteOpen = ref(false);
const inviteSaving = ref(false);
const inviteError = ref<string | null>(null);
const inviteForm = reactive({ email: '', name: '' });

const removeTarget = ref<TeamMember | null>(null);
const removeSaving = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<{ data: TeamMember[] }>('/api/v1/team');
    members.value = res.data;
  } catch (err) {
    error.value = formatApiError(err);
  } finally {
    loading.value = false;
  }
}

function openInvite(): void {
  inviteForm.email = '';
  inviteForm.name = '';
  inviteError.value = null;
  inviteOpen.value = true;
}

async function doInvite(): Promise<void> {
  if (!inviteForm.email.trim()) return;
  inviteSaving.value = true;
  inviteError.value = null;
  try {
    await api.post('/api/v1/team/invite', {
      email: inviteForm.email.trim(),
      name: inviteForm.name.trim() || undefined,
    });
    inviteOpen.value = false;
    await load();
  } catch (err) {
    inviteError.value = formatApiError(err);
  } finally {
    inviteSaving.value = false;
  }
}

async function doRemove(): Promise<void> {
  if (!removeTarget.value) return;
  removeSaving.value = true;
  try {
    await api.delete(`/api/v1/team/${removeTarget.value.id}`);
    removeTarget.value = null;
    await load();
  } catch (err) {
    error.value = formatApiError(err);
  } finally {
    removeSaving.value = false;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case 'active':
      return { label: 'Aktif', class: 'bg-emerald-100 text-emerald-700' };
    case 'invited':
      return { label: 'Diundang', class: 'bg-amber-100 text-amber-700' };
    default:
      return { label: 'Nonaktif', class: 'bg-muted text-muted-foreground' };
  }
}

function isSelf(m: TeamMember): boolean {
  return m.email === auth.user?.email;
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Tim"
      description="Kelola anggota lembaga — undang, ubah peran, atau hapus anggota."
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Tim' }]"
    >
      <template #actions>
        <Button size="sm" @click="openInvite">
          <UserPlus class="h-4 w-4" />
          Undang Anggota
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-3">
      <Skeleton v-for="i in 3" :key="i" class="h-16 w-full rounded-xl" />
    </div>

    <!-- Empty state -->
    <Card v-else-if="!members.length" class="border-dashed">
      <CardContent class="flex flex-col items-center gap-3 py-14 text-center">
        <div class="grid size-12 place-items-center rounded-xl bg-muted">
          <Users class="size-6 text-muted-foreground" />
        </div>
        <div>
          <p class="font-medium text-foreground">Belum ada anggota</p>
          <p class="mt-1 max-w-sm text-sm text-muted-foreground">
            Undang orang pertama untuk mulai bekerja sama mengelola keuangan lembaga.
          </p>
        </div>
        <Button size="sm" @click="openInvite">
          <UserPlus class="h-4 w-4" />
          Undang Anggota
        </Button>
      </CardContent>
    </Card>

    <!-- Member list -->
    <div v-else class="space-y-2">
      <div
        v-for="m in members"
        :key="m.id"
        class="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/30"
      >
        <!-- Avatar -->
        <div
          class="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary"
        >
          {{ m.name?.charAt(0)?.toUpperCase() ?? '?' }}
        </div>

        <!-- Info -->
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="truncate text-sm font-semibold text-foreground">{{ m.name }}</p>
            <Badge
              :class="statusBadge(m.status).class"
              class="shrink-0 text-[10px]"
            >
              {{ statusBadge(m.status).label }}
            </Badge>
          </div>
          <p class="truncate text-xs text-muted-foreground">{{ m.email }}</p>
        </div>

        <!-- Roles -->
        <div class="hidden shrink-0 items-center gap-1 sm:flex">
          <Badge
            v-for="r in m.roles"
            :key="r.code"
            variant="outline"
            class="text-[10px]"
          >
            {{ r.name }}
          </Badge>
        </div>

        <!-- Remove -->
        <Button
          v-if="!isSelf(m)"
          variant="ghost"
          size="sm"
          class="shrink-0 text-destructive hover:text-destructive"
          @click="removeTarget = m"
        >
          <Trash2 class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <!-- Invite dialog -->
    <Teleport to="body">
      <div
        v-if="inviteOpen"
        class="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
        @click.self="inviteOpen = false"
      >
        <Card class="w-full max-w-md shadow-xl">
          <CardContent class="p-6">
            <h3 class="mb-1 text-base font-semibold text-foreground">Undang Anggota Baru</h3>
            <p class="mb-4 text-xs text-muted-foreground">
              Masukkan email orang yang ingin diundang. Mereka perlu mendaftar akun baru di halaman register sebelum bisa mengakses lembaga ini.
            </p>

            <Alert v-if="inviteError" variant="destructive" class="mb-4">
              <AlertDescription>{{ inviteError }}</AlertDescription>
            </Alert>

            <form class="space-y-4" @submit.prevent="doInvite">
              <FormField label="Email" html-for="invite-email" required>
                <Input
                  id="invite-email"
                  v-model="inviteForm.email"
                  type="email"
                  required
                  placeholder="bendahara@contoh.id"
                  autocomplete="email"
                />
              </FormField>
              <FormField label="Nama (opsional)" html-for="invite-name">
                <Input
                  id="invite-name"
                  v-model="inviteForm.name"
                  placeholder="Nama lengkap"
                  autocomplete="name"
                />
              </FormField>
              <div class="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" @click="inviteOpen = false">
                  Batal
                </Button>
                <Button type="submit" :loading="inviteSaving">
                  <Mail class="h-4 w-4" />
                  Kirim Undangan
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </Teleport>

    <!-- Remove confirm dialog -->
    <Teleport to="body">
      <div
        v-if="removeTarget"
        class="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
        @click.self="removeTarget = null"
      >
        <Card class="w-full max-w-sm shadow-xl">
          <CardContent class="p-6">
            <h3 class="mb-2 text-base font-semibold text-foreground">Hapus Anggota</h3>
            <p class="text-sm text-muted-foreground">
              Hapus <strong>{{ removeTarget.name }}</strong> ({{ removeTarget.email }}) dari lembaga ini? Mereka tidak akan bisa mengakses data lembaga lagi.
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <Button variant="secondary" @click="removeTarget = null">Batal</Button>
              <Button
                variant="destructive"
                :loading="removeSaving"
                @click="doRemove"
              >
                Hapus
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </Teleport>
  </div>
</template>
