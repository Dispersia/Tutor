<script lang="ts">
  import { href } from '#lib/paths'
  import { onMount } from 'svelte'
  import { api } from '#lib/api'
  import { accentStyle } from '#lib/theme'
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

  const kindAccent = (kind: string) =>
    kind === 'chat' ? '#4fb0e8' : kind === 'voice' ? '#b085ef' : '#58c46b'
</script>

<div class="pt-5 pb-5">
  <p class="eyebrow">Your log</p>
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
        <a
          href={href(`/history/${s.id}`)}
          class="panel panel-accent block px-4 py-3"
          style={accentStyle(kindAccent(s.kind))}
        >
          <div class="flex items-center justify-between">
            <span class="display text-sm text-ink-200">{s.title ?? 'Conversation'}</span>
            <span class="text-xs text-ink-400">{when(s.startedAt)}</span>
          </div>
          <div class="mt-1">
            <span class="chip" style={accentStyle(kindAccent(s.kind))}>
              {s.kind}{s.lang ? ` · ${s.lang.toUpperCase()}` : ''}
            </span>
          </div>
        </a>
      </li>
    {/each}
  </ul>
{/if}
