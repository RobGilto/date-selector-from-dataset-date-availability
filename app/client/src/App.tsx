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
// Optional second dataset alias: a customer-maintained "variables registry" —
// two columns (Variable, VariableID) mapping human-readable variable names
// to App Studio function IDs. Mirrors the Nine "Top Program" pattern. Lets
// the brick drive variables by NAME instead of magic numeric IDs.
const VARIABLES_DATASET_ALIAS = 'variablesDataSet';
const EN_DASH = '–';
const DEFAULT_SINGLE_FID = 131272;
// Between mode is not currently exposed pending product decision.
// Hide the toggle UI but keep the code paths so we can re-enable without a
// rebuild once they come back with a use case.
const HIDE_BETWEEN = true;
const IS_LOCAL =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1';

// Per-card identity — v1.2 scopes every AppDB doc to a specific card-instance
// so two bricks on the same page hold independent settings.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CURRENT_CARD_ID: string =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  String(((domo as any).env?.cardId ?? '').toString().trim() || 'local-card-001');

// ── Types ─────────────────────────────────────────────────────────────────────
type SelectionMode = 'single' | 'between';
type ViewMode = 'calendar' | 'list';
type DateFormat = 'YYYY-MMM' | 'YYYY-MMM-DD' | 'YYYY-MM-DD';

interface ConfigDoc {
  type?: 'config';
  // v1.2: card-instance discriminator. Older docs without this field are
  // treated as a design-wide default at load time.
  cardId?: string;
  // Preferred (v1.2+): variable identified by NAME, resolved via registry dataset.
  variableName?: string;
  // Legacy: variable identified by raw functionId. Used as fallback when no
  // variableName configured or registry lookup misses.
  functionId?: number;
  mode?: SelectionMode;
  rangeStartFunctionId?: number;
  rangeEndFunctionId?: number;
  // v1.2: per-card view + format preferences.
  viewMode?: ViewMode;
  dateFormat?: DateFormat;
}

interface StateDoc {
  type: 'state';
  cardId?: string;
  singleDate?: string;
  rangeStart?: string;
  rangeEnd?: string;
}

type CollectionDoc = ConfigDoc | StateDoc;

interface DetectedVar {
  functionId: number;
  name?: string;
  value?: unknown;
}

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
// Real Domo in production; localStorage shim when IS_LOCAL so persistence flows
// (persistState, persistSettings, loadSettings, reset) can be exercised in dev.
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

// ── Variable name → functionId registry ─────────────────────────────────────
// Resolves a customer-friendly variable name (e.g. "vTillSelectedMonth") to
// its App Studio function ID via the bound `variablesDataSet`. The customer
// maintains the dataset (CSV upload or Magic ETL output) with two columns:
// Variable, VariableID. Lookup is module-scoped + cached for the session.
//
// Mirrors the Nine "Top Program" pattern. Survives App Studio variable
// rebuilds (function IDs churn; names stay stable) and removes the need for
// the user to know magic numeric IDs.
let varRegistryCache: Map<string, number> | null = null;
let varRegistryPromise: Promise<Map<string, number>> | null = null;

async function fetchLocalRegistry(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const res = await fetch('/sample-variables-registry.csv');
    if (!res.ok) return map;
    const text = await res.text();
    const lines = text.trim().split('\n');
    const header = lines[0].split(',').map((h) => h.trim());
    const nameIdx = header.indexOf('Variable');
    const idIdx = header.indexOf('VariableID');
    if (nameIdx === -1 || idIdx === -1) return map;
    lines.slice(1).forEach((line) => {
      const cols = line.split(',').map((c) => c.trim());
      const name = cols[nameIdx];
      const id = Number(cols[idIdx]);
      if (name && Number.isFinite(id)) map.set(name, id);
    });
  } catch {
    /* ignore — empty registry is valid */
  }
  return map;
}

