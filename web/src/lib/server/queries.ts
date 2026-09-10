import { sql, type Point, type Series } from './db';

/** Largest-Triangle-Three-Buckets: keeps visual shape (spikes, troughs) that
 *  naive striding drops. Runs server-side so the wire payload stays small. */
export function downsample(points: Point[], threshold: number): Point[] {
	const n = points.length;
	if (threshold >= n || threshold < 3) return points;

	const sampled: Point[] = [points[0]];
	const every = (n - 2) / (threshold - 2);
	let a = 0;

	for (let i = 0; i < threshold - 2; i++) {
		const rangeStart = Math.floor((i + 1) * every) + 1;
		const rangeEnd = Math.min(Math.floor((i + 2) * every) + 1, n);

		// Average of the next bucket forms the third triangle vertex.
		let avgX = 0;
		let avgY = 0;
		const avgCount = Math.max(1, rangeEnd - rangeStart);
		for (let j = rangeStart; j < rangeEnd; j++) {
			avgX += j;
			avgY += points[j][1];
		}
		avgX /= avgCount;
		avgY /= avgCount;

		const bucketStart = Math.floor(i * every) + 1;
		const bucketEnd = Math.floor((i + 1) * every) + 1;
		const [, ay] = points[a];

		let bestArea = -1;
		let bestIndex = bucketStart;
		for (let j = bucketStart; j < Math.min(bucketEnd, n); j++) {
			const area = Math.abs((a - avgX) * (points[j][1] - ay) - (a - j) * (avgY - ay));
			if (area > bestArea) {
				bestArea = area;
				bestIndex = j;
			}
		}
		sampled.push(points[bestIndex]);
		a = bestIndex;
	}

	sampled.push(points[n - 1]);
	return sampled;
}

export async function listSeries(filters: {
	search?: string;
	category?: string;
	area?: string;
	product?: string;
	frequency?: string;
	limit?: number;
}): Promise<Series[]> {
	const { search = '', category = '', area = '', product = '', frequency = '' } = filters;
	const limit = Math.min(filters.limit ?? 200, 2000);

	return sql<Series[]>`
		SELECT id, sourcekey, short_name, name, unit, frequency, table_id, table_title,
		       category, area, product, first_period, last_period, obs_count
		FROM series
		WHERE obs_count > 0
		  ${search ? sql`AND (short_name ILIKE ${'%' + search + '%'} OR sourcekey ILIKE ${'%' + search + '%'})` : sql``}
		  ${category ? sql`AND category = ${category}` : sql``}
		  ${area ? sql`AND area = ${area}` : sql``}
		  ${product ? sql`AND product = ${product}` : sql``}
		  ${frequency ? sql`AND frequency = ${frequency}` : sql``}
		ORDER BY obs_count DESC, short_name
		LIMIT ${limit}
	`;
}

export type SeriesWithPoints = Series & { points: Point[] };

export async function getSeriesData(
	ids: number[],
	opts: { from?: string; to?: string; maxPoints?: number } = {}
): Promise<SeriesWithPoints[]> {
	if (ids.length === 0) return [];
	const maxPoints = Math.min(opts.maxPoints ?? 800, 5000);

	const meta = await sql<Series[]>`
		SELECT id, sourcekey, short_name, name, unit, frequency, table_id, table_title,
		       category, area, product, first_period, last_period, obs_count
		FROM series WHERE id = ANY(${ids})
	`;

	const rows = await sql<{ series_id: number; period: string; value: number }[]>`
		SELECT series_id, period, value
		FROM observation
		WHERE series_id = ANY(${ids})
		  ${opts.from ? sql`AND period >= ${opts.from}` : sql``}
		  ${opts.to ? sql`AND period <= ${opts.to}` : sql``}
		ORDER BY series_id, period
	`;

	const grouped = new Map<number, Point[]>();
	for (const r of rows) {
		let list = grouped.get(r.series_id);
		if (!list) grouped.set(r.series_id, (list = []));
		list.push([r.period, r.value]);
	}

	// Preserve the caller's id order so colour assignment is stable.
	const byId = new Map(meta.map((m) => [m.id, m]));
	return ids
		.map((id) => byId.get(id))
		.filter((m): m is Series => Boolean(m))
		.map((m) => ({ ...m, points: downsample(grouped.get(m.id) ?? [], maxPoints) }));
}

