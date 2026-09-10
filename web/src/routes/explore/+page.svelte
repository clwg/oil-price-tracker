<script lang="ts">
	import ChartCard from '$lib/components/ChartCard.svelte';
	import { formatDate, formatValue } from '$lib/format';
	import { seriesColor } from '$lib/theme';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const MAX_SELECTED = 4;
	let pending = $state(false);

	async function update(changes: Record<string, string>) {
		pending = true;
		const params = new URLSearchParams($page.url.searchParams);
		for (const [key, value] of Object.entries(changes)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		await goto(`?${params}`, { keepFocus: true, noScroll: true });
		pending = false;
	}

	function toggle(id: number) {
		const set = new Set(data.selected);
		if (set.has(id)) set.delete(id);
		else {
			// Colour follows the entity: appending keeps existing slots stable.
			if (set.size >= MAX_SELECTED) return;
			set.add(id);
		}
		update({ ids: [...set].join(',') });
	}

	let searchTerm = $state('');
	$effect(() => {
		searchTerm = data.filters.search;
	});

	let debounce: ReturnType<typeof setTimeout>;
	function onSearch(event: Event) {
		const value = (event.target as HTMLInputElement).value;
		clearTimeout(debounce);
		debounce = setTimeout(() => update({ q: value, ids: '' }), 280);
	}

	// Mixed units cannot share one axis, so offer indexing instead of a 2nd axis.
	const units = $derived(new Set(data.chosen.map((s) => s.unit)));
	const mixedUnits = $derived(units.size > 1);
	const chartMode = $derived(mixedUnits ? 'indexed' : data.filters.mode);

	const RANGES = [
		{ label: '1Y', years: 1 },
		{ label: '5Y', years: 5 },
		{ label: '10Y', years: 10 },
		{ label: 'Max', years: 0 }
	];
</script>

<svelte:head><title>Explore series - U.S. Petroleum Dashboard</title></svelte:head>

<header class="intro">
	<h1>Explore every series</h1>
	<p class="muted">
		All {data.facets.categories.reduce((n, c) => n + c.n, 0).toLocaleString()} series from the report, back to 1982.
		Pick up to {MAX_SELECTED} to compare.
	</p>
</header>

<div class="filters">
	<input
		type="search"
		placeholder="Search series or EIA sourcekey…"
		value={searchTerm}
		oninput={onSearch}
		aria-label="Search series"
	/>

	<select value={data.filters.category} onchange={(e) => update({ category: e.currentTarget.value, ids: '' })} aria-label="Category">
		<option value="">All categories</option>
		{#each data.facets.categories as c}<option value={c.v}>{c.v} ({c.n})</option>{/each}
	</select>

	<select value={data.filters.area} onchange={(e) => update({ area: e.currentTarget.value, ids: '' })} aria-label="Region">
		<option value="">All regions</option>
		{#each data.facets.areas as a}<option value={a.v}>{a.v} ({a.n})</option>{/each}
	</select>

	<select value={data.filters.product} onchange={(e) => update({ product: e.currentTarget.value, ids: '' })} aria-label="Product">
		<option value="">All products</option>
		{#each data.facets.products as p}<option value={p.v}>{p.v} ({p.n})</option>{/each}
	</select>

	<select value={data.filters.frequency} onchange={(e) => update({ frequency: e.currentTarget.value, ids: '' })} aria-label="Frequency">
		<option value="">Any frequency</option>
		{#each data.facets.frequencies as f}<option value={f.v}>{f.v} ({f.n})</option>{/each}
	</select>

	<div class="segmented" role="group" aria-label="Time range">
		{#each RANGES as range}
			<button aria-pressed={data.filters.years === range.years} onclick={() => update({ years: String(range.years) })}>
				{range.label}
			</button>
		{/each}
	</div>
</div>

<div class="split" class:pending>
	<aside>
		<div class="list-head">
			<span>{data.matches.length} match{data.matches.length === 1 ? '' : 'es'}</span>
			{#if data.selected.length}
				<button class="clear" onclick={() => update({ ids: '' })}>Clear selection</button>
			{/if}
		</div>
		<ul class="series-list">
			{#each data.matches as s}
				{@const index = data.selected.indexOf(s.id)}
				<li>
					<label class:selected={index >= 0}>
						<input
							type="checkbox"
							checked={index >= 0}
							disabled={index < 0 && data.selected.length >= MAX_SELECTED}
							onchange={() => toggle(s.id)}
						/>
						{#if index >= 0}
							<span class="swatch" style:background={seriesColor(index)}></span>
						{/if}
						<span class="s-name">{s.short_name}</span>
						<span class="s-meta muted">{s.sourcekey} · {s.frequency} · {s.unit}</span>
					</label>
				</li>
			{:else}
				<li class="empty muted">No series match these filters.</li>
			{/each}
		</ul>
	</aside>

	<div class="main">
		{#if data.chosen.length}
			<ChartCard
				title={data.chosen.length === 1 ? data.chosen[0].label : 'Selected series'}
				subtitle={data.chosen.length === 1
					? `${data.chosen[0].sourcekey} · ${data.chosen[0].frequency}`
					: `${data.chosen.length} series compared`}
				series={data.chosen}
				mode={chartMode}
				height={400}
				note={mixedUnits
					? 'These series use different units, so each is indexed to 100 at the start of the range - comparing them on two y-axes would imply a correlation the data does not contain.'
					: ''}
			/>

			<section class="card detail">
				<h3 class="card-title">Selected series</h3>
				<div class="scroll-x">
					<table class="data">
						<thead>
							<tr>
								<th></th><th>Series</th><th>EIA key</th><th>Frequency</th>
								<th>Unit</th><th class="num">Latest</th><th>As of</th>
							</tr>
						</thead>
						<tbody>
							{#each data.chosen as s, i}
								{@const last = s.points[s.points.length - 1]}
								<tr>
									<td><span class="swatch" style:background={seriesColor(i)}></span></td>
									<td>{s.label}</td>
									<td class="mono">{s.sourcekey}</td>
									<td>{s.frequency}</td>
									<td>{s.unit}</td>
									<td class="num">{last ? formatValue(last[1], s.unit) : '-'}</td>
									<td>{last ? formatDate(last[0]) : '-'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{:else}
			<div class="card"><p class="muted">Select a series to plot it.</p></div>
		{/if}
	</div>
</div>

<style>
	.intro {
		padding: 4px 0 18px;
	}

	.intro h1 {
		font-size: 22px;
	}

	.intro p {
		margin: 4px 0 0;
		font-size: 13px;
	}

	.filters {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
		margin-bottom: 16px;
	}

	input[type='search'],
	select {
		font: inherit;
		font-size: 13px;
		padding: 6px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-1);
		color: var(--text-primary);
	}

	input[type='search'] {
		min-width: 260px;
		flex: 1 1 260px;
	}

	.split {
		display: grid;
		grid-template-columns: 340px 1fr;
		gap: 16px;
		align-items: start;
		transition: opacity 0.15s;
	}

	.split.pending {
		opacity: 0.6;
	}

	aside {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		position: sticky;
		top: 12px;
	}

	.list-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 14px;
		border-bottom: 1px solid var(--border);
		font-size: 12px;
		color: var(--text-secondary);
	}

	.clear {
		border: 0;
		background: none;
		color: var(--text-secondary);
		font-size: 12px;
		text-decoration: underline;
		padding: 0;
	}

	.series-list {
		list-style: none;
		margin: 0;
		padding: 6px;
		max-height: 620px;
		overflow-y: auto;
	}

	.series-list label {
		display: grid;
		grid-template-columns: auto auto 1fr;
		align-items: center;
		gap: 4px 8px;
		padding: 7px 8px;
		border-radius: 7px;
		cursor: pointer;
	}

	.series-list label:hover {
		background: var(--wash);
	}

	.series-list label.selected {
		background: var(--wash);
	}

	.series-list input {
		margin: 0;
		accent-color: var(--series-1);
	}

	.s-name {
		grid-column: 3;
		font-size: 12.5px;
		line-height: 1.35;
	}

	.s-meta {
		grid-column: 3;
		font-size: 11px;
	}

	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		display: inline-block;
	}

	.main {
		display: grid;
		gap: 16px;
		min-width: 0;
	}

	.detail .card-title {
		margin-bottom: 12px;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 11.5px;
	}

	.empty {
		padding: 20px 10px;
		font-size: 13px;
		list-style: none;
	}

	@media (max-width: 940px) {
		.split {
			grid-template-columns: 1fr;
		}
		aside {
			position: static;
		}
	}
</style>
