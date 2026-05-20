import { useEffect, useState, useRef, useCallback } from 'react';
import domo from 'ryuu.js';
import './App.css';

const DATASET_ALIAS = 'sampleData';
const DATE_COLUMN = 'Date';
const COLLECTION = 'nab-date-selector-settings';

const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const SHORT_MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const EN_DASH = '–';

async function fetchLocalDates(): Promise<string[]> {
  const res = await fetch('/sample-data.csv');
  const text = await res.text();
  const lines = text.trim().split('\n');
  const header = lines[0].split(',').map(h => h.trim());
  const dateIdx = header.indexOf('Date');
  if (dateIdx === -1) throw new Error('No Date column in sample-data.csv');
  const seen = new Set<string>();
  lines.slice(1).forEach(line => {
    const val = line.split(',')[dateIdx]?.trim();
    if (val) seen.add(val);
  });
  return Array.from(seen).sort();
}

function formatYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatYearMonthLabel(year: number, monthIndex: number): string {
  return `${year} ${EN_DASH} ${SHORT_MONTH_NAMES[monthIndex]}`;
}

function formatIsoToYearMonth(iso: string): string {
  if (!iso) return '';
  const [y, m] = iso.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return iso;
  return formatYearMonthLabel(y, m - 1);
}

type DetectedVar = { functionId: number; name?: string; value?: unknown };

// Try GET /api/content/v1/pages/{pageId}/variable/controls/list — the page-level
// variable-controls endpoint. Currently 404s through the brick proxy, but kept
// in case Domo whitelists it. Per App Platform Teams channel guidance.
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
        if (typeof fid !== 'number' && !Number.isFinite(Number(fid))) return null;
        return { functionId: Number(fid), name } as DetectedVar;
      })
      .filter((v): v is DetectedVar => v !== null);
  } catch {
    return [];
  }
}

// Module-level capture of any variables Domo emits to the brick.
// Logged eagerly so the UI can offer them as click-to-use options.
const detectedVars = new Map<number, DetectedVar>();
const detectedVarsListeners = new Set<() => void>();

function notifyDetected() { detectedVarsListeners.forEach(fn => { try { fn(); } catch { /* ignore */ } }); }

let listenerRegistered = false;
function registerVariablesListener() {
  if (listenerRegistered) return;
  listenerRegistered = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (domo as any).onVariablesUpdated((vars: any) => {
      console.log('[onVariablesUpdated]', vars);
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
        vars.forEach(v => ingest(v?.functionId, v?.name, v?.value));
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

const CalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5zM1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4H1z"/>
  </svg>
);

const ListIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"/>
  </svg>
);

const GearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
    <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/>
  </svg>
);

