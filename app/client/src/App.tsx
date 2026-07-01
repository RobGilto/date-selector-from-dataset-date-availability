import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { format, startOfMonth, endOfMonth, subDays, startOfYear } from 'date-fns';
import domo from 'ryuu.js';
import 'react-day-picker/style.css';
import './App.css';
import { resolveRole, type Role } from './lib/role';

// ── Constants ─────────────────────────────────────────────────────────────────
const DATASET_ALIAS = 'sampleData';
const DATE_COLUMN = 'Date';
const EN_DASH = '–';
const HIDE_BETWEEN = true;
const IS_LOCAL =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1';

const COLUMNS_CACHE_KEY = `date-selector:columns:${DATASET_ALIAS}:v1`;
const COLUMNS_TTL_MS = 30 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CURRENT_CARD_ID: string =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  String(((domo as any).env?.cardId ?? '').toString().trim() || 'local-card-001');

// ── Types ─────────────────────────────────────────────────────────────────────
type SelectionMode = 'single' | 'between';
type ViewMode = 'calendar' | 'list';
type DateFormat = 'YYYY-MMM' | 'YYYY-MMM-DD' | 'YYYY-MM-DD';
type FilterOperator =
  | 'EQUALS'
  | 'BETWEEN'
  | 'LESS_THAN_EQUALS_TO'
  | 'GREAT_THAN_EQUALS_TO';
type FilterDataType = 'DATE' | 'STRING' | 'NUMERIC';

interface ConfigDoc {
  type?: 'config';
  cardId?: string;
  mode?: SelectionMode;
  viewMode?: ViewMode;
  dateFormat?: DateFormat;
  filterColumn?: string;
  filterOperator?: FilterOperator;
  filterDataType?: FilterDataType;
}

interface StateDoc {
  type: 'state';
  cardId?: string;
  singleDate?: string;
  rangeStart?: string;
  rangeEnd?: string;
}

type CollectionDoc = ConfigDoc | StateDoc;

// ── Helpers ───────────────────────────────────────────────────────────────────
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatMonthLabel(d: Date): string {
  return `${d.getFullYear()} ${EN_DASH} ${format(d, 'MMM')}`;
}

function formatDateLabel(d: Date, fmt: DateFormat = 'YYYY-MMM-DD'): string {
  const y = d.getFullYear();
  const m = format(d, 'MMM');
  const day = String(d.getDate()).padStart(2, '0');
  const mNum = String(d.getMonth() + 1).padStart(2, '0');
  if (fmt === 'YYYY-MMM') return `${y} ${EN_DASH} ${m}`;
  if (fmt === 'YYYY-MM-DD') return `${y}-${mNum}-${day}`;
  return `${y} ${EN_DASH} ${m} ${EN_DASH} ${day}`;
}

// ── Collection backend ──────────────────────────────────────────────────────
const LOCAL_COLL_KEY = `domo-appdb-mock:date-selector-settings`;

