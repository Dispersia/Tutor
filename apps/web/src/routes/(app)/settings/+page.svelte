<script lang="ts">
  import { href } from '#lib/paths'
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { api } from '#lib/api'
  import { getStats, listExercises } from '#lib/exercises'
  import { session, updateProfile } from '#lib/session.svelte'
  import { speechStatus, unloadSpeech, wakeSpeech } from '#lib/speech'
  import { accentStyle } from '#lib/theme'
  import { ACCENT } from '#lib/theme'
  import type {
    ExerciseInfo,
    ModelInfo,
    PublicUser,
    Role,
    Roles,
    SpeechStatus,
    StudyPrefs,
  } from '#lib/types'
  import { VOICE_PRESETS, setVoicePrefs } from '#lib/voices'
  import Spinner from '#lib/components/Spinner.svelte'

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
  })
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

  onMount(async () => {
    handle = session.user?.handle ?? ''
    try {
      const s = await api<{
        roles: Roles
        roleDefaults: Roles
        voice: { mode: 'preset' | 'design'; voices: Record<string, string> }
        study?: StudyPrefs
        openrouter: { key: 'user' | 'server' | false }
        foodThreshold?: number
        desiredRetention?: number
      }>('/api/settings')
      roles = s.roles
      roleDefaults = s.roleDefaults
      voiceMode = s.voice.mode
      voices = s.voice.voices
      setVoicePrefs({ mode: voiceMode, voices })
      if (s.study) study = s.study
      keyStatus = s.openrouter.key
      foodThreshold = s.foodThreshold ?? 50
      desiredRetention = s.desiredRetention ?? 90
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

  /** Drill exercises grouped by modality, for the Study checklist. */
  const drillGroups = $derived.by(() => {
    const order: string[] = []
    const byMod = new Map<string, ExerciseInfo[]>()
    for (const ex of exercises) {
      if (ex.id === 'introduce') continue // first-exposure step, never a drill
      if (!byMod.has(ex.modality)) {
        byMod.set(ex.modality, [])
        order.push(ex.modality)
      }
      byMod.get(ex.modality)!.push(ex)
    }
    return order.map((modality) => ({ modality, items: byMod.get(modality)! }))
  })

  const MODALITY_LABEL: Record<string, string> = {
    text: 'Reading & writing',
    voice: 'Listening & speaking',
    mixed: 'Mixed / conversation',
    chat: 'Conversation',
  }

  const isDisabled = (id: string) => study.disabledExercises.includes(id)

  function setExercise(id: string, enabled: boolean) {
    const next = new Set(study.disabledExercises)
    if (enabled) next.delete(id)
    else next.add(id)
    study = { ...study, disabledExercises: [...next] }
  }

  /** Turn a whole modality group on or off at once. */
  function setGroup(modality: string, enabled: boolean) {
    const ids = drillGroups.find((g) => g.modality === modality)?.items.map((i) => i.id) ?? []
    const next = new Set(study.disabledExercises)
    for (const id of ids) {
      if (enabled) next.delete(id)
      else next.add(id)
    }
    study = { ...study, disabledExercises: [...next] }
  }

  async function saveStudy() {
    note = ''
    try {
      const r = await api<{ study: StudyPrefs }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ study }),
      })
      study = r.study
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

  async function saveRetention() {
    note = ''
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ desiredRetention: Number(desiredRetention) }),
      })
      note = 'Desired retention saved.'
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
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    session.user = null
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

<div class="border-b border-ink-700 pt-5 pb-6">
  <h1 class="display text-3xl text-ink-100">Settings</h1>
  <p class="mt-1 text-xs text-ink-400">These apply to {session.user?.username} only.</p>
</div>

