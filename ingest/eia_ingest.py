#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["xlrd>=2.0.1", "psycopg[binary]>=3.1"]
# ///
"""Download the EIA Weekly Petroleum Status Report and load it into Postgres.

Source: https://www.eia.gov/petroleum/supply/weekly/

The report publishes every table in two shapes, and this script uses both:

  .xls workbooks (psw01.xls ...)  full history back to 1982, one column per
                                  series, tagged with EIA's canonical sourcekey.
                                  -> series / observation
  .csv files     (table1.csv ...) the current week only, but including the
                                  week-over-week and year-over-year deltas
                                  exactly as EIA publishes them.
                                  -> csv_snapshot

Run it on a schedule; it is idempotent. Re-ingesting overwrites values for
periods it sees again, which is what you want because EIA revises recent weeks.

    ./eia_ingest.py --database-url postgres://oil:oil@localhost:5432/oil

Or with uv, which handles the dependencies for you:

    uv run ingest/eia_ingest.py
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Iterable, Iterator, NamedTuple, Optional

try:
    import xlrd
except ImportError:  # pragma: no cover
    sys.exit("missing dependency: pip install 'xlrd>=2.0.1' 'psycopg[binary]>=3.1'")

try:
    import psycopg
    from psycopg import sql
except ImportError:  # pragma: no cover
    sys.exit("missing dependency: pip install 'xlrd>=2.0.1' 'psycopg[binary]>=3.1'")

log = logging.getLogger("eia")

BASE_URL = "https://ir.eia.gov/wpsr"
USER_AGENT = "oil-prices-dashboard/1.0 (+https://www.eia.gov/petroleum/supply/weekly/)"

# WPSR tables that are still published. Tables 10 and 13 were discontinued by
# EIA -- their links are commented out on the report page and the files now
# return an "Access Restricted" HTML page, so they are deliberately absent.
TABLES: dict[str, str] = {
    "1": "U.S. Petroleum Balance Sheet",
    "2": "U.S. Inputs and Production by PAD District",
    "3": "Refiner and Blender Net Production",
    "4": "Stocks of Crude Oil by PAD District, and Stocks of Petroleum Products",
    "5": "Stocks of Total Motor Gasoline and Fuel Ethanol by PAD District",
    "5a": "Stocks of Motor Gasoline and Fuel Ethanol by PAD District and Sub-PADD",
    "6": "Stocks of Distillate, Jet Fuel, Residual Fuel Oil, and Propane by PAD District",
    "7": "Imports and Exports of Crude Oil and Products",
    "8": "Preliminary Crude Imports by Country of Origin",
    "9": "U.S. and PAD District Weekly Estimates",
    "11": "Spot Prices of Crude Oil, Motor Gasoline, and Heating Oil",
    "12": "Spot Prices of Ultra-Low Sulfur Diesel, Jet Fuel, and Propane",
    "14": "U.S. Retail Motor Gasoline and On-Highway Diesel Fuel Prices",
}

# psw05a.xls, but table5a.csv -- the workbook pads single digits, the CSV does not.
def xls_name(table_id: str) -> str:
    digits = re.match(r"\d+", table_id).group(0)
    return f"psw{int(digits):02d}{table_id[len(digits):]}.xls"


def csv_name(table_id: str) -> str:
    return f"table{table_id}.csv"


# --------------------------------------------------------------------------
# download
# --------------------------------------------------------------------------

class Fetcher:
    """Polite HTTP downloader with an on-disk cache.

    EIA rate-limits bursts with an HTML block page, so requests are serialised
    with a delay and retried with backoff.
    """

    def __init__(self, cache_dir: Path, refresh: bool = True, delay: float = 1.0):
        self.cache_dir = cache_dir
        self.refresh = refresh
        self.delay = delay
        self._last_request = 0.0
        cache_dir.mkdir(parents=True, exist_ok=True)

    def get(self, filename: str) -> bytes:
        path = self.cache_dir / filename
        if path.exists() and not self.refresh:
            log.debug("cache hit %s", filename)
            return path.read_bytes()

        url = f"{BASE_URL}/{filename}"
        data = self._download(url)
        path.write_bytes(data)
        return data

    def _download(self, url: str, attempts: int = 4) -> bytes:
        last_error: Optional[Exception] = None
        for attempt in range(1, attempts + 1):
            gap = time.monotonic() - self._last_request
            if gap < self.delay:
                time.sleep(self.delay - gap)
            self._last_request = time.monotonic()
            try:
                request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(request, timeout=120) as response:
                    data = response.read()
            except (urllib.error.URLError, TimeoutError) as exc:
                last_error = exc
            else:
                # A rate-limited response still arrives as HTTP 200 with HTML.
                if data.lstrip()[:9].lower() == b"<!doctype":
                    last_error = RuntimeError("received HTML block page instead of data")
                else:
                    log.info("downloaded %s (%.1f KB)", url.rsplit("/", 1)[-1], len(data) / 1024)
                    return data
            backoff = 2.0 * attempt
            log.warning("fetch %s failed (%s), retrying in %.0fs", url, last_error, backoff)
            time.sleep(backoff)
        raise RuntimeError(f"could not download {url}: {last_error}")


# --------------------------------------------------------------------------
# series metadata derivation
# --------------------------------------------------------------------------

AREA_PATTERNS: list[tuple[str, str]] = [
    (r"\bPADD\s*1A\b|New England", "PADD 1A (New England)"),
    (r"\bPADD\s*1B\b|Central Atlantic", "PADD 1B (Central Atlantic)"),
    (r"\bPADD\s*1C\b|Lower Atlantic", "PADD 1C (Lower Atlantic)"),
    (r"\bPADD\s*1\b|East Coast", "PADD 1 (East Coast)"),
    (r"\bPADD\s*2\b|Midwest", "PADD 2 (Midwest)"),
    (r"\bPADD\s*3\b|Gulf Coast", "PADD 3 (Gulf Coast)"),
    (r"\bPADD\s*4\b|Rocky Mountain", "PADD 4 (Rocky Mountain)"),
    (r"\bPADD\s*5\b|West Coast", "PADD 5 (West Coast)"),
    (r"Cushing", "Cushing, OK"),
    (r"\bAlaska\b", "Alaska"),
    (r"Lower 48", "Lower 48"),
    (r"New York Harbor", "New York Harbor"),
    (r"Los Angeles", "Los Angeles"),
    (r"\bEurope\b|\bBrent\b", "Europe"),
    (r"\bU\.S\.|United States", "U.S."),
]

PRODUCT_PATTERNS: list[tuple[str, str]] = [
    (r"Ultra[- ]Low Sulfur|ULSD", "Ultra-Low Sulfur Diesel"),
    (r"Kerosene[- ]Type Jet Fuel|Jet Fuel", "Jet Fuel"),
    (r"Distillate", "Distillate Fuel Oil"),
    (r"Residual Fuel", "Residual Fuel Oil"),
    (r"Propane|Propylene", "Propane/Propylene"),
    (r"Fuel Ethanol|Oxygenate|Ethanol", "Fuel Ethanol"),
    (r"Reformulated|RBOB", "Reformulated Gasoline"),
    (r"Conventional", "Conventional Gasoline"),
    (r"Blending Components", "Gasoline Blending Components"),
    (r"Motor Gasoline|Gasoline", "Motor Gasoline"),
    (r"Heating Oil", "Heating Oil"),
    (r"Natural Gas(oline)? Plant Liquids|NGPL", "Natural Gas Plant Liquids"),
    (r"Unfinished Oils", "Unfinished Oils"),
    (r"Crude Oil", "Crude Oil"),
    (r"Petroleum Products?", "Petroleum Products"),
]

CATEGORY_PATTERNS: list[tuple[str, str]] = [
    (r"Spot Price|Retail|Price", "prices"),
    (r"Stocks|Inventor", "stocks"),
    (r"Net Input|Utilization|Operable Capacity|Refiner|Blender|Gross Input", "refining"),
    (r"Field Production|Plant Production|Production", "production"),
    (r"Net Imports", "net imports"),
    (r"Imports", "imports"),
    (r"Exports", "exports"),
    (r"Product(s)? Supplied|Days of Supply", "demand"),
    (r"Adjustment|Transfers|Processing Gain", "balance"),
]


def first_match(patterns: Iterable[tuple[str, str]], text: str, default: str = "") -> str:
    for pattern, label in patterns:
        if re.search(pattern, text, re.IGNORECASE):
            return label
    return default


class SeriesMeta(NamedTuple):
    sourcekey: str
    name: str
    short_name: str
    unit: str
    frequency: str
    table_id: str
    table_title: str
    sheet: str
    sheet_title: str
    category: str
    area: str
    product: str
    col_idx: int = 0  # position in the source sheet; not a series column


def parse_unit(name: str) -> tuple[str, str]:
    """Split 'Weekly U.S. Ending Stocks of Crude Oil (Thousand Barrels)'."""
    match = re.search(r"\(([^()]*)\)\s*$", name)
    if not match:
        return name.strip(), ""
    return name[: match.start()].strip(), match.group(1).strip()


def derive_frequency(name: str, periods: list[dt.date]) -> str:
    lowered = name.lower()
    if lowered.startswith("4-week"):
        return "4-week average"
    if lowered.startswith("weekly"):
        return "weekly"
    if lowered.startswith("monthly"):
        return "monthly"
    # Spot/retail price columns are named by location, so infer from spacing.
    if len(periods) >= 3:
        gaps = sorted((periods[i + 1] - periods[i]).days for i in range(len(periods) - 1))
        median = gaps[len(gaps) // 2]
        if median <= 4:
            return "daily"
        if median <= 10:
            return "weekly"
        if median <= 45:
            return "monthly"
    return "weekly"


def build_meta(sourcekey: str, name: str, sheet: str, sheet_title: str,
               table_id: str, periods: list[dt.date], col_idx: int = 0) -> SeriesMeta:
    short_name, unit = parse_unit(name)
    frequency = derive_frequency(name, periods)
    # Drop the redundant "Weekly"/"Monthly" prefix so the label reads well in a
    # legend, but keep "4-Week Avg": EIA publishes the weekly value and its
    # 4-week average under the same sourcekey, and the prefix is what tells the
    # two apart on screen.
    label = re.sub(r"^(Weekly|Monthly)\s+", "", short_name).strip()
    haystack = f"{sheet_title} {name}"
    return SeriesMeta(
        sourcekey=sourcekey,
        name=name,
        short_name=label,
        unit=unit,
        frequency=frequency,
        table_id=table_id,
        table_title=TABLES.get(table_id, ""),
        sheet=sheet,
        sheet_title=sheet_title,
        category=first_match(CATEGORY_PATTERNS, haystack, "other"),
        area=first_match(AREA_PATTERNS, name, ""),
        product=first_match(PRODUCT_PATTERNS, haystack, ""),
        col_idx=col_idx,
    )


# --------------------------------------------------------------------------
# .xls parsing (full history)
# --------------------------------------------------------------------------

class SeriesData(NamedTuple):
    meta: SeriesMeta
    points: list[tuple[dt.date, float]]


def parse_workbook(blob: bytes, table_id: str) -> Iterator[SeriesData]:
    """Yield one SeriesData per data column across every 'Data N' sheet.

    Sheet layout, consistent across all WPSR workbooks:
        row 0  'Back to Contents' | 'Data 1: <title>'
        row 1  'Sourcekey'        | <key per column>
        row 2  'Date'             | <descriptive name per column>
        row 3+ <excel serial>     | <values>
    """
    book = xlrd.open_workbook(file_contents=blob)
    for sheet in book.sheets():
        if not sheet.name.lower().startswith("data") or sheet.nrows < 4:
            continue

        title = str(sheet.cell_value(0, 1)).strip()
        title = re.sub(r"^Data\s*\d+:\s*", "", title)

        header_row = key_row = None
        for row in range(min(6, sheet.nrows)):
            label = str(sheet.cell_value(row, 0)).strip().lower()
            if label == "sourcekey":
                key_row = row
            elif label == "date":
                header_row = row
        if header_row is None or key_row is None:
            log.warning("table %s sheet %r: unexpected layout, skipped", table_id, sheet.name)
            continue

        first_data_row = header_row + 1
        periods: list[Optional[dt.date]] = []
        for row in range(first_data_row, sheet.nrows):
            raw = sheet.cell_value(row, 0)
            try:
                periods.append(xlrd.xldate.xldate_as_datetime(float(raw), book.datemode).date())
            except (ValueError, TypeError):
                periods.append(None)

        valid_periods = [p for p in periods if p]
        for col in range(1, sheet.ncols):
            sourcekey = str(sheet.cell_value(key_row, col)).strip()
            name = str(sheet.cell_value(header_row, col)).strip()
            if not sourcekey or not name:
                continue

            points: list[tuple[dt.date, float]] = []
            for offset, row in enumerate(range(first_data_row, sheet.nrows)):
                period = periods[offset]
                if period is None:
                    continue
                raw = sheet.cell_value(row, col)
                if raw == "" or raw is None:
                    continue
                try:
                    points.append((period, float(raw)))
                except (ValueError, TypeError):
                    continue
            if not points:
                continue

            meta = build_meta(sourcekey, name, sheet.name, title, table_id,
                              valid_periods, col_idx=col)
            yield SeriesData(meta, points)


# --------------------------------------------------------------------------
# .csv parsing (current-week snapshot)
# --------------------------------------------------------------------------

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

# Row labels that are geographic breakdowns of the metric named above them.
# The CSVs drop the indentation the printed report uses, so hierarchy has to be
# rebuilt positionally: a region row belongs to the most recent non-region row.
REGION_ROW = re.compile(
    r"^\s*(East Coast|Midwest|Gulf Coast|Rocky Mountain|West Coast|New England|"
    r"Central Atlantic|Lower Atlantic|PADD|Cushing|Alaska|Lower 48)\b", re.IGNORECASE)


class SnapshotCell(NamedTuple):
    table_id: str
    section: int
    row_idx: int
    col_idx: int
    row_path: str
    row_label: str
    column_label: str
    column_kind: str
    period: Optional[dt.date]
    value: Optional[float]


def parse_number(raw: str) -> Optional[float]:
    text = raw.strip().replace(",", "").replace("$", "")
    if not text or text in {"NA", "W", "--", "-"} or not re.search(r"\d", text):
        return None
    if text.startswith("(") and text.endswith(")"):  # accounting negative
        text = "-" + text[1:-1]
    try:
        return float(text)
    except ValueError:
        return None


def parse_column(label: str, report_date: Optional[dt.date],
                 stub_year: Optional[int]) -> tuple[str, Optional[dt.date]]:
    """Classify a CSV column header and resolve it to a period when it is one."""
    text = label.strip()
    lowered = text.lower()

    if "difference" in lowered:
        return "difference", None
    if "percent change" in lowered:
        return "percent_change", None
    if "percentage" in lowered:
        return "share", None

    # Explicit m/d/yy, e.g. 7/31/26
    match = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", text)
    if match:
        month, day, year = (int(g) for g in match.groups())
        if year < 100:
            year += 2000 if year < 70 else 1900
        try:
            return "observation", dt.date(year, month, day)
        except ValueError:
            return "observation", None

    # Month name column; the year lives in the row's first stub.
    if lowered[:3] in MONTHS and len(text) <= 9 and stub_year:
        return "observation", dt.date(stub_year, MONTHS[lowered[:3]], 1)

    # Bare or weekday-prefixed m/d, e.g. '5/18' or 'Fri 7/10' -- infer the year
    # from the report date, rolling back across a year boundary.
    match = re.fullmatch(r"(?:[A-Za-z]{3}\s+)?(\d{1,2})/(\d{1,2})", text)
    if match and report_date:
        month, day = int(match.group(1)), int(match.group(2))
        for year in (report_date.year, report_date.year - 1):
            try:
                candidate = dt.date(year, month, day)
            except ValueError:
                continue
            if candidate <= report_date + dt.timedelta(days=14):
                return "observation", candidate
        return "observation", None

    return "other", None


def split_sections(rows: list[list[str]]) -> Iterator[tuple[int, list[str], list[list[str]]]]:
    """A WPSR CSV stacks several tables; each starts with a STUB_* header row."""
    section = -1
    header: list[str] = []
    body: list[list[str]] = []
    for row in rows:
        if row and row[0].strip().startswith("STUB_"):
            if header:
                yield section, header, body
            section += 1
            header, body = row, []
        elif header and any(cell.strip() for cell in row):
            body.append(row)
    if header:
        yield section, header, body


def find_report_date(blob: bytes) -> Optional[dt.date]:
    """The report's week-ending date: the newest full m/d/yy in any header.

    Tables 11, 12 and 14 only carry month names and bare m/d columns, so they
    cannot answer this on their own -- the caller resolves the date across every
    table first, then parses.
    """
    text = blob.decode("cp1252", errors="replace")
    found: Optional[dt.date] = None
    for row in csv.reader(io.StringIO(text)):
        if row and row[0].strip().startswith("STUB_"):
            for cell in row:
                kind, period = parse_column(cell, None, None)
                if kind == "observation" and period and (found is None or period > found):
                    found = period
    return found


def parse_snapshot_csv(blob: bytes, table_id: str,
                       report_date: dt.date) -> list[SnapshotCell]:
    text = blob.decode("cp1252", errors="replace")
    rows = list(csv.reader(io.StringIO(text)))

    cells: list[SnapshotCell] = []
    for section, header, body in split_sections(rows):
        stub_count = sum(1 for cell in header if cell.strip().startswith("STUB_"))
        last_parent: dict[str, str] = {}

        for row_idx, row in enumerate(body):
            stubs = [cell.strip() for cell in row[:stub_count]]
            labels = [s for s in stubs if s]
            if not labels:
                continue

            # Tables 11/12/14 put the year in the first stub column.
            stub_year = int(labels[0]) if re.fullmatch(r"(19|20)\d{2}", labels[0]) else None

            leaf = labels[-1]
            prefix_key = " > ".join(labels[:-1])
            if REGION_ROW.match(leaf) and prefix_key in last_parent:
                path_parts = labels[:-1] + [last_parent[prefix_key], leaf]
            else:
                path_parts = labels
                if not REGION_ROW.match(leaf):
                    last_parent[prefix_key] = leaf
            row_path = " > ".join(path_parts)

            for col_idx in range(stub_count, min(len(row), len(header))):
                column_label = header[col_idx].strip()
                if not column_label:
                    continue
                kind, period = parse_column(column_label, report_date, stub_year)
                value = parse_number(row[col_idx])
                if value is None and kind == "other":
                    continue
                cells.append(SnapshotCell(
                    table_id=table_id, section=section, row_idx=row_idx, col_idx=col_idx,
                    row_path=row_path, row_label=leaf, column_label=column_label,
                    column_kind=kind, period=period, value=value))

    return cells


# --------------------------------------------------------------------------
# database
# --------------------------------------------------------------------------

SERIES_COLUMNS = ("sourcekey", "name", "short_name", "unit", "frequency", "table_id",
                  "table_title", "sheet", "sheet_title", "category", "area", "product")


# Columns that describe the series itself and are safe to refresh on re-ingest.
# table_id/table_title/sheet/sheet_title are deliberately excluded: a series can
# appear in several tables, so the first (lowest-numbered) one stays canonical
# and the full mapping lives in series_source.
SERIES_REFRESH_COLUMNS = ("short_name", "unit", "frequency", "category", "area", "product")


def upsert_series(conn: psycopg.Connection, metas: list[SeriesMeta]) -> dict[tuple[str, str], int]:
    """Insert or refresh series rows, returning {(sourcekey, name): id}."""
    ids: dict[tuple[str, str], int] = {}
    assignments = ", ".join(f"{c} = EXCLUDED.{c}" for c in SERIES_REFRESH_COLUMNS)
    insert = (f"INSERT INTO series ({', '.join(SERIES_COLUMNS)}) "
              f"VALUES ({', '.join(['%s'] * len(SERIES_COLUMNS))}) "
              f"ON CONFLICT (sourcekey, name) DO UPDATE SET {assignments} "
              f"RETURNING id, sourcekey, name")
    with conn.cursor() as cur:
        for meta in metas:
            cur.execute(insert, tuple(getattr(meta, c) for c in SERIES_COLUMNS))
            row_id, sourcekey, name = cur.fetchone()
            ids[(sourcekey, name)] = row_id
            cur.execute("""
                INSERT INTO series_source
                    (series_id, table_id, table_title, sheet, sheet_title, col_idx)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (series_id, table_id, sheet)
                DO UPDATE SET col_idx = EXCLUDED.col_idx,
                              sheet_title = EXCLUDED.sheet_title
            """, (row_id, meta.table_id, meta.table_title, meta.sheet,
                  meta.sheet_title, meta.col_idx))
    return ids


def copy_observations(conn: psycopg.Connection,
                      rows: Iterable[tuple[int, dt.date, float]]) -> int:
    """Stage via COPY, then upsert -- fast, and tolerant of EIA's revisions."""
    written = 0
    with conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE _obs_stage "
                    "(series_id integer, period date, value double precision) "
                    "ON COMMIT DROP")
        with cur.copy("COPY _obs_stage (series_id, period, value) FROM STDIN") as copy:
            for row in rows:
                copy.write_row(row)
                written += 1
        cur.execute("""
            INSERT INTO observation (series_id, period, value)
            SELECT DISTINCT ON (series_id, period) series_id, period, value
            FROM _obs_stage
            ORDER BY series_id, period
            ON CONFLICT (series_id, period) DO UPDATE SET value = EXCLUDED.value
        """)
    return written