async function resolveVarIds(): Promise<Map<string, number>> {
  if (varRegistryCache) return varRegistryCache;
  if (varRegistryPromise) return varRegistryPromise;
  varRegistryPromise = (async () => {
    const map = new Map<string, number>();
    if (IS_LOCAL) {
      const local = await fetchLocalRegistry();
      local.forEach((v, k) => map.set(k, v));
      varRegistryCache = map;
      return map;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (await (domo as any).get(
        `/data/v1/${VARIABLES_DATASET_ALIAS}?fields=Variable,VariableID`
      )) as { Variable?: string; VariableID?: string | number }[];
      for (const r of rows ?? []) {
        const name = r?.Variable ? String(r.Variable) : '';
        const idNum = Number(r?.VariableID);
        if (name && Number.isFinite(idNum)) map.set(name, idNum);
      }
    } catch (e) {
      console.warn('[resolveVarIds] registry dataset unavailable', e);
    }
    varRegistryCache = map;
    return map;
  })();
  return varRegistryPromise;
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

// ── Module-level variable detection ──────────────────────────────────────────
const detectedVars = new Map<number, DetectedVar>();
const detectedVarsListeners = new Set<() => void>();
function notifyDetected() {
  detectedVarsListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}
let listenerRegistered = false;
function registerVariablesListener() {
  if (listenerRegistered) return;
  listenerRegistered = true;
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
const CalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5zM1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4H1z" />
  </svg>
);
const ListIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z" />
  </svg>
);
const GearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" />
    <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" />
  </svg>
);

