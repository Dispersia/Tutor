<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { api } from '#lib/api'
  import { getStats } from '#lib/exercises'
  import { session, updateProfile } from '#lib/session.svelte'
  import { speechStatus, unloadSpeech } from '#lib/speech'
  import type { ModelInfo, PublicUser, Role, Roles, SpeechStatus } from '#lib/types'
  import { VOICE_PRESETS } from '#lib/voices'

  const ROLE_KEYS: Role[] = ['conversation', 'judge', 'generator', 'translator']
  const ROLE_LABEL: Record<Role, string> = {
    conversation: 'Conversation',
    judge: 'Grading / judge',
    generator: 'Card & exercise generator',
    translator: 'Translator / lookups',
  }

  let roles = $state<Roles>({
    conversation: '',
    judge: '',
    generator: '',
    translator: '',
  })
  let roleDefaults = $state<Roles | null>(null)
  let models = $state<ModelInfo[]>([])
  let modelFilter = $state('qwen')
  let voiceMode = $state<'preset' | 'design'>('preset')
  let voices = $state<Record<string, string>>({})
  let keyStatus = $state<'user' | 'server' | false>(false)
  let keyInput = $state('')
  let handle = $state('')
  let dailyGoal = $state(50)
  let foodThreshold = $state(50)
  let speech = $state<SpeechStatus | null>(null)
  let users = $state<PublicUser[]>([])
  let note = $state('')
  let error = $state('')

  const isAdmin = $derived(session.user?.role === 'admin')

  onMount(async () => {
    handle = session.user?.handle ?? ''
    try {
      const s = await api<{
        roles: Roles
        roleDefaults: Roles
        voice: { mode: 'preset' | 'design'; voices: Record<string, string> }
        openrouter: { key: 'user' | 'server' | false }
        foodThreshold?: number
      }>('/api/settings')
      roles = s.roles
      roleDefaults = s.roleDefaults
      voiceMode = s.voice.mode
      voices = s.voice.voices
      keyStatus = s.openrouter.key
      foodThreshold = s.foodThreshold ?? 50
    } catch (e) {
      error = (e as Error).message
    }
    void loadModels()
    void refreshSpeech()
    void getStats()
      .then((s) => (dailyGoal = s.dailyGoal))
      .catch(() => {})
    if (isAdmin) void loadUsers()
  })

  async function loadModels() {
    try {
      models = (
        await api<{ models: ModelInfo[] }>(`/api/models?q=${encodeURIComponent(modelFilter)}`)
      ).models
    } catch {
      /* catalogue is best-effort */
    }
  }

  async function refreshSpeech() {
    try {
      speech = await speechStatus()
    } catch {
      speech = null
    }
  }

  async function loadUsers() {
    try {
      users = (await api<{ users: PublicUser[] }>('/api/users')).users
    } catch {
      /* not admin */
    }
  }

  async function saveRoles() {
    note = ''
    try {
      const r = await api<{ roles: Roles }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ roles }),
      })
      roles = r.roles
      note = 'Model choices saved.'
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function saveVoice() {
    note = ''
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ voice: { mode: voiceMode, voices } }),
      })
      note = 'Voice settings saved.'
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function saveDailyGoal() {
    note = ''
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ dailyGoal: Number(dailyGoal) }),
      })
      note = 'Daily goal saved.'
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function saveFoodThreshold() {
    note = ''
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ foodThreshold: Number(foodThreshold) }),
      })
      note = 'Combat auto-eat threshold saved.'
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function saveKey() {
    note = ''
    try {
      const r = await api<{ openrouter: { key: 'user' | 'server' | false } }>(
        '/api/settings/openrouter-key',
        { method: 'PUT', body: JSON.stringify({ key: keyInput }) },
      )
      keyStatus = r.openrouter.key
      keyInput = ''
      note = keyStatus ? 'Key saved.' : 'Key cleared.'
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function saveProfile() {
    note = ''
    try {
      await updateProfile({ handle })
      note = 'Profile saved.'
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function doLogout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    session.user = null
    void goto('/login')
  }

  async function removeUser(id: string) {
    if (!confirm('Delete this user and all their history?')) return
    await api(`/api/users/${id}`, { method: 'DELETE' }).catch(() => {})
    void loadUsers()
  }

  async function free() {
    await unloadSpeech().catch(() => {})
    await refreshSpeech()
    note = 'Speech models unloaded.'
  }
</script>

<div class="pt-4 pb-6">
  <h1 class="text-lg font-semibold">Settings</h1>
  <p class="text-xs text-neutral-500">These apply to {session.user?.username} only.</p>
</div>

{#if error}
  <p class="mb-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>
{/if}
{#if note}
  <p class="mb-3 rounded-lg bg-emerald-950/60 px-3 py-2 text-sm text-emerald-300">{note}</p>
{/if}

<!-- OpenRouter key ------------------------------------------------------->
<section class="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
  <h2 class="text-sm font-medium">Your OpenRouter key</h2>
  <p class="mt-1 text-xs text-neutral-400">
    Status:
    {#if keyStatus === 'user'}<span class="text-emerald-400">using your own key</span>
    {:else if keyStatus === 'server'}<span class="text-amber-400">using the server's key</span>
    {:else}<span class="text-red-400">not set — chat is disabled</span>{/if}
  </p>
  <div class="mt-3 flex gap-2">
    <input
      type="password"
      bind:value={keyInput}
      placeholder={keyStatus === 'user' ? 'Replace key…' : 'sk-or-…'}
      class="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
    />
    <button onclick={saveKey} class="rounded-xl bg-neutral-100 px-3 py-2 text-sm text-black"
      >Save</button
    >
  </div>
</section>

<!-- Models --------------------------------------------------------------->
<section class="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
  <h2 class="text-sm font-medium">Models per role</h2>
  <p class="mt-1 text-xs text-neutral-400">
    Pick any OpenRouter model — use Qwen, or point a role at DeepSeek/OpenAI/etc.
  </p>
  <input
    bind:value={modelFilter}
    onchange={loadModels}
    placeholder="filter models (e.g. qwen, deepseek)"
    class="mt-3 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
  />
  <datalist id="models">
    {#each models as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
  </datalist>
  <div class="mt-3 space-y-2">
    {#each ROLE_KEYS as role (role)}
      <label class="block">
        <span class="mb-1 block text-xs text-neutral-400">{ROLE_LABEL[role]}</span>
        <input
          list="models"
          bind:value={roles[role]}
          class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
      </label>
    {/each}
  </div>
  <div class="mt-3 flex items-center justify-between">
    <button onclick={saveRoles} class="rounded-xl bg-emerald-500 px-3 py-2 text-sm text-black"
      >Save models</button
    >
    {#if roleDefaults}
      <button
        onclick={() => (roles = { ...roleDefaults! })}
        class="text-xs text-neutral-400 underline">reset to defaults</button
      >
    {/if}
  </div>
</section>

<!-- Voice ---------------------------------------------------------------->
<section class="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
  <h2 class="text-sm font-medium">Voice</h2>
  <div class="mt-2 flex gap-2">
    <button
      onclick={() => (voiceMode = 'preset')}
      class="flex-1 rounded-xl border px-3 py-2 text-sm {voiceMode === 'preset'
        ? 'border-emerald-500 text-emerald-400'
        : 'border-neutral-700 text-neutral-300'}">Preset speakers</button
    >
    <button
      onclick={() => (voiceMode = 'design')}
      class="flex-1 rounded-xl border px-3 py-2 text-sm {voiceMode === 'design'
        ? 'border-emerald-500 text-emerald-400'
        : 'border-neutral-700 text-neutral-300'}">Voice design</button
    >
  </div>
  <p class="mt-2 text-xs text-neutral-500">
    {voiceMode === 'preset'
      ? 'Built-in Qwen3-TTS speakers (fast, lowest memory).'
      : 'Describe a voice in the text box (e.g. "a warm, patient Mandarin teacher").'}
  </p>
  <div class="mt-3 space-y-2">
    {#each Object.entries(VOICE_PRESETS) as [lc, list] (lc)}
      <label class="block">
        <span class="mb-1 block text-xs text-neutral-400">{lc.toUpperCase()}</span>
        <input
          list="voices-{lc}"
          bind:value={voices[lc]}
          placeholder={list[0]}
          class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <datalist id="voices-{lc}">
          {#each list as v (v)}<option value={v}></option>{/each}
        </datalist>
      </label>
    {/each}
  </div>
  <button onclick={saveVoice} class="mt-3 rounded-xl bg-emerald-500 px-3 py-2 text-sm text-black"
    >Save voice</button
  >
</section>

<!-- Speech engine -------------------------------------------------------->
<section class="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
  <div class="flex items-center justify-between">
    <div>
      <h2 class="text-sm font-medium">Speech engine</h2>
      <p class="text-xs text-neutral-400">
        {speech?.ready ? 'awake' : speech?.running ? 'starting' : 'asleep'}
        {#if speech?.models?.length}· {speech.models.join(', ')}{/if}
      </p>
    </div>
    <button onclick={free} class="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs"
      >Free RAM</button
    >
  </div>
</section>

<!-- Daily goal ----------------------------------------------------------->
<section class="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
  <h2 class="text-sm font-medium">Daily goal</h2>
  <p class="mt-1 text-xs text-neutral-400">XP to earn each UTC day to keep your streak.</p>
  <div class="mt-3 flex gap-2">
    <input
      type="number"
      min="10"
      max="1000"
      step="10"
      bind:value={dailyGoal}
      class="w-28 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
    />
    <button onclick={saveDailyGoal} class="rounded-xl bg-neutral-100 px-3 py-2 text-sm text-black"
      >Save</button
    >
  </div>
</section>

<!-- Combat ---------------------------------------------------------------->
<section class="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
  <h2 class="text-sm font-medium">Combat</h2>
  <p class="mt-1 text-xs text-neutral-400">
    Food is auto-eaten when your HP drops below this percentage. Potions are auto-drunk at the start
    of a fight.
  </p>
  <div class="mt-3 flex items-center gap-2">
    <input
      type="number"
      min="10"
      max="90"
      step="5"
      bind:value={foodThreshold}
      class="w-24 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
    />
    <span class="text-sm text-neutral-400">%</span>
    <button
      onclick={saveFoodThreshold}
      class="rounded-xl bg-neutral-100 px-3 py-2 text-sm text-black">Save</button
    >
  </div>
</section>

<!-- Account -------------------------------------------------------------->
<section class="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
  <h2 class="text-sm font-medium">Account</h2>
  <label class="mt-3 block">
    <span class="mb-1 block text-xs text-neutral-400">Display name</span>
    <div class="flex gap-2">
      <input
        bind:value={handle}
        class="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
      />
      <button onclick={saveProfile} class="rounded-xl bg-neutral-100 px-3 py-2 text-sm text-black"
        >Save</button
      >
    </div>
  </label>
  <p class="mt-3 text-xs text-neutral-500">
    @{session.user?.username} · {session.user?.role}
  </p>
  <button
    onclick={doLogout}
    class="mt-3 rounded-xl border border-red-800 px-3 py-2 text-sm text-red-300">Sign out</button
  >
</section>

<!-- Admin ---------------------------------------------------------------->
{#if isAdmin}
  <section class="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
    <h2 class="text-sm font-medium">Users ({users.length})</h2>
    <ul class="mt-3 space-y-2">
      {#each users as u (u.id)}
        <li
          class="flex items-center justify-between rounded-xl border border-neutral-800 px-3 py-2"
        >
          <div>
            <div class="text-sm">{u.handle}</div>
            <div class="text-xs text-neutral-500">@{u.username} · {u.role}</div>
          </div>
          {#if u.id !== session.user?.id}
            <button
              onclick={() => removeUser(u.id)}
              class="rounded-lg border border-red-800 px-2 py-1 text-xs text-red-300">Delete</button
            >
          {/if}
        </li>
      {/each}
    </ul>
    <p class="mt-3 text-xs text-neutral-500">
      Everyone's conversations, settings and keys are stored separately.
    </p>
  </section>
{/if}