{#if error}
  <p class="mb-3 rounded-lg bg-ember-950 px-3 py-2 text-sm text-ember-300">{error}</p>
{/if}
{#if note}
  <p class="mb-3 rounded-lg bg-jade-950 px-3 py-2 text-sm text-jade-300">{note}</p>
{/if}

<!-- OpenRouter key ------------------------------------------------------->
<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.azure)}>
  <h2 class="display text-sm text-ink-100">Your OpenRouter key</h2>
  <p class="mt-1 text-xs text-ink-400">
    Status:
    {#if keyStatus === 'user'}<span class="text-jade-400">using your own key</span>
    {:else if keyStatus === 'server'}<span class="text-brass-400">using the server's key</span>
    {:else}<span class="text-ember-400">not set — chat is disabled</span>{/if}
  </p>
  <div class="mt-3 flex gap-2">
    <input
      type="password"
      bind:value={keyInput}
      placeholder={keyStatus === 'user' ? 'Replace key…' : 'sk-or-…'}
      class="flex-1 rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm"
    />
    <button onclick={saveKey} class="btn btn-primary px-3 py-2 text-sm">Save</button>
  </div>
</section>

<!-- Models --------------------------------------------------------------->
<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.gold)}>
  <h2 class="display text-sm text-ink-100">Models per role</h2>
  <p class="mt-1 text-xs text-ink-400">
    Pick any model your OpenRouter key can use. The list comes from the API and follows your
    account's provider preferences, privacy settings and guardrails.
  </p>
  <input
    bind:value={modelFilter}
    onchange={loadModels}
    placeholder="filter models (e.g. qwen, deepseek)"
    class="mt-3 w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm"
  />
  {#if modelsLoading}
    <p class="mt-2 flex items-center gap-2 text-xs text-ink-400">
      <Spinner size={12} label="Loading the model catalogue" /> Loading the model catalogue…
    </p>
  {/if}
  <datalist id="models">
    {#each models as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
  </datalist>
  <div class="mt-3 space-y-2">
    {#each ROLE_KEYS as role (role)}
      <label class="block">
        <span class="mb-1 block text-xs text-ink-400">{ROLE_LABEL[role]}</span>
        <input
          list="models"
          bind:value={roles[role]}
          class="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm"
        />
      </label>
    {/each}
  </div>
  <div class="mt-3 flex items-center justify-between">
    <button onclick={saveRoles} class="btn btn-primary px-3 py-2 text-sm">Save models</button>
    {#if roleDefaults}
      <button onclick={() => (roles = { ...roleDefaults! })} class="text-xs text-ink-400 underline"
        >reset to defaults</button
      >
    {/if}
  </div>
</section>

<!-- Voice ---------------------------------------------------------------->
<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.violet)}>
  <h2 class="display text-sm text-ink-100">Voice</h2>
  <div class="mt-2 flex gap-2">
    <button
      onclick={() => (voiceMode = 'preset')}
      class="flex-1 rounded-md border px-3 py-2 text-sm {voiceMode === 'preset'
        ? 'border-seal-400 text-seal-300'
        : 'border-ink-600 text-ink-300'}">Preset speakers</button
    >
    <button
      onclick={() => (voiceMode = 'design')}
      class="flex-1 rounded-md border px-3 py-2 text-sm {voiceMode === 'design'
        ? 'border-seal-400 text-seal-300'
        : 'border-ink-600 text-ink-300'}">Voice design</button
    >
  </div>
  <p class="mt-2 text-xs text-ink-400">
    {voiceMode === 'preset'
      ? 'Built-in Qwen3-TTS speakers (fast, lowest memory).'
      : 'Describe a voice in the text box (e.g. "a warm, patient Mandarin teacher").'}
  </p>
  <div class="mt-3 space-y-2">
    {#each Object.entries(VOICE_PRESETS) as [lc, list] (lc)}
      <label class="block">
        <span class="mb-1 block text-xs text-ink-400"
          >{lc.toUpperCase()}{voiceMode === 'design' ? ' · voice description' : ''}</span
        >
        <input
          list={voiceMode === 'preset' ? `voices-${lc}` : undefined}
          bind:value={voices[lc]}
          placeholder={voiceMode === 'design'
            ? 'a calm, professional teacher with a clear, warm voice'
            : list[0]}
          class="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm"
        />
        <datalist id="voices-{lc}">
          {#each list as v (v)}<option value={v}></option>{/each}
        </datalist>
      </label>
    {/each}
  </div>
  <button onclick={saveVoice} class="btn btn-primary mt-3 px-3 py-2 text-sm">Save voice</button>
</section>

<!-- Speech engine -------------------------------------------------------->
<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.jade)}>
  <div class="flex items-center justify-between gap-3">
    <div>
      <h2 class="display text-sm text-ink-100">Speech engine</h2>
      <p class="text-xs text-ink-400">
        {speech?.ready ? 'awake' : speech?.running ? 'starting' : 'asleep'}
        {#if speech?.models?.length}· {speech.models.join(', ')}{/if}
      </p>
    </div>
    <div class="flex gap-2">
      {#if !speech?.ready}
        <button
          type="button"
          onclick={wake}
          disabled={waking || speech?.running}
          aria-busy={waking || speech?.running}
          class="btn btn-ghost px-3 py-1.5 text-xs"
        >
          {#if waking || speech?.running}<Spinner size={12} label="Waking the speech engine" /> Waking…{:else}Wake{/if}
        </button>
      {/if}
      <button type="button" onclick={free} class="btn btn-ghost px-3 py-1.5 text-xs"
        >Free memory</button
      >
    </div>
  </div>
  <p class="mt-2 text-xs text-ink-400">
    Voice cards start the models on demand; they unload when idle.
  </p>
</section>

<!-- Daily goal ----------------------------------------------------------->
<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.gold)}>
  <h2 class="display text-sm text-ink-100">Daily goal</h2>
  <p class="mt-1 text-xs text-ink-400">XP to earn each UTC day to keep your streak.</p>
  <div class="mt-3 flex gap-2">
    <input
      type="number"
      min="10"
      max="1000"
      step="10"
      bind:value={dailyGoal}
      class="w-28 rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm"
    />
    <button onclick={saveDailyGoal} class="btn btn-primary px-3 py-2 text-sm">Save</button>
  </div>
</section>

<!-- Spaced repetition ----------------------------------------------------->
<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.azure)}>
  <h2 class="display text-sm text-ink-100">Spaced repetition</h2>
  <p class="mt-1 text-xs text-ink-400">
    Anki-style FSRS-6 scheduling. Desired retention is the chance you want to recall a card when it
    comes up — higher means shorter intervals and more reviews.
  </p>
  <div class="mt-3 flex items-center gap-2">
    <input
      type="number"
      min="70"
      max="97"
      step="1"
      bind:value={desiredRetention}
      class="w-24 rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm"
    />
    <span class="text-sm text-ink-400">%</span>
    <button onclick={saveRetention} class="btn btn-primary px-3 py-2 text-sm">Save</button>
  </div>
