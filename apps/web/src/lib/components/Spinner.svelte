<script lang="ts">
  /** The one wait signal: an accent ring, sized where it stands. Never emoji. */
  let {
    size = 16,
    label = 'Loading',
    cls = '',
  }: { size?: number; label?: string; cls?: string } = $props()
</script>

<span class="spinner {cls}" style="--spinner-size: {size}px" role="status" aria-label={label}
></span>
