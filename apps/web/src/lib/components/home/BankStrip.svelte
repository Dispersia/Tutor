<script lang="ts">
  /** The bank strip: what the player keeps, in one ruled line. The ledger is Bank. */

  import { href } from '#lib/paths'
  import { ACCENT, accentStyle } from '#lib/theme'

  interface Props {
    coins: number
    kinds: number
    worn: number
  }

  let { coins, kinds, worn }: Props = $props()
</script>

<a
  href={href('/bank')}
  class="panel panel-accent mt-4 flex min-h-11 items-center gap-3 p-3"
  style={accentStyle(ACCENT.brass)}
  aria-label="Bank"
>
  <span class="eyebrow" style="color: var(--accent)">Bank</span>
  <span class="display text-lg font-bold text-gold-200 tabular-nums">{coins}</span>
  <span class="text-xs text-ink-400">coins</span>
  <span class="ml-auto flex items-center gap-3 text-xs text-ink-400">
    <span
      ><span class="display text-sm font-bold text-ink-200 tabular-nums">{kinds}</span>
      kinds</span
    >
    <span><span class="display text-sm font-bold text-ink-200 tabular-nums">{worn}</span> worn</span
    >
    <span class="text-ink-400" aria-hidden="true">→</span>
  </span>
</a>
