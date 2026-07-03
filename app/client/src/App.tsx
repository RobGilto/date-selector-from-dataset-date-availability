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
// v1.3.1: dateFormat is now a date-fns format pattern string.
// Literals inside patterns need single quotes: e.g. `yyyy ' – ' MMM`.
type DateFormat = string;

// Built-in presets always show at the top of the dropdown.
const BUILT_IN_FORMATS: { pattern: string; label: string }[] = [
  { pattern: "yyyy ' – ' MMM ' – ' dd", label: 'YYYY – MMM – DD (2026 – Sep – 30)' },
  { pattern: "yyyy ' – ' MMM", label: 'YYYY – MMM (2026 – Sep)' },
  { pattern: 'yyyy-MM-dd', label: 'YYYY-MM-DD (2026-09-30)' },
];
const DEFAULT_FORMAT_PATTERN = BUILT_IN_FORMATS[0].pattern;

// Legacy v1.3.0 enum → date-fns pattern migration on read.
const LEGACY_FORMAT_MAP: Record<string, string> = {
  DEFAULT_FORMAT_PATTERN: "yyyy ' – ' MMM ' – ' dd",
  'YYYY-MMM': "yyyy ' – ' MMM",
  'YYYY-MM-DD': 'yyyy-MM-dd',
};

function normalizeFormatPattern(stored: string | undefined): string {
  if (!stored) return DEFAULT_FORMAT_PATTERN;
  return LEGACY_FORMAT_MAP[stored] ?? stored;
}
// Direct emit ops map 1:1 to Domo FilterOperatorsNumeric.
// Computed-range ops (MTD/CYTD/FYTD) synthesise a BETWEEN payload with a
// computed start-of-period value; the picked date is the end.
type FilterOperator =
  | 'EQUALS'
  | 'BETWEEN'
  | 'LESS_THAN_EQUALS_TO'
  | 'GREAT_THAN_EQUALS_TO'
  | 'MTD'
  | 'CYTD'
  | 'FYTD';

function computedStartForOp(picked: Date, op: FilterOperator, fyStartMonth: number): Date | null {
  if (op === 'MTD') return new Date(picked.getFullYear(), picked.getMonth(), 1);
  if (op === 'CYTD') return new Date(picked.getFullYear(), 0, 1);
  if (op === 'FYTD') {
    // fyStartMonth is 1-based (1 = Jan, 7 = Jul AU).
    const m0 = Math.max(1, Math.min(12, fyStartMonth)) - 1;
    const pickedM = picked.getMonth();
    const y = pickedM >= m0 ? picked.getFullYear() : picked.getFullYear() - 1;
    return new Date(y, m0, 1);
  }
  return null;
}
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
  /** 1-based month of financial-year start. Default 7 (Jul, Australian FY). */
  fyStartMonth?: number;
  /** v1.3.3: optional App Studio variable to also drive on date pick.
   *  Name is the source of truth; functionId cached for callback stability. */
  variableName?: string;
  variableFid?: number;
  /** v1.3.4: value formula pushed to the variable. Default 'picked'. */
  variableValueMode?: VarValueMode;
}

type VarValueMode =
  | 'picked'
  | 'startOfMonth'
  | 'endOfMonth'
  | 'startOfCY'
  | 'startOfFY'
  | 'endOfFY';

function computeVarValue(picked: Date, mode: VarValueMode, fyStartMonth: number): string {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (mode === 'startOfMonth') return iso(new Date(picked.getFullYear(), picked.getMonth(), 1));
  if (mode === 'endOfMonth')   return iso(new Date(picked.getFullYear(), picked.getMonth() + 1, 0));
  if (mode === 'startOfCY')    return iso(new Date(picked.getFullYear(), 0, 1));
  if (mode === 'startOfFY') {
    const m0 = Math.max(1, Math.min(12, fyStartMonth)) - 1;
    const y = picked.getMonth() >= m0 ? picked.getFullYear() : picked.getFullYear() - 1;
    return iso(new Date(y, m0, 1));
  }
  if (mode === 'endOfFY') {
    const m0 = Math.max(1, Math.min(12, fyStartMonth)) - 1;
    const y = picked.getMonth() >= m0 ? picked.getFullYear() : picked.getFullYear() - 1;
    return iso(new Date(y + 1, m0, 0));
  }
  return iso(picked);
}

interface DetectedVar {
  functionId: number;
  name?: string;
  value?: unknown;
}