export default function App() {
  const restored = (() => {
    try {
      const sel = sessionStorage.getItem('nab-cal-selected') || '';
      const datesRaw = sessionStorage.getItem('nab-cal-dates');
      const dates: string[] = datesRaw ? JSON.parse(datesRaw) : [];
      return { sel, dates };
    } catch { return { sel: '', dates: [] }; }
  })();
  const restoredDate = restored.sel ? restored.sel.split('-').map(Number) : null;
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set(restored.dates));
  const [sortedDates, setSortedDates] = useState<string[]>(restored.dates);
  const [selected, setSelected] = useState<string>(restored.sel);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(restored.dates.length > 0 ? 'ready' : 'loading');
  const [error, setError] = useState<string>('');
  const [viewYear, setViewYear] = useState(restoredDate ? restoredDate[0] : new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(restoredDate ? restoredDate[1] - 1 : new Date().getMonth());
  const [mode, setMode] = useState<'calendar' | 'text'>('calendar');
  const [showSettings, setShowSettings] = useState(false);
  const [inputFunctionId, setInputFunctionId] = useState('');
  const [hasVariable, setHasVariable] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const [detected, setDetected] = useState<DetectedVar[]>([]);
  const [copied, setCopied] = useState(false);
  const isWritingVar = useRef(false);
  const docIdRef = useRef<string | null>(null);
  const functionIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!IS_LOCAL) registerVariablesListener();
    const onChange = () => setDetected(Array.from(detectedVars.values()));
    detectedVarsListeners.add(onChange);
    onChange();
    // Also try the page controls endpoint (the right one per App Platform team)
    if (!IS_LOCAL) {
      discoverViaPageControls().then(vars => {
        vars.forEach(v => detectedVars.set(v.functionId, v));
        if (vars.length > 0) notifyDetected();
      });
    }
    return () => { detectedVarsListeners.delete(onChange); };
  }, []);

  // Auto-adopt: if no functionId saved AND listener captures one, save it
  useEffect(() => {
    if (functionIdRef.current !== null) return;
    if (detected.length === 0) return;
    const first = detected.find(v => typeof v.value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(String(v.value)))
      ?? detected[0];
    if (!first) return;
    functionIdRef.current = first.functionId;
    setInputFunctionId(String(first.functionId));
    setHasVariable(true);
    setAutoDetected(true);
    saveSettings(first.functionId, true);
  }, [detected]);

  useEffect(() => {
    (async () => {
      await loadSettings();
      await fetchDates(true);
    })();
  }, []);

  async function loadSettings() {
    if (IS_LOCAL) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docs = await (domo as any).post(
        `/domo/datastores/v1/collections/${COLLECTION}/documents/query`,
        {}
      ) as { id: string; content: { functionId: number } }[];
      if (docs?.length > 0) {
        const { id, content } = docs[0];
        docIdRef.current = id;
        functionIdRef.current = content.functionId;
        setInputFunctionId(String(content.functionId));
        setHasVariable(true);
      }
    } catch (e) {
      console.warn('[loadSettings]', e);
    }
  }

  async function saveSettings(fid: number, silent = false) {
    try {
      const payload = { content: { functionId: fid } };
      if (docIdRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (domo as any).put(
          `/domo/datastores/v1/collections/${COLLECTION}/documents/${docIdRef.current}`,
          payload
        );
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (domo as any).post(
          `/domo/datastores/v1/collections/${COLLECTION}/documents/`,
          payload
        ) as { id: string };
        docIdRef.current = res.id;
      }
      functionIdRef.current = fid;
      setHasVariable(true);
      if (!silent) {
        setAutoDetected(false);
        setShowSettings(false);
      }
    } catch (e) {
      console.error('[saveSettings]', e);
    }
  }

  async function resetSettings() {
    try {
      if (docIdRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (domo as any).delete(
          `/domo/datastores/v1/collections/${COLLECTION}/documents/${docIdRef.current}`
        );
      }
      docIdRef.current = null;
      functionIdRef.current = null;
      setHasVariable(false);
      setAutoDetected(false);
      setInputFunctionId('');
      detectedVars.clear();
      notifyDetected();
    } catch (e) {
      console.error('[resetSettings]', e);
    }
  }

  function adoptDetected(v: DetectedVar) {
    functionIdRef.current = v.functionId;
    setInputFunctionId(String(v.functionId));
    setHasVariable(true);
    setAutoDetected(true);
    saveSettings(v.functionId, true);
  }

  const DISCOVERY_SNIPPET = '(async()=>{const m=location.pathname.match(/\\/pages?\\/(\\d+)/);if(!m)return console.error("not on a Domo page");const r=await fetch(`/api/content/v1/pages/${m[1]}/variable/controls/list`);const d=await r.json();const rows=(Array.isArray(d)?d:d.controls||[]).map(c=>({name:c.function?.name||c.name||"?",functionId:c.function?.id||c.functionId,dataType:c.function?.dataType||c.dataType||"?"}));console.table(rows)})()';

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(DISCOVERY_SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select text in the code element
      const el = document.querySelector('.settings-hint code');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  async function fetchDates(initial = false) {
    if (initial && availableDates.size === 0) setStatus('loading');
    try {
      let values: string[];
      if (IS_LOCAL) {
        values = await fetchLocalDates();
      } else {
        // Use raw data/v1 endpoint with SQL grouping (matches inspiration code pattern)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = await (domo as any).get(
          `/data/v1/${DATASET_ALIAS}?fields=${DATE_COLUMN}`
        ) as Record<string, string>[];
        const seen = new Set<string>();
        rows.forEach(r => { if (r[DATE_COLUMN]) seen.add(r[DATE_COLUMN]); });
        values = Array.from(seen).sort();
      }
      setAvailableDates(new Set(values));
      setSortedDates(values);
      try { sessionStorage.setItem('nab-cal-dates', JSON.stringify(values)); } catch { /* ignore */ }
      setStatus('ready');
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err) {
        const xhr = err as XMLHttpRequest;
        setError(`HTTP ${xhr.status} — ${xhr.responseText || 'no response body'}`);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setStatus('error');
    }
  }

  const selectDate = useCallback((dateStr: string) => {
    if (!availableDates.has(dateStr)) return;
    setSelected(dateStr);
    try { sessionStorage.setItem('nab-cal-selected', dateStr); } catch { /* ignore */ }
    const [y, m] = dateStr.split('-').map(Number);
    setViewYear(y);
    setViewMonth(m - 1);
    if (!dateStr || functionIdRef.current === null) return;
    isWritingVar.current = true;
    domo.requestVariablesUpdate(
      [{ functionId: functionIdRef.current, value: dateStr }],
      () => {},
      () => { setTimeout(() => { isWritingVar.current = false; }, 3000); }
    );
  }, [availableDates]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  if (status === 'loading') return <div className="state-msg"><div className="spinner" /><span>Loading…</span></div>;
  if (status === 'error') return <div className="state-msg error">Failed to load dates: {error}</div>;

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const todayStr = formatYMD(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  return (
    <div className="app">
      <div className="toolbar">
        {/* display-only: variable payload stays ISO YYYY-MM-DD */}
        {selected && !showSettings && <span className="selected-display" title={selected}>{formatIsoToYearMonth(selected)}</span>}
        <div className="toggle-group">
          <button
            className={`toggle-btn ${mode === 'text' ? 'active' : ''}`}
            onClick={() => { setShowSettings(false); setMode('text'); }}
            title="Dropdown view"
          >
            <ListIcon />
          </button>
          <button
            className={`toggle-btn ${mode === 'calendar' ? 'active' : ''}`}
            onClick={() => { setShowSettings(false); setMode('calendar'); }}
            title="Calendar view"
          >
            <CalIcon />
          </button>
          <button
            className={`toggle-btn ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings(s => !s)}
            title="Settings"
          >
            <GearIcon />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="settings-panel">
          <label className="settings-label">Variable Function ID</label>
          {detected.length > 0 && (
            <div className="settings-detected">
              <p className="settings-hint">Detected on this page:</p>
              {detected.map(v => (
                <button
                  key={v.functionId}
                  className="settings-detected-btn"
                  onClick={() => adoptDetected(v)}
                  title={`functionId: ${v.functionId}`}
                >
                  {v.name || `Variable ${v.functionId}`} <span className="settings-fid">({v.functionId})</span>
                </button>
              ))}
            </div>
          )}
          <div className="settings-snippet-block">
            <p className="settings-hint">
              Or enter manually. Run in browser console (main page). Prints a table of variable names + IDs:
            </p>
            <div className="settings-snippet-row">
              <code className="settings-snippet">{DISCOVERY_SNIPPET}</code>
              <button className="settings-copy" onClick={copySnippet} title="Copy snippet">
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <input
              className="settings-input"
              type="number"
              placeholder="e.g. 131272"
              value={inputFunctionId}
              onChange={e => setInputFunctionId(e.target.value)}
            />
            <button
              className="settings-save"
              onClick={() => {
                const fid = parseInt(inputFunctionId, 10);
                if (!isNaN(fid)) saveSettings(fid);
              }}
            >
              Save
            </button>
          </div>
          {hasVariable && (
            <p className="settings-saved">
              Active: {inputFunctionId}
              {autoDetected && <span className="settings-auto"> (auto-detected)</span>}
            </p>
          )}
          <button className="settings-reset" onClick={resetSettings}>Reset & re-detect</button>
        </div>
      )}

      {!showSettings && mode === 'text' && (
        <div className="text-mode">
          <select
            className="date-select"
            value={selected}
            onChange={e => selectDate(e.target.value)}
          >
            <option value="">— select a date —</option>
            {sortedDates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      )}

      {!showSettings && mode === 'calendar' && (
        <div className="calendar">
          <div className="cal-header">
            <button className="nav-btn" onClick={prevMonth}>‹</button>
            <span className="month-label">{formatYearMonthLabel(viewYear, viewMonth)}</span>
            <button className="nav-btn" onClick={nextMonth}>›</button>
          </div>

          <div className="day-names">
            {DAY_NAMES.map(d => <div key={d} className="day-name">{d}</div>)}
          </div>

          <div className="days-grid">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`e${i}`} className="day empty" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = formatYMD(viewYear, viewMonth, day);
              const hasData = availableDates.has(dateStr);
              const isSelected = selected === dateStr;
              const isToday = dateStr === todayStr;
              return (
                <div
                  key={dateStr}
                  className={['day', hasData ? 'has-data' : 'no-data', isSelected ? 'selected' : '', isToday && !isSelected ? 'today' : ''].filter(Boolean).join(' ')}
                  onClick={() => selectDate(dateStr)}
                  title={hasData ? dateStr : 'No data'}
                >
                  {day}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!hasVariable && !showSettings && (
        <p className="warn">⚙ Open settings to configure variable</p>
      )}
    </div>
  );
}
