<script lang="ts">
  import { href } from '#lib/paths'
  import { onMount } from 'svelte'
  import { api } from '#lib/api'
  import type { ChatSession } from '#lib/types'

  let sessions = $state<ChatSession[]>([])
  let error = $state('')
  let loading = $state(true)

  onMount(async () => {
    try {
      sessions = (await api<{ sessions: ChatSession[] }>('/api/sessions')).sessions
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  })

  const when = (ts: number) =>
    new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
</script>

<div class="pt-4 pb-6">
  <h1 class="display text-2xl text-gold-200">History</h1>
  <p class="text-xs text-ink-400">Everything you have practised, only visible to you.</p>
</div>

{#if loading}
  <p class="text-sm text-ink-400">Loading…</p>
{:else if error}
  <p class="text-sm text-red-300">{error}</p>
{:else if sessions.length === 0}
  <p class="panel p-4 text-sm text-ink-400">
    No conversations yet. <a class="text-emerald-400 underline" href={href('/chat')}>Start one →</a>
  </p>
{:else}
  <ul class="space-y-2">
    {#each sessions as s (s.id)}
      <li>
        <a href={href(`/history/${s.id}`)} class="block panel px-4 py-3">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium">{s.title ?? 'Conversation'}</span>
            <span class="text-xs text-ink-400">{when(s.startedAt)}</span>
          </div>
          <div class="mt-0.5 text-xs text-ink-400">
            {s.kind}
            {s.lang ? `· ${s.lang.toUpperCase()}` : ''}
          </div>
        </a>
      </li>
    {/each}
  </ul>
{/if}
