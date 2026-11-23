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
  import { setVoicePrefs } from '#lib/voices'
  import { EMPTY_ROLES } from '#lib/settingsview'
  import StudySettings from '#lib/components/settings/StudySettings.svelte'
  import RigAlertsSection from '#lib/components/settings/RigAlertsSection.svelte'
  import OpenRouterKey from '#lib/components/settings/OpenRouterKey.svelte'
  import ModelRoles from '#lib/components/settings/ModelRoles.svelte'
  import VoiceSettings from '#lib/components/settings/VoiceSettings.svelte'
  import SpeechSection from '#lib/components/settings/SpeechSection.svelte'
  import NumberSetting from '#lib/components/settings/NumberSetting.svelte'
  import AccountSection from '#lib/components/settings/AccountSection.svelte'
  import AdminUsers from '#lib/components/settings/AdminUsers.svelte'
  import { peekCached } from '#lib/cache'

  let roles = $state<Roles>({ ...EMPTY_ROLES })
  let roleDefaults = $state<Roles | null>(null)
  let models = $state<ModelInfo[]>([])
  let modelFilter = $state('')
  let modelsLoading = $state(false)
  let voiceMode = $state<'preset' | 'design'>('preset')
  let voices = $state<Record<string, string>>({})
  let keyStatus = $state<'user' | 'server' | false>(false)
  let keyInput = $state('')
  let handle = $state('')
  let dailyGoal = $state(50)
  let foodThreshold = $state(50)
  let desiredRetention = $state(90)
  let study = $state<StudyPrefs>({
    showZhuyin: true,
    showFurigana: true,
    disabledExercises: [],
    newPerDay: 20,
    maxReviewsPerDay: 200,
    learningSteps: [1, 10, 60, 240],
    autoReinforce: true,
  })
  /** The learning steps as an editable comma list of minutes. */
  let stepsText = $state('1, 10, 60, 240')
  let exercises = $state<ExerciseInfo[]>([])
  let speech = $state<SpeechStatus | null>(null)
  let waking = $state(false)
  let users = $state<PublicUser[]>([])
  let note = $state('')
  let error = $state('')

  const isAdmin = $derived(session.user?.role === 'admin')

  $effect(() => {
    const msg = note
    if (!msg) return
    const timer = setTimeout(() => {
      if (note === msg) note = ''
    }, 6000)
    return () => clearTimeout(timer)
  })

  type SettingsPayload = {
    roles: Roles
    roleDefaults: Roles
    voice: { mode: 'preset' | 'design'; voices: Record<string, string> }
    study?: StudyPrefs
    openrouter: { key: 'user' | 'server' | false }
    foodThreshold?: number
    desiredRetention?: number
  }

  /** Applies a settings payload to the form — from the cache or the server. */
  function applySettings(s: SettingsPayload) {
    roles = s.roles
    roleDefaults = s.roleDefaults
    voiceMode = s.voice.mode
    voices = s.voice.voices
    setVoicePrefs({ mode: voiceMode, voices })
    if (s.study) {
      study = s.study
      stepsText = (s.study.learningSteps ?? []).join(', ')
    }
    keyStatus = s.openrouter.key
    foodThreshold = s.foodThreshold ?? 50
    desiredRetention = s.desiredRetention ?? 90
  }

  // Seed the form from the last fetch so fields don't pop in from defaults.
  const cachedSettings = peekCached<SettingsPayload>('/api/settings')
  if (cachedSettings) applySettings(cachedSettings)

  onMount(async () => {
    handle = session.user?.handle ?? ''
    try {
      applySettings(await api<SettingsPayload>('/api/settings'))
    } catch (e) {
      error = (e as Error).message
    }
    void loadModels()
    void loadExercises()
    void refreshSpeech()
    void getStats()
      .then((s) => (dailyGoal = s.dailyGoal))
      .catch(() => {})
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
    } catch {
      /* catalogue is best-effort */
    } finally {
      modelsLoading = false
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

  async function loadExercises() {
    try {
      exercises = (await listExercises()).exercises
    } catch {
      /* catalogue is best-effort */
    }
  }

  async function saveStudy() {
    note = ''
    try {
      const steps = stepsText
        .split(/[\s,]+/)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0)
      const r = await api<{ study: StudyPrefs }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          // The active deck belongs to the sidebar picker; sending the copy this
          // page loaded with would revert a switch made since.
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
      // playback reads this module directly — no reload needed
      setVoicePrefs({ mode: voiceMode, voices })
      note = 'Voice settings saved.'
    } catch (e) {
      error = (e as Error).message
    }
  }

  /** Puts one scalar knob and shows the note. */
  async function saveScalar(patch: Record<string, number>, message: string) {
    note = ''
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) })
      note = message
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
      // The model list is scoped to the key — refresh it.
      void loadModels()
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
    await logout()
    void goto(href('/login'))
  }

  async function removeUser(id: string) {
    if (!confirm('Delete this user and all their history?')) return
    await api(`/api/users/${id}`, { method: 'DELETE' }).catch(() => {})
    void loadUsers()
  }

  async function wake() {
    if (waking) return
    waking = true
    error = ''
    note = 'Waking the speech models…'
    try {
      speech = await wakeSpeech()
      note = 'Speech models ready.'
    } catch (e) {
      note = ''
      error = (e as Error).message
    } finally {
      waking = false
    }
  }

  async function free() {
    note = ''
    await unloadSpeech().catch(() => {})
    await refreshSpeech()
    note = 'Speech models unloaded.'
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
  <p class="banner mb-3" style="--accent: {ACCENT.jade}">{note}</p>
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

  <VoiceSettings bind:voiceMode bind:voices onSave={saveVoice} />

  <SpeechSection {speech} {waking} onWake={wake} onFree={isAdmin ? free : undefined} />

  <NumberSetting
    title="Daily goal"
    help="XP to earn each UTC day to keep your streak."
    min={10}
    max={1000}
    step={10}
    inputWidth="w-28"
    accent={ACCENT.gold}
    bind:value={dailyGoal}
    onSave={() => saveScalar({ dailyGoal: Number(dailyGoal) }, 'Daily goal saved.')}
  />

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

  <StudySettings bind:study bind:stepsText {exercises} onsave={saveStudy} />

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

  <RigAlertsSection />

  <AccountSection bind:handle onSave={saveProfile} onLogout={doLogout} />

  {#if isAdmin}
    <AdminUsers {users} onRemove={removeUser} />
  {/if}
</div>
