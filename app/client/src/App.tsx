import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { format, startOfMonth, endOfMonth, subDays, startOfYear } from 'date-fns';
import domo from 'ryuu.js';
import 'react-day-picker/style.css';
import './App.css';

// ── Constants ─────────────────────────────────────────────────────────────────
const DATASET_ALIAS = 'sampleData';
const DATE_COLUMN = 'Date';
const COLLECTION = 'nab-date-selector-settings';
const EN_DASH = '–';
const DEFAULT_SINGLE_FID = 131272;
const IS_LOCAL =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1';

// ── Types ─────────────────────────────────────────────────────────────────────
type SelectionMode = 'single' | 'between';
type ViewMode = 'calendar' | 'list';

interface StoredSettings {
  functionId?: number;
  mode?: SelectionMode;
  rangeStartFunctionId?: number;
  rangeEndFunctionId?: number;
}

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

function formatDateLabel(d: Date): string {
  return `${d.getFullYear()} ${EN_DASH} ${format(d, 'MMM')} ${EN_DASH} ${String(d.getDate()).padStart(2, '0')}`;
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

async function discoverViaPageControls(): Promise<DetectedVar[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (domo as any).env;
    const pageId = env?.pageId;
    if (!pageId) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await (domo as any).get(
      `/api/content/v1/pages/${pageId}/variable/controls/list`
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const controls: any[] = Array.isArray(data) ? data : (data?.controls ?? []);
    return controls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => {
        const fid = c?.function?.id ?? c?.functionId;
        const name = c?.function?.name ?? c?.name;
        if (typeof fid !== 'number' && !Number.isFinite(Number(fid)))
          return null;
        return { functionId: Number(fid), name } as DetectedVar;
      })
      .filter((v): v is DetectedVar => v !== null);
  } catch {
    return [];
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

const DISCOVERY_SNIPPET =
  '(async()=>{const m=location.pathname.match(/\\/pages?\\/(\\d+)/);if(!m)return console.error("not on a Domo page");const r=await fetch(`/api/content/v1/pages/${m[1]}/variable/controls/list`);const d=await r.json();const rows=(Array.isArray(d)?d:d.controls||[]).map(c=>({name:c.function?.name||c.name||"?",functionId:c.function?.id||c.functionId,dataType:c.function?.dataType||c.dataType||"?"}));console.table(rows)})()';

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
  const docIdRef = useRef<string | null>(null);
  const functionIdRef = useRef<number | null>(DEFAULT_SINGLE_FID);
  const rangeStartFidRef = useRef<number | null>(null);
  const rangeEndFidRef = useRef<number | null>(null);
  const selectionModeRef = useRef<SelectionMode>('single');

  // Settings (state for display)
  const [functionId, setFunctionId] = useState<number | null>(DEFAULT_SINGLE_FID);
  const [rangeStartFid, setRangeStartFid] = useState<number | null>(null);
  const [rangeEndFid, setRangeEndFid] = useState<number | null>(null);

  // Settings inputs
  const [inputFid, setInputFid] = useState(String(DEFAULT_SINGLE_FID));
  const [inputRangeStartFid, setInputRangeStartFid] = useState('');
  const [inputRangeEndFid, setInputRangeEndFid] = useState('');
  const [copied, setCopied] = useState(false);
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
    if (!IS_LOCAL) {
      discoverViaPageControls().then((vars) => {
        vars.forEach((v) => detectedVars.set(v.functionId, v));
        if (vars.length > 0) notifyDetected();
      });
    }
    return () => {
      detectedVarsListeners.delete(onChange);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 720px)');
    const handler = (e: MediaQueryListEvent) => setIsWide(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    (async () => {
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
    if (IS_LOCAL) {
      functionIdRef.current = DEFAULT_SINGLE_FID;
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docs = (await (domo as any).post(
        `/domo/datastores/v1/collections/${COLLECTION}/documents/query`,
        {}
      )) as { id: string; content: StoredSettings }[];
      if (docs?.length > 0) {
        const { id, content } = docs[0];
        docIdRef.current = id;
        const fid = content.functionId ?? DEFAULT_SINGLE_FID;
        const rsf = content.rangeStartFunctionId ?? null;
        const ref = content.rangeEndFunctionId ?? null;
        const mode = content.mode ?? 'single';
        functionIdRef.current = fid;
        rangeStartFidRef.current = rsf;
        rangeEndFidRef.current = ref;
        selectionModeRef.current = mode;
        setFunctionId(fid);
        setRangeStartFid(rsf);
        setRangeEndFid(ref);
        setSelectionMode(mode);
        setInputFid(String(fid));
        if (rsf) setInputRangeStartFid(String(rsf));
        if (ref) setInputRangeEndFid(String(ref));
      }
    } catch (e) {
      console.warn('[loadSettings]', e);
    }
  }

  async function persistSettings(patch: Partial<StoredSettings>, silent = false) {
    if (IS_LOCAL) return;
    try {
      const current: StoredSettings = {
        functionId: functionIdRef.current ?? undefined,
        mode: selectionModeRef.current,
        rangeStartFunctionId: rangeStartFidRef.current ?? undefined,
        rangeEndFunctionId: rangeEndFidRef.current ?? undefined,
        ...patch,
      };
      const payload = { content: current };
      if (docIdRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (domo as any).put(
          `/domo/datastores/v1/collections/${COLLECTION}/documents/${docIdRef.current}`,
          payload
        );
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = (await (domo as any).post(
          `/domo/datastores/v1/collections/${COLLECTION}/documents/`,
          payload
        )) as { id: string };
        docIdRef.current = res.id;
      }
      if (!silent) setShowSettings(false);
    } catch (e) {
      console.error('[persistSettings]', e);
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
      if (docIdRef.current && !IS_LOCAL) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (domo as any).delete(
          `/domo/datastores/v1/collections/${COLLECTION}/documents/${docIdRef.current}`
        );
      }
      docIdRef.current = null;
      functionIdRef.current = null;
      rangeStartFidRef.current = null;
      rangeEndFidRef.current = null;
      setFunctionId(null);
      setRangeStartFid(null);
      setRangeEndFid(null);
      setInputFid('');
      setInputRangeStartFid('');
      setInputRangeEndFid('');
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
    const from = formatDateLabel(rangeSelected.from);
    const to = formatDateLabel(rangeSelected.to);
    const days =
      Math.round(
        (rangeSelected.to.getTime() - rangeSelected.from.getTime()) / 86400000
      ) + 1;
    return `${from} → ${to} (${days} day${days !== 1 ? 's' : ''})`;
  }, [rangeSelected]);

  const toolbarLabel = useMemo(() => {
    if (selectionMode === 'single' && singleSelected) {
      return formatDateLabel(singleSelected);
    }
    if (selectionMode === 'between' && rangeSelected?.from && rangeSelected?.to) {
      return `${formatDateLabel(rangeSelected.from)} → ${formatDateLabel(rangeSelected.to)}`;
    }
    return '';
  }, [selectionMode, singleSelected, rangeSelected]);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleSingleSelect = useCallback(
    (date: Date | undefined) => {
      if (!date) return;
      const iso = toISO(date);
      if (!availableDates.has(iso)) return;
      setSingleSelected(date);
      if (IS_LOCAL) return;
      const fid = functionIdRef.current;
      if (fid === null) return;
      domo.requestVariablesUpdate([{ functionId: fid, value: iso }], () => {}, () => {});
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
    if (IS_LOCAL) {
      console.log('[DEV] range apply:', from, '→', to);
      return;
    }
    const startFid = rangeStartFidRef.current;
    const endFid = rangeEndFidRef.current ?? functionIdRef.current;
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

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(DISCOVERY_SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const el = document.querySelector('.settings-snippet');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

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
    <div className="app">
      {/* ── Toolbar ── */}
      <div className="toolbar">
        {toolbarLabel && !showSettings && (
          <span className="selected-display" title={toolbarLabel}>
            {toolbarLabel}
          </span>
        )}
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

      {/* ── Settings panel ── */}
      {showSettings && (
        <div className="settings-panel">
          <label className="settings-label">Variable Configuration</label>

          {detected.length > 0 && (
            <div className="settings-detected">
              <p className="settings-hint">
                Detected on this page (click to use as single-date variable):
              </p>
              {detected.map((v) => (
                <button
                  key={v.functionId}
                  className="settings-detected-btn"
                  onClick={() => {
                    applyFunctionId(v.functionId);
                    persistSettings({ functionId: v.functionId }, true);
                  }}
                >
                  {v.name || `Variable ${v.functionId}`}{' '}
                  <span className="settings-fid">({v.functionId})</span>
                </button>
              ))}
            </div>
          )}

          <div className="settings-snippet-block">
            <p className="settings-hint">
              Discover variable IDs — run in browser console on the Domo page:
            </p>
            <div className="settings-snippet-row">
              <code className="settings-snippet">{DISCOVERY_SNIPPET}</code>
              <button className="settings-copy" onClick={copySnippet}>
                {copied ? '✓' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="settings-group">
            <label className="settings-sublabel">Single date variable ID</label>
            <input
              className="settings-input"
              type="number"
              placeholder="e.g. 131272"
              value={inputFid}
              onChange={(e) => setInputFid(e.target.value)}
            />
          </div>

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

          <div className="settings-actions">
            <button className="settings-save" onClick={saveSettingsFromForm}>
              Save
            </button>
            <button className="settings-reset" onClick={resetSettings}>
              Reset
            </button>
          </div>

          {(functionId ?? rangeStartFid ?? rangeEndFid) !== null && (
            <p className="settings-saved">
              Active: single={functionId ?? 'none'}, start={rangeStartFid ?? 'none'}, end=
              {rangeEndFid ?? 'none'}
              {autoDetected && <span className="settings-auto"> (auto-detected)</span>}
            </p>
          )}
        </div>
      )}

      {/* ── Main calendar area ── */}
      {!showSettings && (
        <>
          {/* Selection mode toggle */}
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

          {/* List / dropdown — single mode only */}
          {selectionMode === 'single' && viewMode === 'list' && (
            <div className="text-mode">
              <select
                className="date-select"
                value={singleSelected ? toISO(singleSelected) : ''}
                onChange={(e) => {
                  if (e.target.value) handleSingleSelect(isoToDate(e.target.value));
                }}
              >
                <option value="">— select a date —</option>
                {sortedDates.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Calendar */}
          {viewMode === 'calendar' && (
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

      {/* Single-mode warning only — between mode shows inline warn above Apply */}
      {!showSettings && selectionMode === 'single' && !functionId && (
        <p className="warn">⚠ No Date variable bound to this brick</p>
      )}
    </div>
  );
}
