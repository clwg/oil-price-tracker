/** A series as the chart components consume it. Points are [ISO date, value]
 *  and arrive already downsampled by the server. */
export type ChartSeries = {
	id: number;
	label: string;
	unit: string;
	points: [string, number][];
	sourcekey?: string;
	frequency?: string;
};
