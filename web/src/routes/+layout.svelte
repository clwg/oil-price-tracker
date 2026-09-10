<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { initTheme, setTheme, type ThemeMode } from '$lib/theme';
	import { onMount } from 'svelte';

	let { children } = $props();
	let theme = $state<ThemeMode>('light');

	onMount(() => {
		theme = initTheme();
	});

	function toggle() {
		theme = theme === 'dark' ? 'light' : 'dark';
		setTheme(theme);
	}

	const nav = [
		{ href: '/', label: 'Overview' },
		{ href: '/explore', label: 'Explore' },
		{ href: '/report', label: 'Weekly report' }
	];
</script>

<div class="shell">
	<header>
		<div class="brand">
			<!-- Echoes the chart marks: 2px stroke, round caps, accent end-dot. -->
			<svg class="mark" viewBox="0 0 22 20" aria-hidden="true">
				<path
					d="M2 15 L7 10 L11 13 L17 5"
					fill="none"
					stroke="var(--series-1)"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<circle cx="17" cy="5" r="2.5" fill="var(--series-1)" />
			</svg>
			<div>
				<strong>U.S. Petroleum Dashboard</strong>
				<span class="src">EIA Weekly Petroleum Status Report</span>
			</div>
		</div>

		<nav>
			{#each nav as item}
				<a href={item.href} aria-current={$page.url.pathname === item.href ? 'page' : undefined}>
					{item.label}
				</a>
			{/each}
		</nav>

		<button class="theme" onclick={toggle} aria-label="Switch to {theme === 'dark' ? 'light' : 'dark'} theme">
			{theme === 'dark' ? '☀' : '☾'}
		</button>
	</header>

	<main>{@render children()}</main>

	<footer>
		<p>
			Source: <a href="https://www.eia.gov/petroleum/supply/weekly/" rel="noreferrer noopener" target="_blank"
				>U.S. Energy Information Administration, Weekly Petroleum Status Report</a
			>. Weekly figures are EIA estimates and are revised in later releases.
		</p>
	</footer>
</div>

<style>
	.shell {
		max-width: 1240px;
		margin: 0 auto;
		padding: 0 20px 56px;
	}

	header {
		display: flex;
		align-items: center;
		gap: 24px;
		padding: 18px 0 20px;
		flex-wrap: wrap;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-right: auto;
	}

	.mark {
		width: 22px;
		height: 20px;
		display: block;
		flex-shrink: 0;
	}

	.brand strong {
		display: block;
		font-size: 15px;
		line-height: 1.2;
	}

	.src {
		font-size: 11.5px;
		color: var(--text-muted);
	}

	nav {
		display: flex;
		gap: 4px;
	}

	nav a {
		text-decoration: none;
		font-size: 13px;
		color: var(--text-secondary);
		padding: 6px 12px;
		border-radius: 7px;
	}

	nav a:hover {
		background: var(--wash);
		color: var(--text-primary);
	}

	nav a[aria-current='page'] {
		background: var(--surface-1);
		border: 1px solid var(--border);
		color: var(--text-primary);
		font-weight: 600;
	}

	.theme {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: 8px;
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		font-size: 14px;
	}

	.theme:hover {
		background: var(--wash);
	}

	footer {
		margin-top: 40px;
		padding-top: 18px;
		border-top: 1px solid var(--border);
		font-size: 11.5px;
		color: var(--text-muted);
	}

	footer a {
		color: var(--text-secondary);
	}

	@media (max-width: 640px) {
		.brand .src {
			display: none;
		}
	}
</style>
