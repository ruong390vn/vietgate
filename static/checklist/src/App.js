import React, { useCallback, useEffect, useState } from 'react';
import { events, invoke } from '@forge/bridge';

function GateSection({ type, gate, onToggle, busy }) {
  if (!gate) return null;

  return (
    <div className={`vg-gate vg-gate--${type}`}>
      <div className="vg-gate-head">
        <div>
          <div className="vg-gate-title">
            <div className="vg-gate-icon">{type === 'dor' ? 'R' : 'D'}</div>
            {gate.label}
          </div>
          <div className="vg-gate-meta">
            Gate khi chuyển → <strong>{gate.blockOnTransitionTo}</strong>
          </div>
        </div>
        <div className="vg-gate-progress">
          <div className="vg-gate-pct">{gate.progress}%</div>
          <div className="vg-gate-pct-label">hoàn thành</div>
        </div>
      </div>
      <div className="vg-gate-bar">
        <div className="vg-gate-bar-fill" style={{ width: `${gate.progress}%` }} />
      </div>
      <div className="vg-items">
        {gate.items.map((item) => (
          <div
            key={item.id}
            className={`vg-item ${item.isChecked ? 'vg-item--done' : ''}`}
            onClick={() => !busy && onToggle(type, item)}
          >
            <div className="vg-checkbox">{item.isChecked ? '✓' : ''}</div>
            <span className="vg-item-text">{item.text}</span>
            {item.isRequired && <span className="vg-required">Required</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState({ shouldRender: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await invoke('getEngineChecklist');
      setData(result);
      setError('');
    } catch (e) {
      setError('Không thể tải checklist.');
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
    const sub = events.on('JIRA_ISSUE_CHANGED', () => setTimeout(load, 800));
    return () => { sub.then((s) => s.unsubscribe()); };
  }, [load]);

  const handleToggle = async (gateType, item) => {
    setBusy(true);
    try {
      const result = await invoke('toggleChecklistItem', {
        gateType,
        itemId: item.id,
        isChecked: !item.isChecked,
      });
      if (result.payload) setData(result.payload);
      setError('');
    } catch (e) {
      setError(e.message || 'Không thể cập nhật.');
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="vg-loading">
        <div className="vg-spinner" />
        <span>Đang tải DOR / DOD…</span>
      </div>
    );
  }

  if (!data.shouldRender) return null;

  return (
    <div className="vg-app">
      <div className="vg-header">
        <div className="vg-header-top">
          <div>
            <div className="vg-brand">vietgate</div>
            <h1>DOR / DOD Checklists</h1>
            <div className="vg-header-sub">Definition of Ready & Done</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {data.issueType && <span className="vg-issue-type">{data.issueType}</span>}
            <button className="vg-btn-refresh" onClick={load} disabled={busy}>↻</button>
          </div>
        </div>
        <div className="vg-overall">
          <div className="vg-overall-label">
            <span>Tiến độ tổng</span>
            <span><strong>{data.progress}%</strong></span>
          </div>
          <div className="vg-overall-bar">
            <div className="vg-overall-fill" style={{ width: `${data.progress}%` }} />
          </div>
        </div>
      </div>

      {data.isOrphaned && (
        <div className="vg-alert vg-alert--warn">
          <strong>Orphaned</strong> — Config đã thay đổi, checklist chạy theo snapshot cũ.
        </div>
      )}
      {error && <div className="vg-alert vg-alert--error">{error}</div>}

      <GateSection type="dor" gate={data.dor} onToggle={handleToggle} busy={busy} />
      <GateSection type="dod" gate={data.dod} onToggle={handleToggle} busy={busy} />

      <div className="vg-desc-note">
        ✓ Tick tại đây hoặc trực tiếp trong trường <strong>Description</strong> trên màn hình issue
      </div>
    </div>
  );
}
