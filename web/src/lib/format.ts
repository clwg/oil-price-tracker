/** One place decides how a unit is scaled and labelled, so a stat tile, a chart
 *  axis and a tooltip can never disagree about what "407" means.
 *
 *  EIA publishes volumes in thousands of barrels; the industry reads them in
 *  millions, so anything past 1,000 is scaled and relabelled. */
export type UnitScale = {
	divisor: number;
	/** Short label for a stat tile or axis caption, e.g. 'M bbl/d'. */
	label: string;
	/** Long label for a chart subtitle, e.g. 'million barrels per day'. */
	longLabel: string;
	decimals: number;
	prefix: string;
	suffix: string;
};

export function unitScale(unit: string, magnitude: number): UnitScale {
	const abs = Math.abs(magnitude);

	if (unit.startsWith('Dollars')) {
		const perBarrel = unit === 'Dollars per Barrel';
		return {
			divisor: 1,
			label: perBarrel ? '/bbl' : '/gal',
			longLabel: perBarrel ? 'dollars per barrel' : 'dollars per gallon',
			decimals: perBarrel ? 2 : 3,
			prefix: '$',
			suffix: ''
		};
	}

	if (unit === 'Percent') {
		return { divisor: 1, label: '', longLabel: 'percent', decimals: 1, prefix: '', suffix: '%' };
	}

	if (unit.includes('Barrels')) {
		const perDay = unit.includes('per Day');
		if (abs >= 1000) {
			return {
				divisor: 1000,
				label: perDay ? 'M bbl/d' : 'M bbl',
				longLabel: perDay ? 'million barrels per day' : 'million barrels',
				decimals: 1,
				prefix: '',
				suffix: ''
			};
		}
		return {
			divisor: 1,
			label: perDay ? 'k bbl/d' : 'k bbl',
			longLabel: perDay ? 'thousand barrels per day' : 'thousand barrels',
			decimals: 0,
			prefix: '',
			suffix: ''
		};
	}

	return { divisor: 1, label: unit, longLabel: unit.toLowerCase(), decimals: 1, prefix: '', suffix: '' };
}

function render(value: number, scale: UnitScale, decimals = scale.decimals): string {
	const scaled = value / scale.divisor;
	return (
		scale.prefix +
		scaled.toLocaleString('en-US', {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals
		}) +
		scale.suffix
	);
}

export function formatValue(value: number | null | undefined, unit: string): string {
	if (value === null || value === undefined || Number.isNaN(value)) return '-';
	return render(value, unitScale(unit, value));
}

export function displayUnit(value: number | null | undefined, unit: string): string {
	if (value === null || value === undefined) return '';
	return unitScale(unit, value).label;
}

/** Axis ticks share one scale for the whole axis -- derived from the domain,
 *  not per tick, so the ladder never mixes magnitudes. */
export function formatAxis(value: number, scale: UnitScale): string {
	const scaled = value / scale.divisor;
	const decimals = Number.isInteger(scaled) ? 0 : Math.min(scale.decimals, 2);
	return render(value, scale, decimals);
}

export function formatDate(iso: string, style: 'short' | 'long' = 'short'): string {
	const [y, m, d] = iso.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.toLocaleDateString('en-US', {
		timeZone: 'UTC',
		year: 'numeric',
		month: style === 'long' ? 'long' : 'short',
		day: 'numeric'
	});
}

export type Delta = { pct: number; abs: number; direction: 'up' | 'down' | 'flat' } | null;

export function delta(current: number | null, previous: number | null | undefined): Delta {
	if (current === null || previous === null || previous === undefined || previous === 0) return null;
	const abs = current - previous;
	const pct = (abs / Math.abs(previous)) * 100;
	return { pct, abs, direction: Math.abs(pct) < 0.05 ? 'flat' : abs > 0 ? 'up' : 'down' };
}

export function formatDelta(d: Delta): string {
	if (!d) return '-';
	const sign = d.pct > 0 ? '+' : '';
	return `${sign}${d.pct.toFixed(1)}%`;
}
