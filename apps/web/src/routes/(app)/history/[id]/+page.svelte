<script lang="ts">
  import { href } from '#lib/paths'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { ACCENT } from '#lib/theme'
  import type { Message } from '#lib/types'
  import { cachedResource } from '#lib/resource.svelte'

  const id = $derived(page.params.id)
  const conversation = cachedResource<{ messages: Message[] }>(() =>
    id ? `/api/sessions/${id}` : undefined,
  )
  const messages = $derived((conversation.data?.messages ?? []).filter((m) => m.role !== 'system'))
</script>

<div class="flex items-center gap-3 border-b border-ink-700 pt-4 pb-4 lg:mx-auto lg:max-w-3xl">
  <button onclick={() => goto(href('/history'))} class="link link-btn shrink-0 text-sm"
    >← Back</button
  >
  <h1 class="display truncate text-lg text-ink-100">Conversation</h1>
</div>

{#if conversation.error}
  <p class="banner lg:mx-auto lg:max-w-3xl" style="--accent: {ACCENT.ember}" role="alert">
    {conversation.error}
  </p>
{:else}
  <div class="space-y-3 pb-10 lg:mx-auto lg:max-w-3xl">
    {#each messages as m (m.id)}
      <div class={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
        <div
          class="max-w-[85%] break-words rounded-[12px] px-4 py-2.5 text-base whitespace-pre-wrap {m.role ===
          'user'
            ? 'bg-seal-400 text-ink-950'
            : 'border border-ink-700 bg-ink-900 text-ink-100'}"
        >
          {m.text}
        </div>
      </div>
    {/each}
  </div>
{/if}