function readLocalDocs(): { id: string; content: CollectionDoc }[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_COLL_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function writeLocalDocs(docs: { id: string; content: CollectionDoc }[]) {
  localStorage.setItem(LOCAL_COLL_KEY, JSON.stringify(docs));
}
function mkLocalId() {
  return `local-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

const collBackend = {
  async queryAll(): Promise<{ id: string; content: CollectionDoc }[]> {
    if (IS_LOCAL) return readLocalDocs();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (domo as any).post(
      `/domo/datastores/v1/collections/date-selector-settings/documents/query`,
      {}
    );
  },
  async getOne(id: string): Promise<{ content: CollectionDoc } | null> {
    if (IS_LOCAL) {
      const found = readLocalDocs().find((d) => d.id === id);
      return found ? { content: found.content } : null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (domo as any).get(
      `/domo/datastores/v1/collections/date-selector-settings/documents/${id}`
    );
  },
  async create(content: CollectionDoc): Promise<{ id: string }> {
    if (IS_LOCAL) {
      const docs = readLocalDocs();
      const id = mkLocalId();
      docs.push({ id, content });
      writeLocalDocs(docs);
      return { id };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (domo as any).post(
      `/domo/datastores/v1/collections/date-selector-settings/documents/`,
      { content }
    );
  },
  async update(id: string, content: CollectionDoc): Promise<void> {
    if (IS_LOCAL) {
      const docs = readLocalDocs();
      const idx = docs.findIndex((d) => d.id === id);
      if (idx >= 0) docs[idx] = { id, content };
      else docs.push({ id, content });
      writeLocalDocs(docs);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (domo as any).put(
      `/domo/datastores/v1/collections/date-selector-settings/documents/${id}`,
      { content }
    );
  },
  async delete(id: string): Promise<void> {
    if (IS_LOCAL) {
      writeLocalDocs(readLocalDocs().filter((d) => d.id !== id));
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (domo as any).delete(
      `/domo/datastores/v1/collections/date-selector-settings/documents/${id}`
    );
  },
};

// ── Schema fetch ────────────────────────────────────────────────────────────
async function fetchDatasetColumns(): Promise<string[]> {
  try {
    const cached = localStorage.getItem(COLUMNS_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as { at: number; cols: string[] };
      if (Date.now() - parsed.at < COLUMNS_TTL_MS && Array.isArray(parsed.cols)) {
        return parsed.cols;
      }
    }
  } catch {
    /* ignore */
  }
  let cols: string[] = [];
  try {
    if (IS_LOCAL) {
      const res = await fetch('/sample-data.csv');
      const text = await res.text();
      const header = text.trim().split('\n')[0];
      cols = header.split(',').map((h) => h.trim()).filter(Boolean);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (await (domo as any).post(
        `/sql/v1/${DATASET_ALIAS}`,
        `SELECT * FROM ${DATASET_ALIAS} LIMIT 1`,
        { contentType: 'text/plain' }
      )) as unknown;
      // Response shape varies: {columns:[...]}, or array of row objects.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = rows as any;
      if (r && Array.isArray(r.columns)) cols = r.columns.map(String);
      else if (Array.isArray(r) && r.length && typeof r[0] === 'object') {
        cols = Object.keys(r[0]);
      } else if (r && Array.isArray(r.rows) && r.rows.length) {
        cols = Object.keys(r.rows[0]);
      }
    }
  } catch (e) {
    console.warn('[fetchDatasetColumns] failed', e);
  }
  if (cols.length) {
    try {
      localStorage.setItem(COLUMNS_CACHE_KEY, JSON.stringify({ at: Date.now(), cols }));
    } catch {
      /* ignore */
    }
  }
  return cols;
}

async function fetchLocalDates(): Promise<string[]> {
  const res = await fetch('/sample-data.csv');
  const text = await res.text();
  const lines = text.trim().split('\n');
  const header = lines[0].split(',').map((h) => h.trim());
  const dateIdx = header.indexOf('Date');
  if (dateIdx === -1) throw new Error('No Date column in sample-data.csv');
  const seen = new Set<string>();
  lines.slice(1).forEach((line) => {
    const val = line.split(',')[dateIdx]?.trim();
    if (val) seen.add(val);
  });
  return Array.from(seen).sort();
}

// ── Echo guard ──────────────────────────────────────────────────────────────
let isFiltersEmittedFromApp = false;

// ── Icons ─────────────────────────────────────────────────────────────────────
const GearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" />
    <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" />
  </svg>
);

// ── Component ──────────────────────────────────────────────────────────────────
export default function App() {
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  const [sortedDates, setSortedDates] = useState<string[]>([]);
  const [dataStatus, setDataStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dataError, setDataError] = useState('');

  const [selectionMode, setSelectionMode] = useState<SelectionMode>('single');
  const [singleSelected, setSingleSelected] = useState<Date | undefined>();
  const [rangeSelected, setRangeSelected] = useState<DateRange | undefined>();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showSettings, setShowSettings] = useState(false);

  const configDocIdRef = useRef<string | null>(null);
  const stateDocIdRef = useRef<string | null>(null);
  const selectionModeRef = useRef<SelectionMode>('single');

  const [columns, setColumns] = useState<string[]>([]);
  const [filterColumn, setFilterColumn] = useState<string>('');
  const [filterOperator, setFilterOperator] = useState<FilterOperator>('EQUALS');
  const [filterDataType, setFilterDataType] = useState<FilterDataType>('DATE');
  const filterColumnRef = useRef<string>('');
  const filterOperatorRef = useRef<FilterOperator>('EQUALS');
  const filterDataTypeRef = useRef<FilterDataType>('DATE');

  const [dateFormat, setDateFormat] = useState<DateFormat>('YYYY-MMM-DD');
  const dateFormatRef = useRef<DateFormat>('YYYY-MMM-DD');
  const viewModeRef = useRef<ViewMode>('list');

  const [role, setRole] = useState<Role>(IS_LOCAL ? 'admin' : 'user');

  const [isWide, setIsWide] = useState(
    () => window.matchMedia('(min-width: 720px)').matches
  );

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    resolveRole().then(setRole).catch(() => setRole('user'));
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 720px)');
    const handler = (e: MediaQueryListEvent) => setIsWide(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    (async () => {
      fetchDatasetColumns().then(setColumns);
      await loadSettings();
      await fetchDates();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── onFiltersUpdate: ignore self-echos; hydrate from external filter set ─
  useEffect(() => {
    if (IS_LOCAL) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (domo as any).onFiltersUpdate((filters: any[]) => {
        if (isFiltersEmittedFromApp) {
          isFiltersEmittedFromApp = false;
          return;
        }
        const col = filterColumnRef.current;
        if (!col || !Array.isArray(filters)) return;
        const mine = filters.find((f) => f?.column === col);
        if (!mine || !Array.isArray(mine.values) || mine.values.length === 0) return;
        const first = String(mine.values[0]);
        const iso = first.length >= 10 ? first.slice(0, 10) : first;
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
          setSingleSelected(isoToDate(iso));
        }
      });
    } catch (e) {
      console.warn('[onFiltersUpdate]', e);
    }
  }, []);

  // ── Settings helpers ─────────────────────────────────────────────────────────

  async function loadSettings() {
    try {
      const docs = await collBackend.queryAll();
      const configDocs = docs?.filter(
        (d) => d.content?.type === 'config' || d.content?.type === undefined
      ) ?? [];
      const stateDocs = docs?.filter((d) => d.content?.type === 'state') ?? [];
      const configDoc =
        configDocs.find((d) => (d.content as ConfigDoc).cardId === CURRENT_CARD_ID) ??
        configDocs.find((d) => !(d.content as ConfigDoc).cardId);
      const stateDoc =
        stateDocs.find((d) => (d.content as StateDoc).cardId === CURRENT_CARD_ID) ??
        stateDocs.find((d) => !(d.content as StateDoc).cardId);

      if (configDoc) {
        const { id, content } = configDoc;
        const c = content as ConfigDoc;
        if (c.cardId === CURRENT_CARD_ID) configDocIdRef.current = id;
        const mode = HIDE_BETWEEN ? 'single' : (c.mode ?? 'single');
        const vm: ViewMode = c.viewMode ?? 'list';
        const df: DateFormat = c.dateFormat ?? 'YYYY-MMM-DD';
        const fc = c.filterColumn ?? '';
        const fo: FilterOperator = c.filterOperator ?? 'EQUALS';
        const fdt: FilterDataType = c.filterDataType ?? 'DATE';
        selectionModeRef.current = mode;
        viewModeRef.current = vm;
        dateFormatRef.current = df;
        filterColumnRef.current = fc;
        filterOperatorRef.current = fo;
        filterDataTypeRef.current = fdt;
        setSelectionMode(mode);
        setViewMode(vm);
        setDateFormat(df);
        setFilterColumn(fc);
        setFilterOperator(fo);
        setFilterDataType(fdt);
      }

      if (stateDoc) {
        const { id, content } = stateDoc;
        const s = content as StateDoc;
        if (s.cardId === CURRENT_CARD_ID) stateDocIdRef.current = id;
        if (s.singleDate) setSingleSelected(isoToDate(s.singleDate));
        if (s.rangeStart) {
          setRangeSelected({
            from: isoToDate(s.rangeStart),
            to: s.rangeEnd ? isoToDate(s.rangeEnd) : undefined,
          });
        }
        rehydrateFilter(s);
      }
    } catch (e) {
      console.warn('[loadSettings]', e);
    }
  }

  function buildFilterPayload(values: string[]): Record<string, unknown>[] {
    const col = filterColumnRef.current;
    if (!col || values.length === 0) return [];
    return [
      {
        column: col,
        operator: filterOperatorRef.current,
        values,
        dataType: filterDataTypeRef.current,
      },
    ];
  }

  function emitFilter(payload: Record<string, unknown>[]) {
    if (payload.length === 0) return;
    if (IS_LOCAL) {
      console.log('[DEV] emit filterContainer:', payload);
      return;
    }
    isFiltersEmittedFromApp = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (domo as any).filterContainer(payload);
    } catch (e) {
      isFiltersEmittedFromApp = false;
      console.error('[emitFilter]', e);
    }
  }

  function rehydrateFilter(s: StateDoc) {
    if (!filterColumnRef.current) return;
    if (selectionModeRef.current === 'single' && s.singleDate) {
      emitFilter(buildFilterPayload([s.singleDate]));
    } else if (selectionModeRef.current === 'between' && s.rangeStart) {
      const from = s.rangeStart;
      const to = s.rangeEnd ?? s.rangeStart;
      const prev = filterOperatorRef.current;
      filterOperatorRef.current = 'BETWEEN';
      emitFilter(buildFilterPayload([from, to]));
      filterOperatorRef.current = prev;
    }
  }

  async function persistSettings(patch: Partial<ConfigDoc>, silent = false) {
    try {
      const current: ConfigDoc = {
        mode: selectionModeRef.current,
        viewMode: viewModeRef.current,
        dateFormat: dateFormatRef.current,
        filterColumn: filterColumnRef.current || undefined,
        filterOperator: filterOperatorRef.current,
        filterDataType: filterDataTypeRef.current,
        ...patch,
        type: 'config',
        cardId: CURRENT_CARD_ID,
      };
      if (configDocIdRef.current) {
        await collBackend.update(configDocIdRef.current, current);
      } else {
        const res = await collBackend.create(current);
        configDocIdRef.current = res.id;
      }
      if (!silent) setShowSettings(false);
    } catch (e) {
      console.error('[persistSettings]', e);
    }
  }

  async function persistState(patch: Partial<Omit<StateDoc, 'type'>>) {
    try {
      const existing: Partial<StateDoc> = {};
      if (stateDocIdRef.current) {
        try {
          const doc = await collBackend.getOne(stateDocIdRef.current);
          if (doc?.content) Object.assign(existing, doc.content);
        } catch {
          /* fall through */
        }
      }
      const next: StateDoc = {
        ...existing,
        ...patch,
        type: 'state',
        cardId: CURRENT_CARD_ID,
      };
      if (stateDocIdRef.current) {
        await collBackend.update(stateDocIdRef.current, next);
      } else {
        const res = await collBackend.create(next);
        stateDocIdRef.current = res.id;
      }
    } catch (e) {
      console.error('[persistState]', e);
    }
  }

  async function resetSettings() {
    try {
      if (configDocIdRef.current) await collBackend.delete(configDocIdRef.current);
      if (stateDocIdRef.current) await collBackend.delete(stateDocIdRef.current);
      configDocIdRef.current = null;
      stateDocIdRef.current = null;
      filterColumnRef.current = '';
      filterOperatorRef.current = 'EQUALS';
      filterDataTypeRef.current = 'DATE';
      viewModeRef.current = 'list';
      dateFormatRef.current = 'YYYY-MMM-DD';
      setFilterColumn('');
      setFilterOperator('EQUALS');
      setFilterDataType('DATE');
      setViewMode('list');
      setDateFormat('YYYY-MMM-DD');
      setSingleSelected(undefined);
      setRangeSelected(undefined);
    } catch (e) {
      console.error('[resetSettings]', e);
    }
  }

  function switchSelectionMode(mode: SelectionMode) {
    selectionModeRef.current = mode;
    setSelectionMode(mode);
    if (mode === 'between' && viewMode === 'list') setViewMode('calendar');
    persistSettings({ mode }, true);
  }

  // ── Data fetching ─────────────────────────────────────────────────────────────

  async function fetchDates() {
    setDataStatus('loading');
    try {
      let values: string[];
      if (IS_LOCAL) {
        values = await fetchLocalDates();
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (await (domo as any).get(
          `/data/v1/${DATASET_ALIAS}?fields=${DATE_COLUMN}`
        )) as Record<string, string>[];
        const seen = new Set<string>();
        rows.forEach((r) => {
          if (r[DATE_COLUMN]) seen.add(r[DATE_COLUMN]);
        });
        values = Array.from(seen).sort();
      }
      setAvailableDates(new Set(values));
      setSortedDates(values);
      setDataStatus('ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDataError(msg);
      setDataStatus('error');
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────────

  const isDateDisabled = useCallback(
    (date: Date) => !availableDates.has(toISO(date)),
    [availableDates]
  );

  const defaultMonth = useMemo(() => {
    if (!sortedDates.length) return undefined;
    return isoToDate(sortedDates[sortedDates.length - 1]);
  }, [sortedDates]);

  const presets = useMemo(() => {
    if (!sortedDates.length) return [];
    const today = new Date();
    const todayISO = toISO(today);
    const minISO = sortedDates[0];
    const maxISO = sortedDates[sortedDates.length - 1];
    const result: { label: string; range: DateRange }[] = [];
    const mStart = toISO(startOfMonth(today));
    const mEnd = toISO(endOfMonth(today));
    const thisMo = sortedDates.filter((d) => d >= mStart && d <= mEnd);
    if (thisMo.length > 0) {
      result.push({
        label: 'This month',
        range: { from: isoToDate(thisMo[0]), to: isoToDate(thisMo[thisMo.length - 1]) },
      });
    }
    const l30Start = toISO(subDays(today, 29));
    const l30 = sortedDates.filter((d) => d >= l30Start && d <= todayISO);
    if (l30.length > 0) {
      result.push({
        label: 'Last 30d',
        range: { from: isoToDate(l30[0]), to: isoToDate(l30[l30.length - 1]) },
      });
    }
    const ytdStart = toISO(startOfYear(today));
    const ytd = sortedDates.filter((d) => d >= ytdStart && d <= todayISO);
    if (ytd.length > 0) {
      result.push({
        label: 'YTD',
        range: { from: isoToDate(ytd[0]), to: isoToDate(ytd[ytd.length - 1]) },
      });
    }
    result.push({
      label: 'All data',
      range: { from: isoToDate(minISO), to: isoToDate(maxISO) },
    });
    return result;
  }, [sortedDates]);

  const statusText = useMemo(() => {
    if (!rangeSelected?.from) return 'Pick start date';
    if (!rangeSelected?.to) return 'Pick end date';
    const from = formatDateLabel(rangeSelected.from, dateFormat);
    const to = formatDateLabel(rangeSelected.to, dateFormat);
    const days =
      Math.round(
        (rangeSelected.to.getTime() - rangeSelected.from.getTime()) / 86400000
      ) + 1;
    return `${from} → ${to} (${days} day${days !== 1 ? 's' : ''})`;
  }, [rangeSelected, dateFormat]);

  const toolbarLabel = useMemo(() => {
    if (selectionMode === 'single' && singleSelected) {
      return formatDateLabel(singleSelected, dateFormat);
    }
    if (selectionMode === 'between' && rangeSelected?.from && rangeSelected?.to) {
      return `${formatDateLabel(rangeSelected.from, dateFormat)} → ${formatDateLabel(rangeSelected.to, dateFormat)}`;
    }
    return '';
  }, [selectionMode, singleSelected, rangeSelected, dateFormat]);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleSingleSelect = useCallback(
    (date: Date | undefined) => {
      if (!date) return;
      const iso = toISO(date);
      if (!availableDates.has(iso)) return;
      setSingleSelected(date);
      persistState({ singleDate: iso });
      if (!filterColumnRef.current) return;
      // Force single-value operator (avoid BETWEEN which needs two values).
      const op = filterOperatorRef.current;
      if (op === 'BETWEEN') filterOperatorRef.current = 'EQUALS';
      emitFilter(buildFilterPayload([iso]));
      filterOperatorRef.current = op;
    },
    [availableDates]
  );

  const applyRange = useCallback(() => {
    if (!rangeSelected?.from) return;
    const from = toISO(rangeSelected.from);
    const to = rangeSelected.to ? toISO(rangeSelected.to) : from;
    persistState({ rangeStart: from, rangeEnd: to });
    if (!filterColumnRef.current) {
      console.warn('[applyRange] no filter column configured');
      return;
    }
    const prev = filterOperatorRef.current;
    filterOperatorRef.current = 'BETWEEN';
    emitFilter(buildFilterPayload([from, to]));
    filterOperatorRef.current = prev;
  }, [rangeSelected]);

  // ── Render ────────────────────────────────────────────────────────────────────

  if (dataStatus === 'loading')
    return (
      <div className="state-msg">
        <div className="spinner" />
        <span>Loading…</span>
      </div>
    );
  if (dataStatus === 'error')
    return <div className="state-msg error">Failed to load dates: {dataError}</div>;

  const samplePreviewDate = singleSelected ? toISO(singleSelected) : 'YYYY-MM-DD';

  return (
    <div className={`app mode-${role}`}>
      {toolbarLabel && (
        <span className="sr-only" aria-live="polite">
          Selected: {toolbarLabel}
        </span>
      )}
      {role === 'admin' && (
        <div className="toolbar">
          <div className="toggle-group">
            <button
              className={`toggle-btn ${showSettings ? 'active' : ''}`}
              onClick={() => setShowSettings((s) => !s)}
              title="Settings"
            >
              <GearIcon />
            </button>
          </div>
        </div>
      )}

      {role === 'admin' && showSettings && (
        <div className="settings-panel">
          <label className="settings-label">Filter Configuration</label>

          <div className="settings-group">
            <label className="settings-sublabel">Filter column</label>
            <select
              className="settings-input"
              value={filterColumn}
              onChange={(e) => {
                const v = e.target.value;
                setFilterColumn(v);
                filterColumnRef.current = v;
                persistSettings({ filterColumn: v || undefined }, true);
              }}
            >
              <option value="">— select a column —</option>
              {columns.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {columns.length === 0 && (
              <p className="settings-hint">
                No columns discovered. Confirm dataset alias <code>{DATASET_ALIAS}</code>
                {' '}is bound. You may also type a column name below:
              </p>
            )}
            {columns.length === 0 && (
              <input
                className="settings-input"
                type="text"
                placeholder="Column name (fallback)"
                value={filterColumn}
                onChange={(e) => {
                  const v = e.target.value;
                  setFilterColumn(v);
                  filterColumnRef.current = v;
                  persistSettings({ filterColumn: v || undefined }, true);
                }}
              />
            )}
          </div>

          <div className="settings-group">
            <label className="settings-sublabel">Filter operator</label>
            <select
              className="settings-input"
              value={filterOperator}
              onChange={(e) => {
                const v = e.target.value as FilterOperator;
                setFilterOperator(v);
                filterOperatorRef.current = v;
                persistSettings({ filterOperator: v }, true);
              }}
            >
              <option value="EQUALS">EQUALS (single date)</option>
              <option value="LESS_THAN_EQUALS_TO">LESS_THAN_EQUALS_TO (through date)</option>
              <option value="GREAT_THAN_EQUALS_TO">GREAT_THAN_EQUALS_TO (from date)</option>
              <option value="BETWEEN">BETWEEN (range)</option>
            </select>
          </div>

          <div className="settings-group">
            <label className="settings-sublabel">Data type</label>
            <select
              className="settings-input"
              value={filterDataType}
              onChange={(e) => {
                const v = e.target.value as FilterDataType;
                setFilterDataType(v);
                filterDataTypeRef.current = v;
                persistSettings({ filterDataType: v }, true);
              }}
            >
              <option value="DATE">DATE</option>
              <option value="STRING">STRING</option>
              <option value="NUMERIC">NUMERIC</option>
            </select>
          </div>

          <p className="settings-hint">
            Preview payload:{' '}
            <code>
              [{'{'}column:"{filterColumn || '?'}", operator:"{filterOperator}",
              values:["{samplePreviewDate}"], dataType:"{filterDataType}"{'}'}]
            </code>
          </p>

          <div className="settings-group">
            <label className="settings-sublabel">Default view</label>
            <div className="settings-radio-row">
              <label className="settings-radio">
                <input
                  type="radio"
                  name="viewMode"
                  value="list"
                  checked={viewMode === 'list'}
                  onChange={() => {
                    viewModeRef.current = 'list';
                    setViewMode('list');
                    persistSettings({ viewMode: 'list' }, true);
                  }}
                />{' '}
                List (dropdown)
              </label>
              <label className="settings-radio">
                <input
                  type="radio"
                  name="viewMode"
                  value="calendar"
                  checked={viewMode === 'calendar'}
                  onChange={() => {
                    viewModeRef.current = 'calendar';
                    setViewMode('calendar');
                    persistSettings({ viewMode: 'calendar' }, true);
                  }}
                />{' '}
                Calendar
              </label>
            </div>
          </div>

          <div className="settings-group">
            <label className="settings-sublabel">Date format</label>
            <select
              className="settings-input"
              value={dateFormat}
              onChange={(e) => {
                const v = e.target.value as DateFormat;
                dateFormatRef.current = v;
                setDateFormat(v);
                persistSettings({ dateFormat: v }, true);
              }}
            >
              <option value="YYYY-MMM-DD">YYYY – MMM – DD (2026 – Sep – 30)</option>
              <option value="YYYY-MMM">YYYY – MMM (2026 – Sep)</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD (2026-09-30)</option>
            </select>
            <p className="settings-hint">
              Preview: {formatDateLabel(new Date(), dateFormat)}
            </p>
          </div>

          {!filterColumn && (
            <p className="range-config-warn">
              ⚠ No filter column selected — date picks will not affect cards.
            </p>
          )}
          <div className="settings-actions">
            <button className="settings-reset" onClick={resetSettings}>
              Reset
            </button>
          </div>

          <p className="settings-saved">
            <strong>Admin</strong> · Card {CURRENT_CARD_ID.slice(0, 8)}
            {filterColumn && (
              <> · filter=<code>{filterColumn}</code> {filterOperator}</>
            )}
          </p>
        </div>
      )}

      {!showSettings && (
        <>
          {!HIDE_BETWEEN && (
            <div className="mode-toggle">
              <button
                className={`mode-btn ${selectionMode === 'single' ? 'active' : ''}`}
                onClick={() => switchSelectionMode('single')}
              >
                Single date
              </button>
              <button
                className={`mode-btn ${selectionMode === 'between' ? 'active' : ''}`}
                onClick={() => switchSelectionMode('between')}
              >
                Between
              </button>
            </div>
          )}

          {selectionMode === 'single' && (role === 'user' || viewMode === 'list') && (
            <div className="text-mode">
              <select
                className="date-select"
                value={singleSelected ? toISO(singleSelected) : ''}
                onChange={(e) => {
                  if (e.target.value) handleSingleSelect(isoToDate(e.target.value));
                }}
              >
                <option value="">— select a date —</option>
                {[...sortedDates].reverse().map((d) => (
                  <option key={d} value={d}>
                    {formatDateLabel(isoToDate(d), dateFormat)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {role === 'admin' && viewMode === 'calendar' && (
            <div className="cal-wrapper">
              {selectionMode === 'single' ? (
                <DayPicker
                  mode="single"
                  selected={singleSelected}
                  onSelect={handleSingleSelect}
                  disabled={isDateDisabled}
                  defaultMonth={defaultMonth}
                  numberOfMonths={isWide ? 2 : 1}
                  formatters={{
                    formatCaption: (date: Date) => formatMonthLabel(date),
                  }}
                />
              ) : (
                <DayPicker
                  mode="range"
                  selected={rangeSelected}
                  onSelect={(range: DateRange | undefined) =>
                    setRangeSelected(range)
                  }
                  disabled={isDateDisabled}
                  defaultMonth={defaultMonth}
                  numberOfMonths={isWide ? 2 : 1}
                  formatters={{
                    formatCaption: (date: Date) => formatMonthLabel(date),
                  }}
                />
              )}

              {selectionMode === 'between' && (
                <>
                  <p className="status-text">{statusText}</p>
                  {presets.length > 0 && (
                    <div className="presets">
                      {presets.map((p) => (
                        <button
                          key={p.label}
                          className="preset-btn"
                          onClick={() => setRangeSelected(p.range)}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {!filterColumn && (
                    <p className="range-config-warn">
                      ⚠ No filter column configured. Pick one in the gear panel.
                    </p>
                  )}
                  <div className="range-actions">
                    <button
                      className="apply-btn"
                      disabled={!rangeSelected?.from}
                      onClick={applyRange}
                      title="Emit range filter"
                    >
                      Apply
                    </button>
                    <button
                      className="clear-btn"
                      onClick={() => setRangeSelected(undefined)}
                    >
                      × Clear
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {role === 'admin' && !showSettings && !filterColumn && (
        <p className="warn">⚠ No filter column configured — open settings</p>
      )}

      {IS_LOCAL && (
        <button
          className="dev-role-toggle"
          onClick={() => setRole((r) => (r === 'admin' ? 'user' : 'admin'))}
          title="Toggle role (dev-only)"
          style={{
            position: 'absolute',
            bottom: 4,
            right: 4,
            fontSize: 10,
            padding: '2px 6px',
            border: '1px solid #ccc',
            borderRadius: 4,
            background: '#fff',
            cursor: 'pointer',
            opacity: 0.7,
          }}
        >
          dev: {role}
        </button>
      )}
    </div>
  );
}
