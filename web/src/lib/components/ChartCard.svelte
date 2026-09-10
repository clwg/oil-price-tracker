<script lang="ts">
	import TimeSeriesChart from './TimeSeriesChart.svelte';
	import type { ChartSeries } from '$lib/types';
	import { formatDate, formatValue } from '$lib/format';
	import { seriesColor } from '$lib/theme';

	let {
		title,
		subtitle = '',
		series = [] as ChartSeries[],
		height = 300,
		mode = 'value' as 'value' | 'indexed',
		note = ''
	} = $props();

	let view = $state<'chart' | 'table'>('chart');

	// Table view is the WCAG-clean twin: every plotted value reachable without
	// hovering, which is also the required relief for the lighter series hues.
	const tableRows = $derived.by(() => {
		const byDate = new Map<string, (number | null)[]>();
		series.forEach((s, i) => {
			for (const [date, value] of s.points) {
				let row = byDate.get(date);
				if (!row) byDate.set(date, (row = series.map(() => null)));
				row[i] = value;
			}
		});
		return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 250);
	});
</script>

<section class="card">
	<div class="card-head">
		<div>
			<h3 class="card-title">{title}</h3>
			{#if subtitle}<p class="card-sub">{subtitle}</p>{/if}
		</div>
		<div class="segmented" role="group" aria-label="{title} view">
			<button aria-pressed={view === 'chart'} onclick={() => (view = 'chart')}>Chart</button>
			<button aria-pressed={view === 'table'} onclick={() => (view = 'table')}>Table</button>
		</div>
	</div>

	{#if series.length > 1}
		<!-- A legend is always present for two or more series: identity is never
		     carried by colour alone. -->
		<ul class="legend">
			{#each series as s, i}
				<li>
					<span class="key" style:background={seriesColor(i)}></span>
					<span>{s.label}</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if view === 'chart'}
		<TimeSeriesChart {series} {height} {mode} />
	{:else}
		<div class="scroll-x table-wrap">
			<table class="data">
				<thead>
					<tr>
						<th>Week ending</th>
						{#each series as s}<th class="num">{s.label}</th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each tableRows as [date, values]}
						<tr>
							<td>{formatDate(date)}</td>
							{#each values as value, i}
								<td class="num">{value === null ? '-' : formatValue(value, series[i].unit)}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if note}<p class="note muted">{note}</p>{/if}
</section>

<style>
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 18px;
		list-style: none;
		margin: 0 0 10px;
		padding: 0;
		font-size: 12px;
		color: var(--text-secondary);
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	/* Legends mirror the mark: a line chart gets a line key. */
	.key {
		width: 14px;
		height: 2px;
		border-radius: 1px;
		flex-shrink: 0;
	}

	.table-wrap {
		max-height: 320px;
		overflow-y: auto;
	}

	.note {
		font-size: 11.5px;
		margin: 12px 0 0;
	}
</style>
