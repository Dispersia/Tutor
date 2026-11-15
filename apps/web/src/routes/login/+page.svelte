<script lang="ts">
  import { href } from '#lib/paths'
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
      void goto(href('/home'))
    } catch (err) {
      error = (err as Error).message
    } finally {
      busy = false
    }
  }
</script>

<div class="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 pt-safe pb-safe">
  <div class="mb-7 text-center">
    <div class="display text-4xl text-ink-100">tutor</div>
    <p class="mt-1 text-sm text-ink-400">
      {mode === 'login' ? 'Sign in to continue.' : 'Create your account.'}
    </p>
  </div>

  <form onsubmit={submit} class="space-y-4">
    <label class="block">
      <span class="eyebrow mb-1 block">Username</span>
      <input
        bind:value={username}
        autocomplete="username"
        autocapitalize="none"
        required
        class="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-3 outline-none focus:border-seal-400"
      />
    </label>
    <label class="block">
      <span class="eyebrow mb-1 block">Password</span>
      <input
        type="password"
        bind:value={password}
        autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
        required
        class="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-3 outline-none focus:border-seal-400"
      />
    </label>

    {#if mode === 'register'}
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="eyebrow mb-1 block">Learning</span>
          <select
            bind:value={targetLang}
            class="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-3"
          >
            <option value="zh">Mandarin</option>
            <option value="ja">Japanese</option>
            <option value="ko">Korean</option>
            <option value="es">Spanish</option>
          </select>
        </label>
        <label class="block">
          <span class="eyebrow mb-1 block">Level</span>
          <select
            bind:value={level}
            class="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-3"
          >
            <option value="hsk1">HSK 1</option>
            <option value="n5">JLPT N5</option>
            <option value="a1">A1</option>
          </select>
        </label>
      </div>
    {/if}

    {#if error}
      <p class="rounded-lg bg-ember-950 px-3 py-2 text-sm text-ember-300">{error}</p>
    {/if}

    <button type="submit" disabled={busy} class="btn btn-primary w-full py-3">
      {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
    </button>
  </form>

  <button
    onclick={() => {
      mode = mode === 'login' ? 'register' : 'login'
      error = ''
    }}
    class="mt-4 text-sm text-ink-400 underline hover:text-ink-300"
  >
    {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
  </button>

  <p class="mt-8 text-xs leading-relaxed text-ink-500">
    Accounts are stored on this Mac only. Each person gets their own history, settings and
    OpenRouter key. The first account created is the admin.
  </p>
</div>