</section>

<!-- Study ---------------------------------------------------------------->
<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.brass)}>
  <h2 class="display text-sm text-ink-100">Study</h2>
  <p class="mt-1 text-xs text-ink-400">
    Shape how decks are drilled. These apply to your account across every deck.
  </p>

  <div class="mt-3 space-y-2">
    <label class="flex items-center justify-between gap-3">
      <span class="text-sm">Show Zhuyin under Chinese</span>
      <input type="checkbox" bind:checked={study.showZhuyin} class="h-4 w-4 accent-seal-400" />
    </label>
    <label class="flex items-center justify-between gap-3">
      <span class="text-sm">Show furigana over Japanese kanji</span>
      <input type="checkbox" bind:checked={study.showFurigana} class="h-4 w-4 accent-seal-400" />
    </label>
  </div>

  <p class="mt-4 text-xs text-ink-400">Exercise kinds offered when you practise.</p>
  <div class="mt-2 space-y-3">
    {#each drillGroups as group (group.modality)}
      {@const enabledCount = group.items.filter((i) => !isDisabled(i.id)).length}
      <div class="rounded-lg border border-ink-700 p-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-wide text-ink-300">
            {MODALITY_LABEL[group.modality] ?? group.modality}
          </span>
          <button
            type="button"
            onclick={() => setGroup(group.modality, enabledCount === 0)}
            class="text-xs text-ink-400 underline"
          >
            {enabledCount === 0 ? 'turn all on' : 'turn all off'}
          </button>
        </div>
        <div class="mt-2 space-y-1.5">
          {#each group.items as ex (ex.id)}
            <label class="flex items-center justify-between gap-3">
              <span class="text-sm {isDisabled(ex.id) ? 'text-ink-500' : ''}">{ex.title}</span>
              <input
                type="checkbox"
                checked={!isDisabled(ex.id)}
                onchange={(e) => setExercise(ex.id, e.currentTarget.checked)}
                class="h-4 w-4 accent-seal-400"
              />
            </label>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <button onclick={saveStudy} class="btn btn-primary mt-3 px-3 py-2 text-sm">
    Save study options
  </button>
</section>

<!-- Combat ---------------------------------------------------------------->
<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.ember)}>
  <h2 class="display text-sm text-ink-100">Combat</h2>
  <p class="mt-1 text-xs text-ink-400">
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
      class="w-24 rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm"
    />
    <span class="text-sm text-ink-400">%</span>
    <button onclick={saveFoodThreshold} class="btn btn-primary px-3 py-2 text-sm">Save</button>
  </div>
</section>

<!-- Account -------------------------------------------------------------->
<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.violet)}>
  <h2 class="display text-sm text-ink-100">Account</h2>
  <label class="mt-3 block">
    <span class="mb-1 block text-xs text-ink-400">Display name</span>
    <div class="flex gap-2">
      <input
        bind:value={handle}
        class="flex-1 rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm"
      />
      <button onclick={saveProfile} class="btn btn-primary px-3 py-2 text-sm">Save</button>
    </div>
  </label>
  <p class="mt-3 text-xs text-ink-400">
    @{session.user?.username} · {session.user?.role}
  </p>
  <button
    onclick={doLogout}
    class="mt-3 rounded-md border border-ember-800 px-3 py-2 text-sm text-ember-300"
    >Sign out</button
  >
</section>

<!-- Admin ---------------------------------------------------------------->
{#if isAdmin}
  <section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.brass)}>
    <h2 class="display text-sm text-ink-100">Users ({users.length})</h2>
    <ul class="mt-3 space-y-2">
      {#each users as u (u.id)}
        <li class="flex items-center justify-between rounded-md border border-ink-700 px-3 py-2">
          <div>
            <div class="text-sm">{u.handle}</div>
            <div class="text-xs text-ink-400">@{u.username} · {u.role}</div>
          </div>
          {#if u.id !== session.user?.id}
            <button
              onclick={() => removeUser(u.id)}
              class="rounded-lg border border-ember-800 px-2 py-1 text-xs text-ember-300"
              >Delete</button
            >
          {/if}
        </li>
      {/each}
    </ul>
    <p class="mt-3 text-xs text-ink-400">
      Everyone's conversations, settings and keys are stored separately.
    </p>
  </section>
{/if}
