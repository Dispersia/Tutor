<script lang="ts">
  import { href } from '#lib/paths'
  import { onMount } from 'svelte'
  import { api } from '#lib/api'
  import { accentStyle } from '#lib/theme'
  import { KIND_ACCENT, ACCENT } from '#lib/theme'
  import type { ChatSession } from '#lib/types'
  import Spinner from '#lib/components/Spinner.svelte'
  import { peekCached } from '#lib/cache'

  // Seed from the last fetch so returning to History lists at once.
  const cached = peekCached<{ sessions: ChatSession[] }>('/api/sessions')
  let sessions = $state<ChatSession[]>(cached?.sessions ?? [])
  let error = $state('')
  let loading = $state(cached === undefined)

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
  <p class="sub mt-1.5">Everything you have practised, only visible to you.</p>
</div>

{#if loading}
  <p class="banner flex items-center gap-2" style={accentStyle(ACCENT.azure)}>
    <Spinner size={14} label="Loading history" /> Loading…
  </p>
{:else if error}
  <p class="banner" style={accentStyle(ACCENT.ember)} role="alert">{error}</p>
{:else if sessions.length === 0}
  <p class="panel p-4 text-sm text-ink-400">
    No conversations yet. <a class="link" href={href('/chat')}>Start one →</a>
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
          <div class="flex items-baseline justify-between gap-3">
            <span class="display min-w-0 truncate text-base text-ink-100"
              >{s.title ?? 'Conversation'}</span
            >
            <span class="shrink-0 text-xs text-ink-400">{when(s.startedAt)}</span>
          </div>
          <div class="mt-1.5">
            <span class="chip" style={accentStyle(kindAccent(s.kind))}>
              {s.kind}{s.lang ? ` · ${s.lang.toUpperCase()}` : ''}
            </span>
          </div>
        </a>
      </li>
    {/each}
  </ul>
{/if}
