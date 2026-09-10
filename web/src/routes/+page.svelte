<script lang="ts">
	import ChartCard from '$lib/components/ChartCard.svelte';
	import StatTile from '$lib/components/StatTile.svelte';
	import { formatDate, formatValue, displayUnit, delta, formatDelta } from '$lib/format';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const RANGES = [
		{ label: '1Y', years: 1 },
		{ label: '5Y', years: 5 },
		{ label: '10Y', years: 10 },
		{ label: 'Max', years: 0 }
	];

	// The one number the dashboard leads with.
	const hero = $derived(data.headlines.find((h) => h.sourcekey === 'RWTC'));
	const heroDelta = $derived(hero ? delta(hero.latest_value, hero.prior_value) : null);

	// Inventories are shown neutral: a build is not "good" or "bad" on its own.
	const DIRECTIONAL = new Set(['RWTC', 'RBRTE', 'EMM_EPMR_PTE_NUS_DPG']);

	let pending = $state(false);

	async function setRange(years: number) {
		pending = true;
		const params = new URLSearchParams($page.url.searchParams);
		params.set('years', String(years));
		await goto(`?${params}`, { keepFocus: true, noScroll: true });
		pending = false;
	}
</script>

<svelte:head>
	<title>U.S. Petroleum Dashboard - EIA Weekly Status Report</title>
</svelte:head>

{#if !data.meta.series}
	<!-- `docker compose up -d` starts the app before anything is loaded, so say
	     what to do rather than showing an empty shell. -->
	<section class="card first-run">
		<h1>No data loaded yet</h1>
		<p>
			The database is running but empty. Load the EIA Weekly Petroleum Status Report:
		</p>
		<pre><code>DATABASE_URL=postgres://oil:oil@localhost:5432/oil \
  ingest/.venv/bin/python ingest/eia_ingest.py</code></pre>
		<p class="muted">
			Takes about 35 seconds and downloads roughly 20 MB - 1,118 series back to 1982. Reload this
			page once it finishes.
		</p>
	</section>
{:else}
<section class="hero">
	<div>
		<p class="eyebrow">Week ending {data.meta.report_date ? formatDate(data.meta.report_date, 'long') : '-'}</p>
		{#if hero}
			<div class="hero-figure">
				<span class="hero-value">{formatValue(hero.latest_value, hero.unit)}</span>
				<span class="hero-unit">{displayUnit(hero.latest_value, hero.unit)}</span>
				<span class="hero-delta {heroDelta?.direction ?? 'flat'}">
					{#if heroDelta && heroDelta.direction !== 'flat'}{heroDelta.direction === 'up' ? '▲' : '▼'}{/if}
					{formatDelta(heroDelta)}
				</span>
			</div>
			<p class="hero-label">
				WTI crude oil spot price, Cushing OK · {formatDate(hero.latest_period)}
			</p>
		{/if}
	</div>

	<dl class="coverage">
		<div><dt>Series tracked</dt><dd class="tabular">{data.meta.series.toLocaleString()}</dd></div>
		<div><dt>Observations</dt><dd class="tabular">{data.meta.observations.toLocaleString()}</dd></div>
		<div><dt>History from</dt><dd class="tabular">{data.meta.earliest?.slice(0, 4)}</dd></div>
	</dl>
</section>

<!-- One filter row, above everything it scopes. -->
<div class="filters">
	<span class="filter-label">Time range</span>
	<div class="segmented" role="group" aria-label="Time range">
		{#each RANGES as range}
			<button aria-pressed={data.years === range.years} onclick={() => setRange(range.years)}>
				{range.label}
			</button>
		{/each}
	</div>
	<span class="hint muted">Scopes every chart below</span>
</div>

<section class="tiles">
	{#each data.headlines as stat}
		<StatTile {stat} directional={DIRECTIONAL.has(stat.sourcekey)} />
	{/each}
</section>

<!-- Refetch holds the previous render at reduced opacity: no skeleton flash. -->
<div class="grid" class:pending>
	<ChartCard
		title="Crude oil spot prices"
		subtitle="WTI at Cushing against Europe Brent"
		series={data.charts.prices}
		height={320}
	/>

	<ChartCard
		title="Crude oil inventories"
		subtitle="Commercial stocks against the Strategic Petroleum Reserve"
		series={data.charts.crudeStocks}
		height={320}
	/>

	<ChartCard
		title="Crude oil supply balance"
		subtitle="Field production, commercial imports and exports"
		series={data.charts.supply}
		height={300}
	/>

	<ChartCard
		title="Refinery utilization"
		subtitle="Percent of operable capacity in use"
		series={data.charts.refining}
		height={300}
		note="Values above 100% occur when refineries run above their rated operable capacity."
	/>

	<ChartCard
		title="Refined product inventories"
		subtitle="Ending stocks of the three major refined products"
		series={data.charts.productStocks}
		height={300}
	/>

	<ChartCard
		title="Product supplied (demand proxy)"
		subtitle="EIA's consumption proxy, 4-week average"
		series={data.charts.demand}
		height={300}
		note="Product supplied is EIA's proxy for consumption: volumes moving from primary storage into the market."
	/>

	<ChartCard
		title="Retail fuel prices"
		subtitle="U.S. average pump price"
		series={data.charts.retail}
		height={300}
	/>
</div>
{/if}

<style>
	.first-run {
		max-width: 62ch;
		margin: 32px auto;
	}

	.first-run h1 {
		font-size: 20px;
		margin-bottom: 8px;
	}

	.first-run p {
		font-size: 13px;
		margin: 0 0 12px;
	}

	.first-run pre {
		background: var(--wash);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 12px 14px;
		overflow-x: auto;
		font-size: 12px;
		line-height: 1.6;
		margin: 0 0 12px;
	}

	.hero {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 32px;
		flex-wrap: wrap;
		padding: 8px 0 26px;
	}

	.eyebrow {
		margin: 0 0 6px;
		font-size: 12px;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.hero-figure {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	/* Hero figure: same sans as everything else, proportional figures. */
	.hero-value {
		font-size: 52px;
		font-weight: 600;
		letter-spacing: -0.03em;
		line-height: 1;
	}

	.hero-unit {
		font-size: 15px;
		color: var(--text-muted);
	}

	.hero-delta {
		font-size: 15px;
		font-weight: 600;
		margin-left: 4px;
	}

	.hero-delta.up { color: var(--up); }
	.hero-delta.down { color: var(--down); }
	.hero-delta.flat { color: var(--text-secondary); }

	.hero-label {
		margin: 8px 0 0;
		font-size: 13px;
		color: var(--text-secondary);
	}

	.coverage {
		display: flex;
		gap: 28px;
		margin: 6px 0 0;
	}

	.coverage dt {
		font-size: 11.5px;
		color: var(--text-muted);
	}

	.coverage dd {
		margin: 2px 0 0;
		font-size: 17px;
		font-weight: 600;
	}

	.filters {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}

	.filter-label {
		font-size: 12.5px;
		color: var(--text-secondary);
		font-weight: 600;
	}

	.hint {
		font-size: 11.5px;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 12px;
		margin-bottom: 22px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
		gap: 16px;
		transition: opacity 0.15s;
	}

	.grid.pending {
		opacity: 0.55;
	}

	@media (max-width: 900px) {
		.grid {
			grid-template-columns: 1fr;
		}
		.hero-value {
			font-size: 42px;
		}
	}
</style>
