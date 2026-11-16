<script lang="ts">
  import { href } from '#lib/paths'
  import { onMount } from 'svelte'
  import { api } from '#lib/api'
  import { accentStyle } from '#lib/theme'
  import { KIND_ACCENT, ACCENT } from '#lib/theme'
  import type { ChatSession } from '#lib/types'
  import Spinner from '#lib/components/Spinner.svelte'

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

  const kindAccent = (kind: string) => KIND_ACCENT[kind] ?? ACCENT.azure
</script>

<div class="border-b border-ink-700 pt-4 pb-5 mb-4">
  <h1 class="display text-3xl text-ink-100">History</h1>
  <p class="mt-1 text-xs text-ink-400">Everything you have practised, only visible to you.</p>
</div>

{#if loading}
  <p class="flex items-center gap-2 text-sm text-ink-400">
    <Spinner size={14} label="Loading history" /> Loading…
  </p>
{:else if error}
  <p class="text-sm text-ember-300">{error}</p>
{:else if sessions.length === 0}
  <p class="panel p-4 text-sm text-ink-400">
    No conversations yet. <a class="text-jade-400 underline" href={href('/chat')}>Start one →</a>
  </p>
{:else}
  <ul class="space-y-2 xl:grid xl:grid-cols-2 xl:gap-6 xl:space-y-0">
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
