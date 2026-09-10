import { sql } from '$lib/server/db';
import { REPORT_GROUPS, REPORT_TABLES } from '$lib/reportTables';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

type Cell = {
	section: number;
	row_idx: number;
	col_idx: number;
	row_path: string;
	row_label: string;
	column_label: string;
	column_kind: string;
	period: string | null;
	value: number | null;
};

type Column = {
	idx: number;
	label: string;
	kind: string;
	period: string | null;
	/** What this date is relative to the report week, so a repeated date reads
	 *  as a comparison rather than as an ordering mistake. */
	rel: string;
	/** First column of a new measure — drawn with a rule so the blocks do not
	 *  read as one continuous run of dates. */
	boundary: boolean;
};

function relativeLabel(period: string | null, reportDate: string | null): string {
	if (!period || !reportDate) return '';
	const days = Math.round(
		(Date.parse(reportDate + 'T00:00:00Z') - Date.parse(period + 'T00:00:00Z')) / 86400000
	);
	if (days <= 3) return 'latest';
	if (days <= 10) return 'week earlier';
	const years = Math.round(days / 365.25);
	if (years >= 1) return years === 1 ? 'year earlier' : `${years} years earlier`;
	return '';
}

/** EIA prints several measures side by side under spanning headers — the weekly
 *  readings, then the same dates again as four-week averages, and on the balance
 *  sheet a third time as year-to-date averages. The CSV export drops those
 *  spanning headers, which leaves the dates looking like they jump backwards
 *  through time. This rebuilds them.
 *
 *  A group ends where a date is not older than the one that opened the group:
 *  that restart is the signal a new measure has begun. Verified against the
 *  warehouse — for U.S. crude production the second group matches the 4-week
 *  average series exactly, and the third matches the year-to-date mean. */
const GROUP_LABELS = ['Week ending', 'Four-week average', 'Year to date'];

/** True when a section compares a handful of reference dates (latest, a week
 *  back, a year back), which run newest-first. The price tables instead run a
 *  continuous series forwards — Jan→Dec, or day by day — where "year earlier"
 *  would be meaningless, and where a column's year depends on the row anyway. */
function isComparisonLayout(columns: Column[]): boolean {
	const dated = columns.filter((c) => c.kind === 'observation' && c.period);
	return dated.length >= 2 && dated[1].period! <= dated[0].period!;
}

function groupColumns(columns: Column[]): { leading: number; groups: { label: string; span: number }[] } | null {
	const dated = columns.filter((c) => c.kind === 'observation' && c.period);
	if (dated.length < 2) return null;

	// The price tables run forwards (Jan→Dec, or day by day) and are a single
	// measure, so there is nothing to group.
	if (dated[1].period! > dated[0].period!) return null;

	let leading = 0;
	const groups: { label: string; span: number; first: string }[] = [];

	for (const column of columns) {
		const current = groups[groups.length - 1];
		if (column.kind === 'observation' && column.period) {
			if (!current || column.period >= current.first) {
				groups.push({ label: '', span: 1, first: column.period });
				// Every group after the first opens with a visible rule.
				column.boundary = groups.length > 1;
				continue;
			}
		}
		if (!current) leading++;
		else current.span++;
	}

	if (groups.length < 2) {
		for (const column of columns) column.boundary = false;
		return null;
	}

	return {
		leading,
		groups: groups.map((g, i) => ({ label: GROUP_LABELS[i] ?? `Measure ${i + 1}`, span: g.span }))
	};
}

export const load: PageServerLoad = async ({ url }) => {
	const table = url.searchParams.get('table') ?? '1';
	const meta = REPORT_TABLES[table];
	if (!meta) error(404, `Unknown report table: ${table}`);

	const [snapshot] = await sql<{ report_date: string }[]>`
		SELECT max(report_date) AS report_date FROM csv_snapshot
	`;

	const cells = await sql<Cell[]>`
		SELECT section, row_idx, col_idx, row_path, row_label, column_label, column_kind,
		       period, value
		FROM csv_snapshot
		WHERE report_date = ${snapshot.report_date} AND table_id = ${table}
		ORDER BY section, row_idx, col_idx
	`;

	// Rebuild the printed grid: one section per stacked table in the CSV.
	const sections = new Map<
		number,
		{
			columns: Column[];
			rows: Map<number, { path: string; label: string; values: Map<number, number | null> }>;
		}
	>();

	for (const cell of cells) {
		let section = sections.get(cell.section);
		if (!section) sections.set(cell.section, (section = { columns: [], rows: new Map() }));

		if (!section.columns.some((c) => c.idx === cell.col_idx)) {
			section.columns.push({
				idx: cell.col_idx,
				label: cell.column_label,
				kind: cell.column_kind,
				period: cell.period,
				rel: relativeLabel(cell.period, snapshot.report_date),
				boundary: false
			});
		}

		let row = section.rows.get(cell.row_idx);
		if (!row)
			section.rows.set(
				cell.row_idx,
				(row = { path: cell.row_path, label: cell.row_label, values: new Map() })
			);
		row.values.set(cell.col_idx, cell.value);
	}

	const rendered = [...sections.entries()].map(([index, section]) => {
		const columns = section.columns.sort((a, b) => a.idx - b.idx);
		if (!isComparisonLayout(columns)) {
			for (const column of columns) column.rel = '';
		}
		return {
			index,
			columns,
			header: groupColumns(columns),
			rows: [...section.rows.entries()]
				.sort((a, b) => a[0] - b[0])
				.map(([, row]) => {
					const parts = row.path.split(' > ');
					return {
						path: row.path,
						label: row.label,
						// The top-level stub ("Crude Oil Production") is a heading over the
						// rows beneath it, not part of each row's own label. Without it the
						// summary tables read as one undifferentiated wall.
						group: parts.length > 1 ? parts[0].trim() : null,
						// Depth drives the indent that the CSV drops.
						depth: Math.max(0, parts.length - 1),
						values: columns.map((c) => row.values.get(c.idx) ?? null)
					};
				})
		};
	});

	// Only offer tables the current snapshot actually has.
	const present = new Set(
		(
			await sql<{ table_id: string }[]>`
				SELECT DISTINCT table_id FROM csv_snapshot WHERE report_date = ${snapshot.report_date}
			`
		).map((r) => r.table_id)
	);

	const groups = REPORT_GROUPS.map((group) => ({
		label: group.label,
		tables: group.tables.filter((t) => present.has(t.id))
	})).filter((group) => group.tables.length > 0);

	return {
		reportDate: snapshot.report_date,
		table,
		meta,
		groups,
		sections: rendered
	};
};
