<script lang="ts">
	import Sparkline from './Sparkline.svelte';
	import { delta, displayUnit, formatDelta, formatValue } from '$lib/format';
	import type { Headline } from '$lib/server/queries';

	let {
		stat,
		/** For inventories a build is not inherently "good", so the delta stays
		 *  neutral unless the caller says direction carries meaning. */
		directional = false,
		compare = 'week' as 'week' | 'year'
	}: { stat: Headline; directional?: boolean; compare?: 'week' | 'year' } = $props();

	const previous = $derived(compare === 'week' ? stat.prior_value : stat.year_ago_value);
	const d = $derived(delta(stat.latest_value, previous));
	const tone = $derived(!directional || !d || d.direction === 'flat' ? 'neutral' : d.direction);
</script>

<div class="tile">
	<div class="label">{stat.label}</div>
	<div class="value-row">
		<span class="value">{formatValue(stat.latest_value, stat.unit)}</span>
		<span class="unit">{displayUnit(stat.latest_value, stat.unit)}</span>
	</div>
	<div class="foot">
		<span class="delta {tone}">
			{#if d && d.direction !== 'flat'}<span aria-hidden="true">{d.direction === 'up' ? '▲' : '▼'}</span>{/if}
			<span class="tabular">{formatDelta(d)}</span>
		</span>
		<span class="vs">vs {compare === 'week' ? 'last week' : 'last year'}</span>
		<div class="spark"><Sparkline points={stat.spark} /></div>
	</div>
</div>

<style>
	.tile {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 14px 16px 12px;
		min-width: 0;
		/* The sparkline is fixed-width; clip rather than let it escape the card
		   when a long label squeezes the row. */
		overflow: hidden;
	}

	.label {
		font-size: 12px;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.value-row {
		display: flex;
		align-items: baseline;
		gap: 5px;
		margin-top: 5px;
	}

	/* Proportional figures: tabular-nums makes a large number look loose. */
	.value {
		font-size: 26px;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.unit {
		font-size: 11.5px;
		color: var(--text-muted);
	}

	.foot {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
		font-size: 11.5px;
		min-width: 0;
	}

	.delta {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-weight: 600;
		font-size: 11.5px;
	}

	.delta.neutral { color: var(--text-secondary); }
	.delta.up { color: var(--up); }
	.delta.down { color: var(--down); }

	.vs {
		color: var(--text-muted);
		white-space: nowrap;
	}

	.spark {
		margin-left: auto;
		flex: 0 1 auto;
		overflow: hidden;
		line-height: 0;
	}
</style>
