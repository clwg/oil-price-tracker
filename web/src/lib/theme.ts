/** Categorical slot order. This exact order and these exact hexes were checked
 *  with the palette validator in both modes: worst adjacent CVD ΔE 9.1 light /
 *  8.4 dark, worst adjacent normal-vision ΔE 22.9 / 19.8. Do not reorder or
 *  substitute hues without re-running that check - the ordering IS the
 *  colourblind-safety mechanism, not a cosmetic choice.
 *
 *  Colour follows the entity: a series keeps its slot when siblings are
 *  filtered out, so the palette is indexed by selection position, never rank.
 */
export const SERIES_SLOTS = 4;

export function seriesColor(index: number): string {
	return `var(--series-${(index % SERIES_SLOTS) + 1})`;
}

export type ThemeMode = 'light' | 'dark';

export function initTheme(): ThemeMode {
	if (typeof document === 'undefined') return 'light';
	const stored = document.documentElement.dataset.theme as ThemeMode | undefined;
	if (stored === 'light' || stored === 'dark') return stored;
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(mode: ThemeMode) {
	document.documentElement.dataset.theme = mode;
	try {
		localStorage.setItem('theme', mode);
	} catch {
		/* private mode */
	}
}

export const RANGES = [
	{ label: '1Y', years: 1 },
	{ label: '5Y', years: 5 },
	{ label: '10Y', years: 10 },
	{ label: 'Max', years: 0 }
] as const;

export function rangeStart(years: number, latest: string): string | undefined {
	if (!years) return undefined;
	const [y, m, d] = latest.split('-').map(Number);
	const start = new Date(Date.UTC(y - years, m - 1, d));
	return start.toISOString().slice(0, 10);
}