def write_snapshot(conn: psycopg.Connection, cells: list[SnapshotCell],
                   report_date: dt.date) -> int:
    with conn.cursor() as cur:
        tables = sorted({c.table_id for c in cells})
        cur.execute("DELETE FROM csv_snapshot WHERE report_date = %s AND table_id = ANY(%s)",
                    (report_date, tables))
        with cur.copy(
            "COPY csv_snapshot (report_date, table_id, section, row_idx, col_idx, row_path, "
            "row_label, column_label, column_kind, period, value) FROM STDIN"
        ) as copy:
            for c in cells:
                copy.write_row((report_date, c.table_id, c.section, c.row_idx, c.col_idx,
                                c.row_path, c.row_label, c.column_label, c.column_kind,
                                c.period, c.value))
    return len(cells)


def rebuild_wide_views(conn: psycopg.Connection) -> int:
    """Expose each source sheet in its original wide shape, as a view.

    Storage stays tidy -- these are just pivots, so a new EIA series never needs
    a migration. Sourcekeys are unique within a sheet, which makes them safe
    column names; they are not unique across sheets, which is why one wide table
    for everything could not work.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT ss.table_id,
                   ss.sheet,
                   min(ss.sheet_title),
                   array_agg(s.id ORDER BY ss.col_idx),
                   array_agg(s.sourcekey ORDER BY ss.col_idx)
            FROM series_source ss
            JOIN series s ON s.id = ss.series_id
            GROUP BY ss.table_id, ss.sheet
        """)
        groups = cur.fetchall()

        for table_id, sheet, sheet_title, ids, keys in groups:
            slug = re.sub(r"\W+", "", f"t{table_id}_{sheet}".lower().replace(" ", ""))
            view = f"wpsr_{slug}"
            columns = ",\n       ".join(
                f'max(value) FILTER (WHERE series_id = {sid}) AS "{key}"'
                for sid, key in zip(ids, keys)
            )
            # A view definition cannot carry bind parameters, so the id list is
            # inlined. These are integer primary keys read back from Postgres.
            id_list = ", ".join(str(int(sid)) for sid in ids)
            cur.execute(f'DROP VIEW IF EXISTS "{view}"')
            cur.execute(f'''
                CREATE VIEW "{view}" AS
                SELECT period,
                       {columns}
                FROM observation
                WHERE series_id IN ({id_list})
                GROUP BY period
            ''')
            cur.execute(sql.SQL("COMMENT ON VIEW {} IS {}").format(
                sql.Identifier(view),
                sql.Literal(f"WPSR table {table_id} / {sheet}: {sheet_title}")))
    return len(groups)


