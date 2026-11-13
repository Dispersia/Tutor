<script lang="ts">
  import { goto } from '$app/navigation'
  import { login, register } from '#lib/session.svelte'

  let mode = $state<'login' | 'register'>('login')
  let username = $state('')
  let password = $state('')
  let targetLang = $state('zh')
  let level = $state('hsk1')
  let error = $state('')
  let busy = $state(false)

  async function submit(e: SubmitEvent) {
    e.preventDefault()
    error = ''
    busy = true
    try {
      if (mode === 'login') await login(username, password)
      else await register(username, password, { targetLang, level })
      void goto('/home')
    } catch (err) {
      error = (err as Error).message
    } finally {
      busy = false
    }
  }
</script>

<div class="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 pt-safe pb-safe">
  <h1 class="text-3xl font-semibold tracking-tight">tutor</h1>
  <p class="mt-1 mb-6 text-sm text-neutral-400">
    {mode === 'login' ? 'Sign in to continue.' : 'Create your account.'}
  </p>

  <form onsubmit={submit} class="space-y-4">
    <label class="block">
      <span class="mb-1 block text-xs text-neutral-400">Username</span>
      <input
        bind:value={username}
        autocomplete="username"
        autocapitalize="none"
        required
        class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-3 outline-none focus:border-neutral-500"
      />
    </label>
    <label class="block">
      <span class="mb-1 block text-xs text-neutral-400">Password</span>
      <input
        type="password"
        bind:value={password}
        autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
        required
        class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-3 outline-none focus:border-neutral-500"
      />
    </label>

    {#if mode === 'register'}
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="mb-1 block text-xs text-neutral-400">Learning</span>
          <select
            bind:value={targetLang}
            class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-3"
          >
            <option value="zh">Mandarin</option>
            <option value="ja">Japanese</option>
            <option value="ko">Korean</option>
            <option value="es">Spanish</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-neutral-400">Level</span>
          <select
            bind:value={level}
            class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-3"
          >
            <option value="hsk1">HSK 1</option>
            <option value="n5">JLPT N5</option>
            <option value="a1">A1</option>
          </select>
        </label>
      </div>
    {/if}

    {#if error}
      <p class="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>
    {/if}

    <button
      type="submit"
      disabled={busy}
      class="w-full rounded-xl bg-emerald-500 py-3 font-medium text-black disabled:opacity-50"
    >
      {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
    </button>
  </form>

  <button
    onclick={() => {
      mode = mode === 'login' ? 'register' : 'login'
      error = ''
    }}
    class="mt-4 text-sm text-neutral-400 underline"
  >
    {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
  </button>

  <p class="mt-8 text-xs leading-relaxed text-neutral-600">
    Accounts are stored on this Mac only. Each person gets their own history, settings and
    OpenRouter key. The first account created is the admin.
  </p>
</div>
