<script lang="ts">
  import { href } from '#lib/paths'
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { api } from '#lib/api'
  import { getStats, listExercises } from '#lib/exercises'
  import { logout, session, updateProfile } from '#lib/session.svelte'
  import { speechStatus, unloadSpeech, wakeSpeech } from '#lib/speech'
  import { ACCENT } from '#lib/theme'
  import type {
    ExerciseInfo,
    ModelInfo,
    PublicUser,
    Roles,
    SpeechStatus,
    StudyPrefs,
  } from '#lib/types'
  import { EMPTY_ROLES } from '#lib/settingsview'
  import { haptics } from '#lib/haptics.svelte'
  import Spinner from '#lib/components/Spinner.svelte'
  import ConfirmDialog from '#lib/components/ConfirmDialog.svelte'
  import StudySettings from '#lib/components/settings/StudySettings.svelte'
  import RigAlertsSection from '#lib/components/settings/RigAlertsSection.svelte'
  import OpenRouterKey from '#lib/components/settings/OpenRouterKey.svelte'
  import ModelRoles from '#lib/components/settings/ModelRoles.svelte'
  import SpeechSection from '#lib/components/settings/SpeechSection.svelte'
  import NumberSetting from '#lib/components/settings/NumberSetting.svelte'
  import KeyboardSetting from '#lib/components/settings/KeyboardSetting.svelte'
  import AccountSection from '#lib/components/settings/AccountSection.svelte'
  import AdminUsers from '#lib/components/settings/AdminUsers.svelte'
  import { cachedResource } from '#lib/resource.svelte'

  let roles = $state<Roles>({ ...EMPTY_ROLES })
  let roleDefaults = $state<Roles | null>(null)
  let models = $state<ModelInfo[]>([])
  let modelFilter = $state('')
  let modelsLoading = $state(false)
  let keyStatus = $state<'user' | 'server' | false>(false)
  let keyInput = $state('')
  let handle = $state('')
  let dailyGoal = $state(50)
  let foodThreshold = $state(50)
  let desiredRetention = $state(90)
  let hapticsLevel = $state(0)
  let study = $state<StudyPrefs>({
    showZhuyin: true,
    showFurigana: true,
    disabledExercises: [],
    newPerDay: 20,
    maxReviewsPerDay: 200,
    learningSteps: [1, 10],
    autoReinforce: true,
  })
  let stepsText = $state('1, 10')
  let exercises = $state<ExerciseInfo[]>([])
  let speech = $state<SpeechStatus | null>(null)
  let waking = $state(false)
  let users = $state<PublicUser[]>([])
  let error = $state('')
  let note = $state('')
  let speechError = $state('')
  let settingsReady = $state(false)
  let goalReady = $state(false)
  let pendingUser = $state<PublicUser | null>(null)

  const isAdmin = $derived(session.user?.role === 'admin')

  type SettingsPayload = {
    roles: Roles
    roleDefaults: Roles
    study?: StudyPrefs
    openrouter: { key: 'user' | 'server' | false }
    foodThreshold?: number
    desiredRetention?: number
    haptics?: number
  }

  function applySettings(s: SettingsPayload) {
    roles = s.roles
    roleDefaults = s.roleDefaults
    if (s.study) {
      study = s.study
      stepsText = (s.study.learningSteps ?? []).join(', ')
    }
    keyStatus = s.openrouter.key
    foodThreshold = s.foodThreshold ?? 50
    desiredRetention = s.desiredRetention ?? 90
    hapticsLevel = s.haptics ?? 0
    haptics.set(hapticsLevel)
    settingsReady = true
  }

  const settings = cachedResource<SettingsPayload>('/api/settings', { auto: false })
  if (settings.data) applySettings(settings.data)

  onMount(async () => {
    handle = session.user?.handle ?? ''
    if ((await settings.refresh()) && settings.data) applySettings(settings.data)
    else error = settings.error
    void loadModels()
    void loadExercises()
    void refreshSpeech()
    void getStats()
      .then((s) => {
        dailyGoal = s.dailyGoal
        goalReady = true
      })
      .catch((e) => (error = (e as Error).message))
    if (isAdmin) void loadUsers()
  })

  async function loadModels() {
    modelsLoading = true
    try {
      models = (
        await api<{ models: ModelInfo[] }>(
          `/api/models?limit=1000&q=${encodeURIComponent(modelFilter)}`,
        )
      ).models
    } catch (e) {
      error = (e as Error).message
    } finally {
      modelsLoading = false
    }
  }

  async function refreshSpeech() {
    speechError = ''
    try {
      speech = await speechStatus()
    } catch (e) {
      speech = null
      speechError = (e as Error).message
    }
  }

  async function loadUsers() {
    try {
      users = (await api<{ users: PublicUser[] }>('/api/users')).users
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function loadExercises() {
    try {
      exercises = (await listExercises()).exercises
    } catch (e) {
      error = (e as Error).message
    }
  }

  function parseSteps(text: string): number[] {
    return text
      .split(/[\s,]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0)
  }

  async function saveStudy() {
    error = ''
    note = ''
    try {
      const steps = parseSteps(stepsText)
      const r = await api<{ study: StudyPrefs }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          study: { ...study, activeDeckId: undefined, learningSteps: steps },
        }),
      })
      study = r.study
      stepsText = r.study.learningSteps.join(', ')
      note = 'Study preferences saved.'
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function saveRoles() {
    error = ''
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

  async function saveScalar(patch: Record<string, number>, message: string) {
    error = ''
    note = ''
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) })
      note = message
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function saveKey() {
    error = ''
    note = ''
    try {
      const r = await api<{ openrouter: { key: 'user' | 'server' | false } }>(
        '/api/settings/openrouter-key',
        { method: 'PUT', body: JSON.stringify({ key: keyInput }) },
      )
      keyStatus = r.openrouter.key
      keyInput = ''
      note = keyStatus ? 'Key saved.' : 'Key cleared.'
      void loadModels()
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function saveProfile() {
    error = ''
    note = ''
    try {
      await updateProfile({ handle })
      note = 'Profile saved.'
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function doLogout() {
    await logout()
    void goto(href('/login'))
  }

  function removeUser(u: PublicUser) {
    pendingUser = u
  }

  async function confirmRemoveUser() {
    const u = pendingUser
    pendingUser = null
    if (!u) return
    error = ''
    note = ''
    try {
      await api(`/api/users/${u.id}`, { method: 'DELETE' })
      note = `Deleted ${u.handle}.`
      await loadUsers()
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function wake() {
    if (waking) return
    waking = true
    error = ''
    note = ''
    try {
      speech = await wakeSpeech()
      speechError = ''
      note = 'Speech models ready.'
    } catch (e) {
      error = (e as Error).message
    } finally {
      waking = false
    }
  }

  async function free() {
    error = ''
    note = ''
    try {
      await unloadSpeech()
      await refreshSpeech()
      note = 'Speech models unloaded.'
    } catch (e) {
      error = (e as Error).message
    }
  }
</script>

<div class="border-b border-ink-700 pt-4 pb-6 mb-4">
  <h1 class="display text-3xl text-ink-100">Settings</h1>
  <p class="sub mt-1.5">These apply to {session.user?.username} only.</p>
</div>

{#if error}
  <p class="banner mb-3" style="--accent: {ACCENT.ember}" role="alert">{error}</p>
{/if}

{#if note}
  <p class="banner mb-3" style="--accent: {ACCENT.jade}" role="status">{note}</p>
{/if}

<div class="lg:columns-2 lg:gap-10 xl:gap-16 [&>section]:break-inside-avoid">
  <OpenRouterKey {keyStatus} bind:keyInput onSave={saveKey} />

  <ModelRoles
    {models}
    bind:modelFilter
    {modelsLoading}
    bind:roles
    {roleDefaults}
    onFilter={loadModels}
    onSave={saveRoles}
  />

  <SpeechSection
    {speech}
    {waking}
    error={speechError}
    onWake={wake}
    onFree={isAdmin ? free : undefined}
  />

  {#if goalReady}
    <NumberSetting
      title="Daily goal"
      help="XP to earn each day to keep your streak."
      min={10}
      max={1000}
      step={10}
      inputWidth="w-28"
      accent={ACCENT.gold}
      bind:value={dailyGoal}
      onSave={() => saveScalar({ dailyGoal: Number(dailyGoal) }, 'Daily goal saved.')}
    />
  {:else}
    <p class="mb-5 panel flex items-center gap-2 p-4 text-xs text-ink-400">
      <Spinner size={14} label="Loading your daily goal" /> Loading…
    </p>
  {/if}

  {#if settingsReady}
    <NumberSetting
      title="Spaced repetition"
      help="Anki-style FSRS-6 scheduling. Desired retention is the chance you want to recall a card when it comes up — higher means shorter intervals and more reviews."
      min={70}
      max={97}
      step={1}
      suffix="%"
      accent={ACCENT.azure}
      bind:value={desiredRetention}
      onSave={() =>
        saveScalar({ desiredRetention: Number(desiredRetention) }, 'Desired retention saved.')}
    />
  {:else}
    <p class="mb-5 panel flex items-center gap-2 p-4 text-xs text-ink-400">
      <Spinner size={14} label="Loading spaced repetition" /> Loading…
    </p>
  {/if}

  <StudySettings bind:study bind:stepsText {exercises} onsave={saveStudy} />

  {#if settingsReady}
    <NumberSetting
      title="Combat"
      help="Food is auto-eaten when your HP drops below this percentage. Potions are auto-drunk at the start of a fight."
      min={10}
      max={90}
      step={5}
      suffix="%"
      accent={ACCENT.ember}
      bind:value={foodThreshold}
      onSave={() =>
        saveScalar({ foodThreshold: Number(foodThreshold) }, 'Combat auto-eat threshold saved.')}
    />
  {:else}
    <p class="mb-5 panel flex items-center gap-2 p-4 text-xs text-ink-400">
      <Spinner size={14} label="Loading combat settings" /> Loading…
    </p>
  {/if}

  <RigAlertsSection />

  <KeyboardSetting
    bind:value={hapticsLevel}
    onSave={(v) => {
      haptics.set(v)
      void saveScalar({ haptics: v }, 'Keyboard feedback saved.')
    }}
  />

  <AccountSection bind:handle onSave={saveProfile} onLogout={doLogout} />

  {#if isAdmin}
    <AdminUsers {users} onRemove={removeUser} />
  {/if}
</div>

<ConfirmDialog
  open={pendingUser !== null}
  title="Delete user"
  message={`Delete ${pendingUser?.handle ?? 'this user'} and all their history? This cannot be undone.`}
  confirmLabel="Delete user"
  onConfirm={confirmRemoveUser}
  onCancel={() => (pendingUser = null)}
/>