// ── Component ──────────────────────────────────────────────────────────────────
export default function App() {
  // Data
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  const [sortedDates, setSortedDates] = useState<string[]>([]);
  const [dataStatus, setDataStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dataError, setDataError] = useState('');

  // Selection
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('single');
  const [singleSelected, setSingleSelected] = useState<Date | undefined>();
  const [rangeSelected, setRangeSelected] = useState<DateRange | undefined>();

  // View
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [showSettings, setShowSettings] = useState(false);

  // Settings (refs for callbacks)
  const configDocIdRef = useRef<string | null>(null);
  const stateDocIdRef = useRef<string | null>(null);
  const functionIdRef = useRef<number | null>(DEFAULT_SINGLE_FID);
  const rangeStartFidRef = useRef<number | null>(null);
  const rangeEndFidRef = useRef<number | null>(null);
  const selectionModeRef = useRef<SelectionMode>('single');
  const variableNameRef = useRef<string | null>(null);

  // Settings (state for display)
  const [functionId, setFunctionId] = useState<number | null>(DEFAULT_SINGLE_FID);
  const [rangeStartFid, setRangeStartFid] = useState<number | null>(null);
  const [rangeEndFid, setRangeEndFid] = useState<number | null>(null);
  const [variableName, setVariableName] = useState<string>('');
  const [registry, setRegistry] = useState<Map<string, number>>(new Map());

  // v1.2: per-card view + format preferences.
  const [dateFormat, setDateFormat] = useState<DateFormat>('YYYY-MMM-DD');
  const dateFormatRef = useRef<DateFormat>('YYYY-MMM-DD');
  const viewModeRef = useRef<ViewMode>('calendar');

  // v1.2: role-gated rendering. Admin sees toolbar + gear, user sees content only.
  const [role, setRole] = useState<Role>(IS_LOCAL ? 'admin' : 'user');

  // Settings inputs
  const [inputFid, setInputFid] = useState(String(DEFAULT_SINGLE_FID));
  const [inputRangeStartFid, setInputRangeStartFid] = useState('');
  const [inputRangeEndFid, setInputRangeEndFid] = useState('');
  const [autoDetected, setAutoDetected] = useState(false);
  const [detected, setDetected] = useState<DetectedVar[]>([]);

  // Responsive
  const [isWide, setIsWide] = useState(
    () => window.matchMedia('(min-width: 720px)').matches
  );

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!IS_LOCAL) registerVariablesListener();
    const onChange = () => setDetected(Array.from(detectedVars.values()));
    detectedVarsListeners.add(onChange);
    onChange();
    // v1.2: page-controls REST discovery dropped — onVariablesUpdated event
    // bus is the only auto-detect path. Variables registry dataset handles
    // the named-variable lookup. No more dev-console snippet workaround.
    return () => {
      detectedVarsListeners.delete(onChange);
    };
  }, []);

  // v1.2: resolve role once on mount. Result feeds the toolbar/gear gate.
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
      // Load registry first — loadSettings's rehydrateVariables path relies on
      // effectiveFid() being able to resolve names that were persisted.
      const reg = await resolveVarIds();
      setRegistry(reg);
      await loadSettings();
      await fetchDates();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-adopt detected variables — zero-config UX so end users never see IDs.
  // First date-shaped var → single-mode + range-end. Second → range-start.
  useEffect(() => {
    if (detected.length === 0) return;
    const dateVars = detected.filter(
      (v) =>
        typeof v.value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(String(v.value))
    );
    const ordered = dateVars.length > 0 ? dateVars : detected;
    const first = ordered[0];
    const second = ordered[1];

    // First var → single mode if not set
    if (functionIdRef.current === null && first) {
      applyFunctionId(first.functionId, true);
      setAutoDetected(true);
      persistSettings({ functionId: first.functionId }, true);
    }
    // Second var → range start if not set
    if (rangeStartFidRef.current === null && second) {
      rangeStartFidRef.current = second.functionId;
      setRangeStartFid(second.functionId);
      setInputRangeStartFid(String(second.functionId));
      // range end falls back to single var via applyRange chain
      persistSettings({ rangeStartFunctionId: second.functionId }, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected]);

  // ── Settings helpers ─────────────────────────────────────────────────────────

  function applyFunctionId(fid: number, silent = false) {
    functionIdRef.current = fid;
    setFunctionId(fid);
    setInputFid(String(fid));
    if (!silent) setAutoDetected(false);
  }

  async function loadSettings() {
    try {
      const docs = await collBackend.queryAll();

      // v1.2: partition by type AND cardId. Prefer card-keyed docs; legacy
      // docs without `cardId` are treated as a design-wide default safety net
      // (read-only on first load — next save creates a card-keyed doc).
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
        // Only adopt the doc id if it's already card-keyed; legacy unkeyed
        // doc id should NOT be reused for future writes (we want a fresh
        // card-keyed doc on next save).
        const c = content as ConfigDoc;
        if (c.cardId === CURRENT_CARD_ID) configDocIdRef.current = id;
        const fid = c.functionId ?? DEFAULT_SINGLE_FID;
        const rsf = c.rangeStartFunctionId ?? null;
        const ref = c.rangeEndFunctionId ?? null;
        // Force single while Between is masked — stored 'between' from prior
        // run shouldn't surface a UI we've removed.
        const mode = HIDE_BETWEEN ? 'single' : (c.mode ?? 'single');
        const vname = c.variableName ?? '';
        const vm: ViewMode = c.viewMode ?? 'list';
        const df: DateFormat = c.dateFormat ?? 'YYYY-MMM-DD';
        functionIdRef.current = fid;
        rangeStartFidRef.current = rsf;
        rangeEndFidRef.current = ref;
        selectionModeRef.current = mode;
        variableNameRef.current = vname || null;
        viewModeRef.current = vm;
        dateFormatRef.current = df;
        setFunctionId(fid);
        setRangeStartFid(rsf);
        setRangeEndFid(ref);
        setSelectionMode(mode);
        setVariableName(vname);
        setViewMode(vm);
        setDateFormat(df);
        setInputFid(String(fid));
        if (rsf) setInputRangeStartFid(String(rsf));
        if (ref) setInputRangeEndFid(String(ref));
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
        // Re-fire variables so cards restore filter without user re-clicking.
        rehydrateVariables(s);
      }
    } catch (e) {
      console.warn('[loadSettings]', e);
    }
  }

  // Resolve which functionId the brick should push. Registry-by-name takes
  // priority; falls back to the legacy raw functionId stored in config.
  // Reads the module-level cache (varRegistryCache) directly so callbacks
  // that fire before the React `registry` state has populated still resolve.
  // Returns null if neither is configured / resolvable.
  function effectiveFid(): number | null {
    const name = variableNameRef.current;
    if (name) {
      const fid = varRegistryCache?.get(name) ?? registry.get(name);
      if (typeof fid === 'number') return fid;
      console.warn(`[effectiveFid] '${name}' not in registry — falling back to functionId`);
    }
    return functionIdRef.current ?? null;
  }

  function rehydrateVariables(s: StateDoc) {
    const updates: { functionId: number; value: string }[] = [];
    if (selectionModeRef.current === 'single' && s.singleDate) {
      const fid = effectiveFid();
      if (fid !== null) updates.push({ functionId: fid, value: s.singleDate });
    }
    if (selectionModeRef.current === 'between' && s.rangeStart) {
      const startFid = rangeStartFidRef.current;
      const endFid = rangeEndFidRef.current ?? effectiveFid();
      const to = s.rangeEnd ?? s.rangeStart;
      if (startFid) updates.push({ functionId: startFid, value: s.rangeStart });
      if (endFid && endFid !== startFid)
        updates.push({ functionId: endFid, value: to });
    }
    if (updates.length === 0) return;
    if (IS_LOCAL) {
      console.log('[DEV] rehydrate variables:', updates);
      return;
    }
    domo.requestVariablesUpdate(updates, () => {}, () => {});
  }

  async function persistSettings(patch: Partial<ConfigDoc>, silent = false) {
    try {
      const current: ConfigDoc = {
        functionId: functionIdRef.current ?? undefined,
        variableName: variableNameRef.current ?? undefined,
        mode: selectionModeRef.current,
        rangeStartFunctionId: rangeStartFidRef.current ?? undefined,
        rangeEndFunctionId: rangeEndFidRef.current ?? undefined,
        viewMode: viewModeRef.current,
        dateFormat: dateFormatRef.current,
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
      // Read-modify-write: preserve unrelated fields (singleDate stays when
      // only the range changes, and vice versa).
      const existing: Partial<StateDoc> = {};
      if (stateDocIdRef.current) {
        try {
          const doc = await collBackend.getOne(stateDocIdRef.current);
          if (doc?.content) Object.assign(existing, doc.content);
        } catch {
          /* fall through to create */
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

  async function saveSettingsFromForm() {
    const fid = parseInt(inputFid, 10);
    const rsf = inputRangeStartFid ? parseInt(inputRangeStartFid, 10) : null;
    const ref = inputRangeEndFid ? parseInt(inputRangeEndFid, 10) : null;
    if (!isNaN(fid)) {
      functionIdRef.current = fid;
      setFunctionId(fid);
    }
    if (rsf !== null && !isNaN(rsf)) {
      rangeStartFidRef.current = rsf;
      setRangeStartFid(rsf);
    }
    if (ref !== null && !isNaN(ref)) {
      rangeEndFidRef.current = ref;
      setRangeEndFid(ref);
    }
    setAutoDetected(false);
    await persistSettings({
      functionId: !isNaN(fid) ? fid : undefined,
      rangeStartFunctionId: rsf !== null && !isNaN(rsf) ? rsf : undefined,
      rangeEndFunctionId: ref !== null && !isNaN(ref) ? ref : undefined,
    });
  }

  async function resetSettings() {
    try {
      if (configDocIdRef.current) await collBackend.delete(configDocIdRef.current);
      if (stateDocIdRef.current) await collBackend.delete(stateDocIdRef.current);
      configDocIdRef.current = null;
      stateDocIdRef.current = null;
      functionIdRef.current = null;
      rangeStartFidRef.current = null;
      rangeEndFidRef.current = null;
      variableNameRef.current = null;
      viewModeRef.current = 'list';
      dateFormatRef.current = 'YYYY-MMM-DD';
      setFunctionId(null);
      setRangeStartFid(null);
      setRangeEndFid(null);
      setVariableName('');
      setViewMode('list');
      setDateFormat('YYYY-MMM-DD');
      setInputFid('');
      setInputRangeStartFid('');
      setInputRangeEndFid('');
      setSingleSelected(undefined);
      setRangeSelected(undefined);
      setAutoDetected(false);
      detectedVars.clear();
      notifyDetected();
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

    // This month
    const mStart = toISO(startOfMonth(today));
    const mEnd = toISO(endOfMonth(today));
    const thisMo = sortedDates.filter((d) => d >= mStart && d <= mEnd);
    if (thisMo.length > 0) {
      result.push({
        label: 'This month',
        range: { from: isoToDate(thisMo[0]), to: isoToDate(thisMo[thisMo.length - 1]) },
      });
    }

    // Last 30 days
    const l30Start = toISO(subDays(today, 29));
    const l30 = sortedDates.filter((d) => d >= l30Start && d <= todayISO);
    if (l30.length > 0) {
      result.push({
        label: 'Last 30d',
        range: { from: isoToDate(l30[0]), to: isoToDate(l30[l30.length - 1]) },
      });
    }

    // YTD
    const ytdStart = toISO(startOfYear(today));
    const ytd = sortedDates.filter((d) => d >= ytdStart && d <= todayISO);
    if (ytd.length > 0) {
      result.push({
        label: 'YTD',
        range: { from: isoToDate(ytd[0]), to: isoToDate(ytd[ytd.length - 1]) },
      });
    }

    // All data
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
  }, [rangeSelected]);

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
      const fid = effectiveFid();
      if (IS_LOCAL) {
        console.log('[DEV] single pick:', iso, '(fid=', fid, ')');
        return;
      }
      if (fid !== null) {
        domo.requestVariablesUpdate(
          [{ functionId: fid, value: iso }],
          () => {},
          () => {}
        );
      }
    },
    [availableDates]
  );

  // Apply: push range to whatever variables are bound to the brick.
  // Fallback chain: if no dedicated range vars configured, push END date to
  // the single-mode variable so existing cards filtered by vTillSelectedMonth
  // still update. Zero-config Between works as long as ANY var is bound.
  const applyRange = useCallback(() => {
    if (!rangeSelected?.from) return;
    const from = toISO(rangeSelected.from);
    const to = rangeSelected.to ? toISO(rangeSelected.to) : from;
    // Persist picked range to collection (brick state — survives reload).
    persistState({ rangeStart: from, rangeEnd: to });
    if (IS_LOCAL) {
      console.log('[DEV] range apply:', from, '→', to);
      return;
    }
    // Fire App Studio variables so cards re-filter. Collection is brick memory,
    // variables are filter transport — cards never touch the collection.
    const startFid = rangeStartFidRef.current;
    const endFid = rangeEndFidRef.current ?? effectiveFid();
    const updates: { functionId: number; value: string }[] = [];
    if (startFid) updates.push({ functionId: startFid, value: from });
    if (endFid && endFid !== startFid)
      updates.push({ functionId: endFid, value: to });
    if (updates.length === 0) {
      console.warn(
        '[applyRange] no variable bound to brick — App Studio designer must map at least one Date variable'
      );
      return;
    }
    console.log('[applyRange] firing variables update:', updates);
    domo.requestVariablesUpdate(
      updates,
      () => console.log('[applyRange] ✓ update accepted'),
      (err: unknown) => console.error('[applyRange] update failed:', err)
    );
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

  return (
    <div className={`app mode-${role}`}>
      {/* Screen-reader-only selected-date announcement (label visually hidden) */}
      {toolbarLabel && (
        <span className="sr-only" aria-live="polite">
          Selected: {toolbarLabel}
        </span>
      )}
      {/* ── Toolbar — admin/owner only. End users see content only. ── */}
      {role === 'admin' && (
      <div className="toolbar">
        <div className="toggle-group">
          {selectionMode === 'single' && (
            <button
              className={`toggle-btn ${viewMode === 'list' && !showSettings ? 'active' : ''}`}
              onClick={() => {
                setShowSettings(false);
                setViewMode('list');
              }}
              title="List view"
            >
              <ListIcon />
            </button>
          )}
          <button
            className={`toggle-btn ${viewMode === 'calendar' && !showSettings ? 'active' : ''}`}
            onClick={() => {
              setShowSettings(false);
              setViewMode('calendar');
            }}
            title="Calendar view"
          >
            <CalIcon />
          </button>
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

      {/* ── Settings panel — admin/owner only ── */}
      {role === 'admin' && showSettings && (
        <div className="settings-panel">
          <label className="settings-label">Variable Configuration</label>

          {detected.length > 0 && (() => {
            // Surface date-typed vars first — they're what this brick can drive.
            // 'value' on a detected var is the live variable value pushed by
            // App Studio; an ISO-date shape is the strongest signal.
            const isDateShaped = (v: DetectedVar) =>
              typeof v.value === 'string' &&
              /^\d{4}-\d{2}-\d{2}/.test(String(v.value));
            const isDateNamed = (v: DetectedVar) =>
              !!v.name && /date|month|day|year|period|till|start|end/i.test(v.name);
            const dateVars = detected.filter((v) => isDateShaped(v) || isDateNamed(v));
            const otherVars = detected.filter(
              (v) => !(isDateShaped(v) || isDateNamed(v))
            );
            return (
              <div className="settings-detected">
                <p className="settings-hint">
                  Detected on this page — pick the variable this brick should
                  drive ({dateVars.length} date-typed, {otherVars.length} other):
                </p>
                <select
                  className="settings-input"
                  value={functionId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    const fid = Number(v);
                    if (!Number.isFinite(fid)) return;
                    applyFunctionId(fid);
                    persistSettings({ functionId: fid }, true);
                  }}
                >
                  <option value="">— select a variable —</option>
                  {dateVars.length > 0 && (
                    <optgroup label="Date-typed">
                      {dateVars.map((v) => (
                        <option key={v.functionId} value={v.functionId}>
                          {(v.name || `Variable ${v.functionId}`)} ({v.functionId})
                          {typeof v.value === 'string' ? ` — current: ${v.value}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {otherVars.length > 0 && (
                    <optgroup label="Other detected">
                      {otherVars.map((v) => (
                        <option key={v.functionId} value={v.functionId}>
                          {(v.name || `Variable ${v.functionId}`)} ({v.functionId})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            );
          })()}

          <div className="settings-group">
            <label className="settings-sublabel">
              Variable name
            </label>
            <input
              className="settings-input"
              type="text"
              placeholder="e.g. vTillSelectedMonth"
              list="variable-name-options"
              value={variableName}
              onChange={(e) => {
                const v = e.target.value;
                setVariableName(v);
                variableNameRef.current = v || null;
                persistSettings({ variableName: v || undefined }, true);
              }}
            />
            <datalist id="variable-name-options">
              {Array.from(registry.keys()).map((n) => (
                <option key={n} value={n}>{`${n} (${registry.get(n)})`}</option>
              ))}
            </datalist>
            {registry.size === 0 && (
              <p className="settings-hint">
                No <code>variablesDataSet</code> bound — fill in the legacy ID
                below, or bind a registry dataset (see SETUP.md).
              </p>
            )}
            {variableName && registry.size > 0 && !registry.has(variableName) && (
              <p className="settings-hint" style={{ color: '#c0392b' }}>
                ⚠ '{variableName}' not in registry — will fall back to legacy ID
              </p>
            )}
          </div>

          {/* v1.2: per-card default view + date format */}
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

          {/* Legacy numeric ID — hidden under disclosure as a fallback only */}
          <details className="settings-group">
            <summary className="settings-sublabel" style={{ cursor: 'pointer' }}>
              Advanced — legacy numeric variable ID
            </summary>
            <input
              className="settings-input"
              type="number"
              placeholder="e.g. 131272 (only if no registry binding)"
              value={inputFid}
              onChange={(e) => setInputFid(e.target.value)}
              style={{ marginTop: '4px' }}
            />
            <p className="settings-hint">
              Only used when the variables registry dataset is unbound or
              missing the configured variable name. Prefer Variable name above.
            </p>
          </details>

          {!HIDE_BETWEEN && (
          <div className="settings-group">
            <label className="settings-sublabel">Range start variable ID</label>
            <input
              className="settings-input"
              type="number"
              placeholder="TBD — confirm with customer"
              value={inputRangeStartFid}
              onChange={(e) => setInputRangeStartFid(e.target.value)}
            />
          </div>
          )}

          {!HIDE_BETWEEN && (
          <div className="settings-group">
            <label className="settings-sublabel">Range end variable ID</label>
            <input
              className="settings-input"
              type="number"
              placeholder="TBD — confirm with customer"
              value={inputRangeEndFid}
              onChange={(e) => setInputRangeEndFid(e.target.value)}
            />
          </div>
          )}

          <div className="settings-actions">
            <button className="settings-save" onClick={saveSettingsFromForm}>
              Save
            </button>
            <button className="settings-reset" onClick={resetSettings}>
              Reset
            </button>
          </div>

          <p className="settings-saved">
            <strong>Admin</strong> · Card {CURRENT_CARD_ID.slice(0, 8)}
            {variableName && <> · driving <code>{variableName}</code></>}
            {!variableName && functionId !== null && <> · fid {functionId}</>}
            {autoDetected && <span className="settings-auto"> (auto-detected)</span>}
          </p>
        </div>
      )}

      {/* ── Main calendar area ── */}
      {!showSettings && (
        <>
          {/* Selection mode toggle — hidden while Between is masked. */}
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

          {/* List / dropdown — single mode only.
              End users ALWAYS see the dropdown regardless of saved viewMode.
              Admins follow the saved view setting. */}
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

          {/* Calendar — admin only (end users see only the dropdown above) */}
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

              {/* Between-mode controls */}
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

                  {!functionId && !rangeStartFid && !rangeEndFid && (
                    <p className="range-config-warn">
                      ⚠ No variable bound to this brick. App Studio designer must
                      map at least one Date variable in the brick's Variables panel.
                    </p>
                  )}
                  <div className="range-actions">
                    <button
                      className="apply-btn"
                      disabled={!rangeSelected?.from}
                      onClick={applyRange}
                      title="Push range to bound variables"
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

      {/* Single-mode warning — admin/owner only */}
      {role === 'admin' && !showSettings && selectionMode === 'single' && !functionId && !variableName && (
        <p className="warn">⚠ No Date variable bound to this brick</p>
      )}

      {/* IS_LOCAL dev-only role preview toggle */}
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