def refresh_derived(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        log.info("refreshing series statistics")
        cur.execute("""
            UPDATE series s SET first_period = agg.lo, last_period = agg.hi, obs_count = agg.n
            FROM (SELECT series_id, min(period) lo, max(period) hi, count(*) n
                  FROM observation GROUP BY series_id) agg
            WHERE agg.series_id = s.id
        """)
        log.info("refreshing series_latest")
        cur.execute("REFRESH MATERIALIZED VIEW series_latest")
    count = rebuild_wide_views(conn)
    log.info("rebuilt %d per-source wide views", count)


# --------------------------------------------------------------------------
# orchestration
# --------------------------------------------------------------------------

def ingest_xls(conn: psycopg.Connection, fetcher: Fetcher, tables: list[str]) -> int:
    total = 0
    for table_id in tables:
        blob = fetcher.get(xls_name(table_id))
        series_list = list(parse_workbook(blob, table_id))
        if not series_list:
            log.warning("table %s: no series parsed", table_id)
            continue

        ids = upsert_series(conn, [s.meta for s in series_list])
        rows = ((ids[(s.meta.sourcekey, s.meta.name)], period, value)
                for s in series_list for period, value in s.points)
        written = copy_observations(conn, rows)
        conn.commit()
        total += written
        log.info("table %-3s %4d series %9d observations", table_id, len(series_list), written)
    return total


def ingest_csv(conn: psycopg.Connection, fetcher: Fetcher,
               tables: list[str]) -> tuple[int, Optional[dt.date]]:
    # Download once, then resolve the report date across every table before
    # parsing any of them: the price tables date their columns as bare m/d and
    # need the week-ending date to place them in a year.
    blobs = {table_id: fetcher.get(csv_name(table_id)) for table_id in tables}

    report_date: Optional[dt.date] = None
    for blob in blobs.values():
        found = find_report_date(blob)
        if found and (report_date is None or found > report_date):
            report_date = found

    if report_date is None:
        # Only the price tables were requested, and none of them dates its
        # columns in full. Join the report already on file rather than invent a
        # new one -- a daily spot-price date is not a week-ending date.
        with conn.cursor() as cur:
            cur.execute("SELECT max(report_date) FROM csv_snapshot")
            existing = cur.fetchone()[0]
            cur.execute("SELECT max(period) FROM observation WHERE period <= CURRENT_DATE")
            newest = cur.fetchone()[0]
        report_date = existing or newest or dt.date.today()
        log.info("no dated column in this subset; filing under report date %s", report_date)

    all_cells: list[SnapshotCell] = []
    for table_id, blob in blobs.items():
        cells = parse_snapshot_csv(blob, table_id, report_date)
        all_cells.extend(cells)
        log.info("table %-3s %5d snapshot cells", table_id, len(cells))

    if not all_cells:
        return 0, report_date
    written = write_snapshot(conn, all_cells, report_date)
    conn.commit()
    return written, report_date


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Load the EIA Weekly Petroleum Status Report into Postgres.")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"),
                        help="postgres://user:pass@host:port/db (or set DATABASE_URL)")
    parser.add_argument("--mode", choices=("all", "xls", "csv"), default="all",
                        help="xls = full history, csv = current-week snapshot")
    parser.add_argument("--tables", default="", help="comma-separated subset, e.g. 9,11")
    parser.add_argument("--cache-dir", default=str(Path(__file__).parent / ".cache"))
    parser.add_argument("--offline", action="store_true",
                        help="use cached downloads only; do not hit the network")
    parser.add_argument("--delay", type=float, default=1.0,
                        help="seconds between requests (EIA blocks bursts)")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)-7s %(message)s",
                        datefmt="%H:%M:%S")

    if not args.database_url:
        parser.error("--database-url is required (or set DATABASE_URL)")

    tables = [t.strip() for t in args.tables.split(",") if t.strip()] or list(TABLES)
    unknown = [t for t in tables if t not in TABLES]
    if unknown:
        parser.error(f"unknown table(s): {', '.join(unknown)}; known: {', '.join(TABLES)}")

    fetcher = Fetcher(Path(args.cache_dir), refresh=not args.offline, delay=args.delay)
    started = time.monotonic()

    with psycopg.connect(args.database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO ingest_run (mode) VALUES (%s) RETURNING id", (args.mode,))
            run_id = cur.fetchone()[0]
        conn.commit()

        try:
            rows = 0
            report_date = None
            if args.mode in ("all", "xls"):
                rows += ingest_xls(conn, fetcher, tables)
            if args.mode in ("all", "csv"):
                snapshot_rows, report_date = ingest_csv(conn, fetcher, tables)
                rows += snapshot_rows
                log.info("snapshot: %d cells for week ending %s", snapshot_rows, report_date)
            refresh_derived(conn)

            with conn.cursor() as cur:
                cur.execute("SELECT count(*) FROM series")
                series_count = cur.fetchone()[0]
                cur.execute("UPDATE ingest_run SET finished_at = now(), status = 'ok', "
                            "series_seen = %s, rows_written = %s, report_date = %s WHERE id = %s",
                            (series_count, rows, report_date, run_id))
            conn.commit()
        except Exception as exc:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute("UPDATE ingest_run SET finished_at = now(), status = 'error', "
                            "message = %s WHERE id = %s", (str(exc)[:2000], run_id))
            conn.commit()
            log.error("ingest failed: %s", exc)
            raise

    log.info("done in %.1fs: %d rows across %d series", time.monotonic() - started,
             rows, series_count)
    return 0


if __name__ == "__main__":
    sys.exit(main())