export type Headline = {
	id: number;
	sourcekey: string;
	label: string;
	unit: string;
	frequency: string;
	latest_period: string;
	latest_value: number;
	prior_value: number | null;
	year_ago_value: number | null;
	spark: Point[];
};

/** Stat-tile figures: latest value, its week-ago and year-ago comparisons, and
 *  a short sparkline. Driven by the series_latest materialized view. */
export async function getHeadlines(
	specs: { sourcekey: string; frequency: string; label: string }[]
): Promise<Headline[]> {
	const keys = specs.map((s) => s.sourcekey);
	const rows = await sql<
		{
			id: number;
			sourcekey: string;
			frequency: string;
			unit: string;
			short_name: string;
			latest_period: string;
			latest_value: number;
			prior_value: number | null;
			year_ago_value: number | null;
		}[]
	>`
		SELECT s.id, s.sourcekey, s.frequency, s.unit, s.short_name,
		       l.latest_period, l.latest_value, l.prior_value, l.year_ago_value
		FROM series s
		JOIN series_latest l ON l.series_id = s.id
		WHERE s.sourcekey = ANY(${keys})
	`;

	const found = specs
		.map((spec) => {
			const row = rows.find(
				(r) => r.sourcekey === spec.sourcekey && r.frequency === spec.frequency
			);
			return row ? { spec, row } : null;
		})
		.filter((x): x is { spec: (typeof specs)[number]; row: (typeof rows)[number] } => Boolean(x));

	if (found.length === 0) return [];

	// One round trip for every sparkline: the most recent 60 points per series.
	const sparkRows = await sql<{ series_id: number; period: string; value: number }[]>`
		SELECT series_id, period, value FROM (
			SELECT series_id, period, value,
			       row_number() OVER (PARTITION BY series_id ORDER BY period DESC) AS rn
			FROM observation
			WHERE series_id = ANY(${found.map((f) => f.row.id)})
		) t
		WHERE rn <= 60
		ORDER BY series_id, period
	`;

	const sparks = new Map<number, Point[]>();
	for (const r of sparkRows) {
		let list = sparks.get(r.series_id);
		if (!list) sparks.set(r.series_id, (list = []));
		list.push([r.period, r.value]);
	}

	return found.map(({ spec, row }) => ({
		id: row.id,
		sourcekey: row.sourcekey,
		label: spec.label,
		unit: row.unit,
		frequency: row.frequency,
		latest_period: row.latest_period,
		latest_value: row.latest_value,
		prior_value: row.prior_value,
		year_ago_value: row.year_ago_value,
		spark: sparks.get(row.id) ?? []
	}));
}

export async function getFacets() {
	const [categories, areas, products, frequencies] = await Promise.all([
		sql<{ v: string; n: number }[]>`SELECT category AS v, count(*)::int AS n FROM series WHERE category <> '' GROUP BY 1 ORDER BY 1`,
		sql<{ v: string; n: number }[]>`SELECT area AS v, count(*)::int AS n FROM series WHERE area <> '' GROUP BY 1 ORDER BY 1`,
		sql<{ v: string; n: number }[]>`SELECT product AS v, count(*)::int AS n FROM series WHERE product <> '' GROUP BY 1 ORDER BY 1`,
		sql<{ v: string; n: number }[]>`SELECT frequency AS v, count(*)::int AS n FROM series WHERE frequency <> '' GROUP BY 1 ORDER BY 1`
	]);
	return { categories, areas, products, frequencies };
}

export async function getReportMeta() {
	const [row] = await sql<{ report_date: string; series: number; observations: number; earliest: string }[]>`
		SELECT (SELECT max(report_date) FROM csv_snapshot)          AS report_date,
		       (SELECT count(*)::int FROM series)                    AS series,
		       (SELECT count(*)::int FROM observation)               AS observations,
		       (SELECT min(first_period) FROM series)                AS earliest
	`;
	return row;
}