interface StateDoc {
  type: 'state';
  cardId?: string;
  singleDate?: string;
  rangeStart?: string;
  rangeEnd?: string;
}

// v1.3.1: global custom date-format entries shared across every card
// instance in this design. NOT scoped to cardId.
interface FormatDoc {
  type: 'format';
  pattern: string;
  label?: string;
}

type CollectionDoc = ConfigDoc | StateDoc | FormatDoc;

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

function formatDateLabel(d: Date, fmt: DateFormat = DEFAULT_FORMAT_PATTERN): string {
  const pattern = normalizeFormatPattern(fmt);
  try {
    return format(d, pattern);
  } catch {
    return format(d, DEFAULT_FORMAT_PATTERN);
  }
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

// v1.3.8 diagnostic: known NAB variable name→functionId (from HAR). Used only
// as a last-resort fallback when the fid can't be discovered or pasted.
const KNOWN_VARIABLE_IDS: Record<string, number> = {
  vMonthStart_test: 132051,
  vMonthStart: 130340,
};

// ── Live variable detection (v1.3.3) ────────────────────────────────────────
// Populated by domo.onVariablesUpdated. Keyed by functionId. Feeds the gear
// panel's "Also drive App Studio variable" dropdown so admins pick by NAME
// only — functionIds never surface in UI.
const detectedVars = new Map<number, DetectedVar>();
const detectedVarsListeners = new Set<() => void>();
function notifyDetected() {
  detectedVarsListeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
}
// v1.3.5: proactive variable discovery. onVariablesUpdated only fires when
// App Studio pushes updates; for a fresh page load with a custom-app card
// that isn't wired as a variable consumer, no push happens and the listener
// never fires. So we fetch the page's card list, then query variable
// controls for those cards, and seed detectedVars from that.
async function discoverPageVariables(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (domo as any).env ?? {};
    const pageId = String(env.pageId ?? '').trim();
    if (!pageId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (await (domo as any).get(
      `/content/v1/pages/${pageId}?parts=cards,collections`,
    )) as unknown;
    const cardIds: string[] = [];
    const collect = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = n as any;
      if (Array.isArray(obj.cards)) obj.cards.forEach((c: { id?: number | string }) => {
        if (c?.id != null) cardIds.push(String(c.id));
      });
      if (Array.isArray(obj.collections)) obj.collections.forEach(collect);
      if (Array.isArray(obj.children)) obj.children.forEach(collect);
    };
    collect(page);
    if (cardIds.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = (await (domo as any).put(
      `/content/v1/cards/variable/controls/list`,
      cardIds,
    )) as Record<string, Array<{ function?: { id?: number; name?: string }; parsedExpression?: { value?: unknown } }>>;
    let added = 0;
    Object.values(resp || {}).forEach((funcs) => {
      (funcs || []).forEach((f) => {
        const fid = f?.function?.id;
        const name = f?.function?.name;
        if (typeof fid === 'number' && Number.isFinite(fid)) {
          detectedVars.set(fid, {
            functionId: fid,
            name: typeof name === 'string' ? name : undefined,
            value: f?.parsedExpression?.value,
          });
          added++;
        }
      });
    });
    if (added > 0) notifyDetected();
  } catch (e) {
    console.warn('[discoverPageVariables]', e);
  }
}

let variablesListenerRegistered = false;
function registerVariablesListener() {
  if (variablesListenerRegistered) return;
  variablesListenerRegistered = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (domo as any).onVariablesUpdated((vars: any) => {
      const ingest = (fid: unknown, name: unknown, value: unknown) => {
        const n = typeof fid === 'number' ? fid : Number(fid);
        if (!Number.isFinite(n)) return;
        detectedVars.set(n, {
          functionId: n,
          name: typeof name === 'string' ? name : undefined,
          value,
        });
      };
      if (Array.isArray(vars)) {
        vars.forEach((v) => ingest(v?.functionId, v?.name, v?.value));
      } else if (vars && typeof vars === 'object') {
        Object.entries(vars).forEach(([k, entry]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const e = entry as any;
          ingest(k, e?.name, e?.parsedExpression?.value ?? e?.value);
        });
      }
      notifyDetected();
    });
  } catch (e) {
    console.warn('[registerVariablesListener]', e);
  }
}

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
  const [fyStartMonth, setFyStartMonth] = useState<number>(7);
  const filterColumnRef = useRef<string>('');
  const filterOperatorRef = useRef<FilterOperator>('EQUALS');
  const filterDataTypeRef = useRef<FilterDataType>('DATE');
  const fyStartMonthRef = useRef<number>(7);

  // v1.3.3: variable emission (optional, additive to page filter)
  const [variableName, setVariableName] = useState<string>('');
  const [variableFid, setVariableFid] = useState<number | null>(null);
  const [detected, setDetected] = useState<DetectedVar[]>([]);
  const [variableValueMode, setVariableValueMode] = useState<VarValueMode>('picked');
  const variableNameRef = useRef<string>('');
  const variableFidRef = useRef<number | null>(null);
  const variableValueModeRef = useRef<VarValueMode>('picked');

  const [dateFormat, setDateFormat] = useState<DateFormat>(DEFAULT_FORMAT_PATTERN);
  const dateFormatRef = useRef<DateFormat>(DEFAULT_FORMAT_PATTERN);
  const viewModeRef = useRef<ViewMode>('list');

  // v1.3.1: custom date-fns format patterns; global (shared across cards).
  const [customFormats, setCustomFormats] = useState<
    { id: string; pattern: string; label?: string }[]
  >([]);
  const [newFormatPattern, setNewFormatPattern] = useState('');
  const [newFormatLabel, setNewFormatLabel] = useState('');
  const [newFormatError, setNewFormatError] = useState('');

  const [role, setRole] = useState<Role>(IS_LOCAL ? 'admin' : 'user');

  const [isWide, setIsWide] = useState(
    () => window.matchMedia('(min-width: 720px)').matches
  );

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    resolveRole().then(setRole).catch(() => setRole('user'));
  }, []);

  // v1.3.3: subscribe to live variable detection so gear panel dropdown
  // lists names admins can pick without knowing functionIds.
  useEffect(() => {
    if (!IS_LOCAL) {
      registerVariablesListener();
      discoverPageVariables();
    }
    const onChange = () => setDetected(Array.from(detectedVars.values()));
    detectedVarsListeners.add(onChange);
    onChange();
    return () => { detectedVarsListeners.delete(onChange); };
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
      const formatDocs = docs?.filter((d) => d.content?.type === 'format') ?? [];
      setCustomFormats(
        formatDocs
          .map((d) => ({
            id: d.id,
            pattern: (d.content as FormatDoc).pattern,
            label: (d.content as FormatDoc).label,
          }))
          .filter((f) => typeof f.pattern === 'string' && f.pattern.trim().length > 0)
      );
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
        const df: DateFormat = normalizeFormatPattern(c.dateFormat);
        const fc = c.filterColumn ?? '';
        const fo: FilterOperator = c.filterOperator ?? 'EQUALS';
        const fdt: FilterDataType = c.filterDataType ?? 'DATE';
        const fym: number = c.fyStartMonth ?? 7;
        selectionModeRef.current = mode;
        viewModeRef.current = vm;
        dateFormatRef.current = df;
        filterColumnRef.current = fc;
        filterOperatorRef.current = fo;
        filterDataTypeRef.current = fdt;
        fyStartMonthRef.current = fym;
        setFyStartMonth(fym);
        setSelectionMode(mode);
        setViewMode(vm);
        setDateFormat(df);
        setFilterColumn(fc);
        setFilterOperator(fo);
        setFilterDataType(fdt);
        const vn = c.variableName ?? '';
        const vfid = c.variableFid ?? null;
        const vvm: VarValueMode = c.variableValueMode ?? 'picked';
        variableNameRef.current = vn;
        variableFidRef.current = vfid;
        variableValueModeRef.current = vvm;
        setVariableName(vn);
        setVariableFid(vfid);
        setVariableValueMode(vvm);
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
      const op = filterOperatorRef.current;
      const computedStart = computedStartForOp(
        isoToDate(s.singleDate),
        op,
        fyStartMonthRef.current,
      );
      if (computedStart) {
        const prev = op;
        filterOperatorRef.current = 'BETWEEN';
        emitFilter(buildFilterPayload([toISO(computedStart), s.singleDate]));
        filterOperatorRef.current = prev;
        return;
      }
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
        fyStartMonth: fyStartMonthRef.current,
        variableName: variableNameRef.current || undefined,
        variableFid: variableFidRef.current ?? undefined,
        variableValueMode: variableValueModeRef.current,
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

  async function addCustomFormat() {
    const pattern = newFormatPattern.trim();
    if (!pattern) {
      setNewFormatError('Pattern required');
      return;
    }
    try {
      const sample = format(new Date(), pattern);
      if (!sample) throw new Error('empty render');
    } catch (e) {
      setNewFormatError(`Invalid date-fns pattern: ${(e as Error).message}`);
      return;
    }
    const label = newFormatLabel.trim() || undefined;
    const allPatterns = new Set([
      ...BUILT_IN_FORMATS.map((f) => f.pattern),
      ...customFormats.map((f) => f.pattern),
    ]);
    if (allPatterns.has(pattern)) {
      setNewFormatError('Pattern already in list');
      return;
    }
    try {
      const res = await collBackend.create({ type: 'format', pattern, label });
      setCustomFormats((prev) => [...prev, { id: res.id, pattern, label }]);
      setNewFormatPattern('');
      setNewFormatLabel('');
      setNewFormatError('');
      dateFormatRef.current = pattern;
      setDateFormat(pattern);
      persistSettings({ dateFormat: pattern }, true);
    } catch (e) {
      console.error('[addCustomFormat]', e);
      setNewFormatError('Save failed — see console');
    }
  }

  async function deleteCustomFormat(id: string) {
    try {
      await collBackend.delete(id);
      const removed = customFormats.find((f) => f.id === id);
      setCustomFormats((prev) => prev.filter((f) => f.id !== id));
      if (removed && dateFormatRef.current === removed.pattern) {
        dateFormatRef.current = DEFAULT_FORMAT_PATTERN;
        setDateFormat(DEFAULT_FORMAT_PATTERN);
        persistSettings({ dateFormat: DEFAULT_FORMAT_PATTERN }, true);
      }
    } catch (e) {
      console.error('[deleteCustomFormat]', e);
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
      dateFormatRef.current = DEFAULT_FORMAT_PATTERN;
      setFilterColumn('');
      setFilterOperator('EQUALS');
      setFilterDataType('DATE');
      setViewMode('list');
      setDateFormat(DEFAULT_FORMAT_PATTERN);
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

  function emitVariable(picked: Date) {
    const name = variableNameRef.current;
    if (!name) return;
    let fid: number | null = null;
    for (const v of detectedVars.values()) {
      if (v.name === name) { fid = v.functionId; break; }
    }
    if (fid == null) fid = variableFidRef.current;
    // v1.3.8 diagnostic: last-resort name→fid lookup for known variables.
    // Custom-app iframes can't reach the variable-controls API and App Studio
    // never pushes variable state to the card, so auto-discovery of the fid
    // isn't possible. This proves whether fid-based override applies at all.
    if (fid == null && KNOWN_VARIABLE_IDS[name] != null) fid = KNOWN_VARIABLE_IDS[name];
    if (fid != null && Number.isFinite(fid) && variableFidRef.current !== fid) {
      variableFidRef.current = fid;
    }
    const value = computeVarValue(picked, variableValueModeRef.current, fyStartMonthRef.current);
    // DATE variables take an ISO 'YYYY-MM-DD' string. Beast modes compare
    // `Date` = vMonthStart_test against the raw date, so the value must be the
    // ISO date, not epoch millis.
    // ryuu v6 Variable interface: { functionId?, name?, value } — either
    // identifier accepted. Prefer fid when known, fall back to name.
    const payload: { functionId?: number; name?: string; value: string } = { value };
    if (fid != null && Number.isFinite(fid)) payload.functionId = fid;
    else payload.name = name;
    if (IS_LOCAL) {
      console.log('[DEV] emit variable:', { ...payload, mode: variableValueModeRef.current });
      return;
    }
    try {
      const via = payload.functionId != null ? `fid=${payload.functionId}` : `name=${name}`;
      console.log(`[emitVariable] sending ${via} value=${value}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (domo as any).requestVariablesUpdate(
        [payload],
        () => console.log(`[emitVariable] ✓ ack (${via}) = ${value}`),
        (reply: unknown) => console.log('[emitVariable] ← reply:', JSON.stringify(reply)),
      );
    } catch (e) {
      console.error('[emitVariable]', e);
    }
  }

  const handleSingleSelect = useCallback(
    (date: Date | undefined) => {
      if (!date) return;
      const iso = toISO(date);
      if (!availableDates.has(iso)) return;
      setSingleSelected(date);
      persistState({ singleDate: iso });
      // Variable emit runs regardless of filter-column presence — customer's
      // beast modes may rely on the variable even without a page filter set.
      emitVariable(date);
      if (!filterColumnRef.current) return;
      const op = filterOperatorRef.current;
      // Computed-range ops synthesise a BETWEEN payload with a period-start value.
      const computedStart = computedStartForOp(date, op, fyStartMonthRef.current);
      if (computedStart) {
        const startIso = toISO(computedStart);
        const prev = op;
        filterOperatorRef.current = 'BETWEEN';
        emitFilter(buildFilterPayload([startIso, iso]));
        filterOperatorRef.current = prev;
        return;
      }
      // Direct-emit ops. Force EQUALS if user picked BETWEEN with a single value.
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
              <optgroup label="Direct">
                <option value="EQUALS">EQUALS (single date)</option>
                <option value="LESS_THAN_EQUALS_TO">LESS_THAN_EQUALS_TO (through date)</option>
                <option value="GREAT_THAN_EQUALS_TO">GREAT_THAN_EQUALS_TO (from date)</option>
                <option value="BETWEEN">BETWEEN (range)</option>
              </optgroup>
              <optgroup label="Computed range (auto-BETWEEN)">
                <option value="MTD">MTD — Month to date</option>
                <option value="CYTD">CYTD — Calendar year to date</option>
                <option value="FYTD">FYTD — Financial year to date</option>
              </optgroup>
            </select>
            <p className="settings-hint">
              Computed ranges emit <code>BETWEEN [period-start, picked]</code>{' '}
              so downstream cards see the full period without beast-mode rework.
            </p>
          </div>

          {filterOperator === 'FYTD' && (
            <div className="settings-group">
              <label className="settings-sublabel">Financial year starts</label>
              <select
                className="settings-input"
                value={fyStartMonth}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isFinite(v)) return;
                  setFyStartMonth(v);
                  fyStartMonthRef.current = v;
                  persistSettings({ fyStartMonth: v }, true);
                }}
              >
                {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                  <option key={m} value={i + 1}>{i + 1} — {m} 1{i === 0 ? ' (Calendar year)' : ''}{i + 1 === 7 ? ' (AU tax year)' : ''}{i + 1 === 10 ? ' (AU marketing FY, e.g. NAB)' : ''}</option>
                ))}
              </select>
            </div>
          )}

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
            <label className="settings-sublabel">
              Also drive App Studio variable (optional)
            </label>
            {(() => {
              const namedDetected = detected.filter((d) => !!d.name);
              return (
                <>
                  <input
                    className="settings-input"
                    type="text"
                    list="variable-name-options"
                    placeholder="e.g. vMonthStart_test"
                    value={variableName}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      const match = namedDetected.find((d) => d.name === v);
                      variableNameRef.current = v;
                      // Only overwrite fid from a detection match; keep a
                      // manually-pasted fid otherwise.
                      const nextFid = match?.functionId ?? variableFidRef.current ?? null;
                      variableFidRef.current = nextFid;
                      setVariableName(v);
                      setVariableFid(nextFid);
                      persistSettings({
                        variableName: v || undefined,
                        variableFid: nextFid ?? undefined,
                      }, true);
                    }}
                  />
                  <datalist id="variable-name-options">
                    {namedDetected.map((v) => (
                      <option key={v.functionId} value={v.name}>
                        {typeof v.value === 'string' ? v.value : ''}
                      </option>
                    ))}
                  </datalist>
                  <p className="settings-hint">
                    Type the exact variable name (e.g. <code>vMonthStart_test</code>).
                    {namedDetected.length > 0
                      ? ` Autocomplete lists ${namedDetected.length} detected variable${namedDetected.length === 1 ? '' : 's'}.`
                      : ' No auto-detected variables yet — App Studio does not push variables to custom-app cards, so type the name manually.'}
                  </p>
                  {variableName && (
                    <>
                      <label
                        className="settings-sublabel"
                        style={{ display: 'block', marginTop: 8 }}
                      >
                        Variable ID (auto-fills if detected; paste once if blank)
                      </label>
                      <input
                        className="settings-input"
                        type="number"
                        placeholder="e.g. 132051"
                        value={variableFid ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          const n = raw ? parseInt(raw, 10) : null;
                          const val = n != null && Number.isFinite(n) ? n : null;
                          variableFidRef.current = val;
                          setVariableFid(val);
                          persistSettings({ variableFid: val ?? undefined }, true);
                        }}
                      />
                      <p className="settings-hint">
                        Domo resolves variables reliably by ID. Find it once via
                        the variable's URL or ask your Domo admin. Brick pushes
                        by ID when present, else by name.
                      </p>
                      <label
                        className="settings-sublabel"
                        style={{ display: 'block', marginTop: 8 }}
                      >
                        Push what value to <code>{variableName}</code>?
                      </label>
                      <select
                        className="settings-input"
                        value={variableValueMode}
                        onChange={(e) => {
                          const v = e.target.value as VarValueMode;
                          setVariableValueMode(v);
                          variableValueModeRef.current = v;
                          persistSettings({ variableValueMode: v }, true);
                        }}
                      >
                        <option value="picked">Picked date (e.g. 2024-11-15)</option>
                        <option value="startOfMonth">Start of picked month (2024-11-01)</option>
                        <option value="endOfMonth">End of picked month (2024-11-30)</option>
                        <option value="startOfCY">Start of calendar year (2024-01-01)</option>
                        <option value="startOfFY">Start of financial year (uses FY month above)</option>
                        <option value="endOfFY">End of financial year</option>
                      </select>
                      <p className="settings-hint">
                        Beast modes referencing <code>{variableName}</code> get
                        this computed value on every date pick.
                      </p>
                    </>
                  )}
                </>
              );
            })()}
          </div>

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
              <optgroup label="Built-in">
                {BUILT_IN_FORMATS.map((f) => (
                  <option key={f.pattern} value={f.pattern}>{f.label}</option>
                ))}
              </optgroup>
              {customFormats.length > 0 && (
                <optgroup label="Custom (shared across cards)">
                  {customFormats.map((f) => (
                    <option key={f.id} value={f.pattern}>
                      {f.label || f.pattern} — {(() => {
                        try { return format(new Date(), f.pattern); } catch { return 'invalid'; }
                      })()}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <p className="settings-hint">
              Preview: {formatDateLabel(new Date(), dateFormat)}
            </p>

            {customFormats.length > 0 && (
              <div className="settings-hint" style={{ marginTop: 8 }}>
                <strong>Custom formats:</strong>
                <ul style={{ margin: '4px 0 8px 16px', padding: 0 }}>
                  {customFormats.map((f) => (
                    <li key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <code style={{ flex: 1 }}>{f.label ? `${f.label} — ` : ''}{f.pattern}</code>
                      <button
                        type="button"
                        onClick={() => deleteCustomFormat(f.id)}
                        title="Delete this format (affects all cards)"
                        style={{ padding: '0 6px', fontSize: 11, cursor: 'pointer' }}
                      >×</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ marginTop: 8, padding: 8, border: '1px dashed #ccc', borderRadius: 4 }}>
              <label className="settings-sublabel" style={{ display: 'block', marginBottom: 4 }}>
                Add custom format
              </label>
              <input
                className="settings-input"
                type="text"
                placeholder="date-fns pattern, e.g. yyyy MMMM d"
                value={newFormatPattern}
                onChange={(e) => { setNewFormatPattern(e.target.value); setNewFormatError(''); }}
              />
              <input
                className="settings-input"
                type="text"
                placeholder="Label (optional, shown in dropdown)"
                value={newFormatLabel}
                onChange={(e) => setNewFormatLabel(e.target.value)}
                style={{ marginTop: 4 }}
              />
              {newFormatPattern && !newFormatError && (() => {
                try {
                  return (
                    <p className="settings-hint" style={{ marginTop: 4 }}>
                      Preview: <code>{format(new Date(), newFormatPattern)}</code>
                    </p>
                  );
                } catch {
                  return <p className="settings-hint" style={{ color: '#c0392b' }}>Invalid pattern</p>;
                }
              })()}
              {newFormatError && (
                <p className="settings-hint" style={{ color: '#c0392b' }}>{newFormatError}</p>
              )}
              <button
                type="button"
                onClick={addCustomFormat}
                style={{ marginTop: 6, padding: '4px 10px', cursor: 'pointer' }}
              >
                Add + Use
              </button>
              <p className="settings-hint" style={{ marginTop: 4, fontSize: 11 }}>
                Tokens: <code>yyyy</code> year · <code>MM</code>/<code>MMM</code>/<code>MMMM</code> month ·
                {' '}<code>dd</code>/<code>d</code> day · <code>EEEE</code> weekday. Literals inside single quotes,
                {' '}e.g. <code>yyyy ' – ' MMM ' – ' dd</code>.
              </p>
            </div>
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
