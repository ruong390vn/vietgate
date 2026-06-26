import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';

const GATE_MODES = [
  { id: 'dor', label: 'Chỉ DOR', desc: 'Definition of Ready' },
  { id: 'dod', label: 'Chỉ DOD', desc: 'Definition of Done' },
  { id: 'both', label: 'Cả hai', desc: 'DOR + DOD' },
];

const emptyItem = () => ({ id: `item-${Date.now()}`, text: '', isRequired: false });

const emptyConfig = () => ({
  configId: '',
  issueType: '',
  issueTypeId: '',
  gateMode: 'both',
  dor: { blockOnTransitionTo: 'In Progress', items: [emptyItem()] },
  dod: { blockOnTransitionTo: 'Done', items: [emptyItem()] },
});

function ItemEditor({ items, onChange, gateLabel }) {
  const update = (index, field, value) => {
    onChange(items.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
  };

  return (
    <div>
      {items.map((item, index) => (
        <div key={item.id || index} className="vg-item-row">
          <input
            type="text"
            className="vg-input"
            placeholder={`${gateLabel} item ${index + 1}`}
            value={item.text}
            onChange={(e) => update(index, 'text', e.target.value)}
          />
          <input
            type="checkbox"
            checked={item.isRequired === true}
            onChange={(e) => update(index, 'isRequired', e.target.checked)}
          />
          <label>Required</label>
          {items.length > 1 && (
            <button
              className="vg-btn vg-btn--danger vg-btn--sm"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >×</button>
          )}
        </div>
      ))}
      <button
        className="vg-btn vg-btn--ghost vg-btn--sm"
        style={{ marginTop: 8 }}
        onClick={() => onChange([...items, emptyItem()])}
      >+ Thêm item</button>
    </div>
  );
}

export default function App() {
  const [configs, setConfigs] = useState([]);
  const [project, setProject] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [issueTypes, setIssueTypes] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(emptyConfig());

  // Document review templates (link tài liệu theo Issue Type + Status).
  const [docTemplates, setDocTemplates] = useState([]);
  const [tplForm, setTplForm] = useState({
    issueType: '',
    issueTypeId: '',
    status: '',
  });
  // Nhiều "ô tài liệu" (slot) cùng khai báo cho 1 Issue Type + Status.
  // Slot chỉ là YÊU CẦU tài liệu (tên + bắt buộc) — USER tự nộp link trên issue.
  const emptyLinkRow = () => ({ title: '', required: false });
  const [tplLinks, setTplLinks] = useState([emptyLinkRow()]);
  const [tplStatuses, setTplStatuses] = useState([]);
  const [tplSaving, setTplSaving] = useState(false);

  const load = useCallback(async () => {
    const [settings, types, tpls] = await Promise.all([
      invoke('getProjectConfigs'),
      invoke('getProjectIssueTypes'),
      invoke('docTemplate.list'),
    ]);
    setConfigs(settings.configs || []);
    setProject(settings.project || null);
    setEnabled(Boolean(settings.enabled));
    setIssueTypes(types.issueTypes || []);
    setDocTemplates(tpls.templates || []);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (draft.issueTypeId) {
      invoke('getProjectStatuses', { issueTypeId: draft.issueTypeId }).then((r) =>
        setStatuses(r.statuses || [])
      );
    }
  }, [draft.issueTypeId]);

  useEffect(() => {
    if (tplForm.issueTypeId) {
      invoke('getProjectStatuses', { issueTypeId: tplForm.issueTypeId }).then((r) =>
        setTplStatuses(r.statuses || [])
      );
    } else {
      setTplStatuses([]);
    }
  }, [tplForm.issueTypeId]);

  const updateLinkRow = (idx, patch) => {
    setTplLinks((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const addLinkRow = () => setTplLinks((rows) => [...rows, emptyLinkRow()]);
  const removeLinkRow = (idx) =>
    setTplLinks((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== idx) : rows));

  const saveTemplate = async () => {
    setTplSaving(true);
    setError('');
    setSuccess('');
    try {
      const links = tplLinks
        .filter((r) => r.title.trim())
        .map((r) => ({ title: r.title, required: r.required }));
      const res = await invoke('docTemplate.saveMany', {
        issueType: tplForm.issueType,
        status: tplForm.status,
        links,
      });
      setDocTemplates(res.templates || []);
      setTplLinks([emptyLinkRow()]);
      setSuccess(`Đã thêm ${res.added || links.length} ô tài liệu.`);
    } catch (e) {
      setError(e.message || 'Không thể lưu tài liệu.');
    } finally {
      setTplSaving(false);
    }
  };

  const removeTemplate = async (id) => {
    if (!window.confirm('Xóa ô tài liệu này?')) return;
    try {
      const res = await invoke('docTemplate.delete', { id });
      setDocTemplates(res.templates || []);
      setSuccess('Đã xóa ô tài liệu.');
    } catch (e) {
      setError(e.message || 'Không thể xóa tài liệu.');
    }
  };

  const toggleProject = async () => {
    setToggling(true);
    setError('');
    setSuccess('');
    try {
      const result = await invoke('setProjectEnabled', { enabled: !enabled });
      setEnabled(Boolean(result.meta?.enabled));
      setProject(result.project || project);
      setSuccess(result.meta?.enabled ? 'Đã bật VietGate cho project.' : 'Đã tắt VietGate cho project.');
    } catch (e) {
      setError(e.message || 'Không thể cập nhật trạng thái project.');
    } finally {
      setToggling(false);
    }
  };

  const openCreate = () => {
    setDraft(emptyConfig());
    setModalOpen(true);
    setError('');
    setSuccess('');
  };

  const openEdit = (cfg) => {
    const matched = issueTypes.find((t) => t.name === cfg.issueType);
    setDraft({
      ...cfg,
      issueTypeId: matched?.id || '',
      dor: { ...cfg.dor, items: cfg.dor.items.map((i) => ({ ...i })) },
      dod: { ...cfg.dod, items: cfg.dod.items.map((i) => ({ ...i })) },
    });
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await invoke('saveProjectConfig', { config: draft });
      setSuccess('Đã lưu cấu hình!');
      setModalOpen(false);
      await load();
    } catch (e) {
      setError(e.message || 'Lỗi khi lưu.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (configId) => {
    if (!window.confirm('Xóa cấu hình này?')) return;
    await invoke('deleteProjectConfig', { configId });
    setSuccess('Đã xóa.');
    await load();
  };

  const showDor = draft.gateMode === 'dor' || draft.gateMode === 'both';
  const showDod = draft.gateMode === 'dod' || draft.gateMode === 'both';

  if (loading) {
    return (
      <div className="vg-loading">
        <div className="vg-spinner" />
        <span>Đang tải cấu hình DOR/DOD…</span>
      </div>
    );
  }

  const modeLabel = { dor: 'DOR only', dod: 'DOD only', both: 'DOR + DOD' };
  const projectLabel = project ? `${project.name} (${project.key})` : 'Project hiện tại';

  return (
    <div className="vg-app">
      <div className="vg-hero">
        <div className="vg-brand">vietgate</div>
        <h1>DOR / DOD Configuration</h1>
        <p>
          Bật VietGate cho project, cấu hình DOR/DOD theo Issue Type.
          Checklist hiện trong <strong>Description</strong> khi issue đúng status đã chọn.
        </p>
      </div>

      <div className="vg-project-card">
        <div className="vg-project-info">
          <div className="vg-project-label">Project</div>
          <div className="vg-project-name">{projectLabel}</div>
          <div className="vg-project-hint">
            {enabled
              ? 'DOR/DOD đang hoạt động — checklist inject vào Description.'
              : 'Bật project để kích hoạt checklist trong Description.'}
          </div>
        </div>
        <label className="vg-toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={toggling}
            onChange={toggleProject}
          />
          <span className="vg-toggle-track" />
          <span className="vg-toggle-text">{enabled ? 'Đã bật' : 'Đang tắt'}</span>
        </label>
      </div>

      {error && !modalOpen && <div className="vg-alert vg-alert--error">{error}</div>}
      {success && <div className="vg-alert vg-alert--success">{success}</div>}

      {enabled && (
        <>
          <div className="vg-toolbar">
            <div>
              <div className="vg-toolbar-title">Cấu hình Issue Type</div>
              <div className="vg-toolbar-sub">
                Có thể tạo nhiều cấu hình cho cùng Issue Type — mỗi status chỉ được dùng một lần.
                Để hiện popup nhắc khi chuyển status, thêm validator &quot;VietGate DOR/DOD Checklist&quot; vào workflow.
              </div>
            </div>
            <button className="vg-btn vg-btn--primary" onClick={openCreate}>
              Thêm cấu hình
            </button>
          </div>

          {configs.length === 0 ? (
            <div className="vg-empty">
              <h3>Chưa có cấu hình Issue Type</h3>
              <p>Nhấn &quot;Thêm cấu hình&quot; để tạo DOR/DOD cho từng Issue Type.</p>
            </div>
          ) : (
            configs.map((cfg) => (
              <div key={cfg.configId} className="vg-config-card">
                <div className="vg-config-head">
                  <div>
                    <div className="vg-config-type">{cfg.issueType}</div>
                    <span className="vg-mode-badge">{modeLabel[cfg.gateMode] || cfg.gateMode}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="vg-btn vg-btn--primary vg-btn--sm" onClick={() => openEdit(cfg)}>Sửa</button>
                    <button className="vg-btn vg-btn--danger vg-btn--sm" onClick={() => remove(cfg.configId)}>Xóa</button>
                  </div>
                </div>
                <div className="vg-gate-preview">
                  {(cfg.gateMode === 'dor' || cfg.gateMode === 'both') &&
                    cfg.dor?.items?.length > 0 && (
                    <div className="vg-gate-box vg-gate-box--dor">
                      <div className="vg-gate-box-title">DOR @ {cfg.dor.blockOnTransitionTo}</div>
                      <div className="vg-gate-box-meta">{cfg.dor.items.length} items</div>
                      {cfg.dor.items.slice(0, 3).map((it) => (
                        <span key={it.id} className="vg-item-chip">{it.text}</span>
                      ))}
                    </div>
                  )}
                  {(cfg.gateMode === 'dod' || cfg.gateMode === 'both') &&
                    cfg.dod?.items?.length > 0 && (
                    <div className="vg-gate-box vg-gate-box--dod">
                      <div className="vg-gate-box-title">DOD @ {cfg.dod.blockOnTransitionTo}</div>
                      <div className="vg-gate-box-meta">{cfg.dod.items.length} items</div>
                      {cfg.dod.items.slice(0, 3).map((it) => (
                        <span key={it.id} className="vg-item-chip">{it.text}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          <div className="vg-toolbar" style={{ marginTop: 28 }}>
            <div>
              <div className="vg-toolbar-title">Tài liệu cần nộp theo Status</div>
              <div className="vg-toolbar-sub">
                Khai báo các tài liệu CẦN NỘP (chỉ đặt tên, không cần link). Khi issue ở đúng
                Issue Type + Status, field &quot;Document Review&quot; sẽ hiện ô để user dán link
                rồi giao reviewer duyệt. Đánh dấu &quot;Bắt buộc&quot; để chặn chuyển status nếu
                chưa nộp/chưa duyệt.
              </div>
            </div>
          </div>

          <div className="vg-config-card">
            <div className="vg-form-group">
              <label>Issue Type</label>
              <select
                className="vg-select"
                value={tplForm.issueType}
                onChange={(e) => {
                  const matched = issueTypes.find((t) => t.name === e.target.value);
                  setTplForm((p) => ({
                    ...p,
                    issueType: e.target.value,
                    issueTypeId: matched?.id || '',
                    status: '',
                  }));
                }}
              >
                <option value="">— Chọn —</option>
                {issueTypes.map((t) => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
            </div>

            <div className="vg-form-group">
              <label>Hiển thị để nộp/duyệt khi status là</label>
              <select
                className="vg-select"
                value={tplForm.status}
                disabled={!tplForm.issueTypeId}
                onChange={(e) => setTplForm((p) => ({ ...p, status: e.target.value }))}
              >
                <option value="">— Chọn —</option>
                {tplStatuses.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="vg-form-group">
              <label>Danh sách tài liệu cần nộp</label>
              {tplLinks.map((row, idx) => (
                <div
                  key={idx}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className="vg-input"
                      placeholder="Tên tài liệu — ví dụ: URD, Test Plan, Tài liệu thiết kế API"
                      value={row.title}
                      onChange={(e) => updateLinkRow(idx, { title: e.target.value })}
                      style={{ flex: 1, marginBottom: 0 }}
                    />
                    {tplLinks.length > 1 && (
                      <button
                        className="vg-btn vg-btn--danger vg-btn--sm"
                        onClick={() => removeLinkRow(idx)}
                        title="Xoá dòng này"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      marginTop: 8,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={row.required}
                      onChange={(e) => updateLinkRow(idx, { required: e.target.checked })}
                    />
                    Bắt buộc (chặn chuyển status nếu chưa nộp / chưa duyệt)
                  </label>
                </div>
              ))}
              <button className="vg-btn vg-btn--ghost vg-btn--sm" onClick={addLinkRow}>
                + Thêm tài liệu
              </button>
            </div>

            <button
              className="vg-btn vg-btn--primary"
              onClick={saveTemplate}
              disabled={
                tplSaving ||
                !tplForm.issueType ||
                !tplForm.status ||
                !tplLinks.some((r) => r.title.trim())
              }
            >
              {tplSaving ? 'Đang lưu…' : '+ Lưu danh sách tài liệu'}
            </button>
          </div>

          {docTemplates.length > 0 && (
            <div className="vg-config-card">
              <div className="vg-config-type" style={{ marginBottom: 12 }}>
                Danh sách tài liệu đã cấu hình ({docTemplates.length})
              </div>
              {docTemplates.map((tpl) => (
                <div key={tpl.id} className="vg-item-row">
                  <span className="vg-mode-badge">{tpl.issueType}</span>
                  <span className="vg-mode-badge">@ {tpl.status}</span>
                  {tpl.required && (
                    <span className="vg-mode-badge" style={{ background: '#fee2e2', color: '#991b1b' }}>
                      Bắt buộc
                    </span>
                  )}
                  <span className="vg-item-chip">{tpl.title || '(chưa đặt tên)'}</span>
                  <button
                    className="vg-btn vg-btn--danger vg-btn--sm"
                    onClick={() => removeTemplate(tpl.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {modalOpen && (
        <div className="vg-overlay" onClick={() => setModalOpen(false)}>
          <div className="vg-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vg-modal-head">
              <h2>{draft.configId ? 'Chỉnh sửa' : 'Tạo mới'} — DOR / DOD</h2>
            </div>
            <div className="vg-modal-body">
              {error && <div className="vg-alert vg-alert--error">{error}</div>}

              <div className="vg-form-group">
                <label>Issue Type</label>
                <select
                  className="vg-select"
                  value={draft.issueType}
                  onChange={(e) => {
                    const matched = issueTypes.find((t) => t.name === e.target.value);
                    setDraft((p) => ({
                      ...p,
                      issueType: e.target.value,
                      issueTypeId: matched?.id || '',
                    }));
                  }}
                >
                  <option value="">— Chọn —</option>
                  {issueTypes.map((t) => (
                    <option key={t.id} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div className="vg-form-group">
                <label>Gate Mode</label>
                <div className="vg-mode-picker">
                  {GATE_MODES.map((m) => (
                    <button
                      key={m.id}
                      className={`vg-mode-btn ${draft.gateMode === m.id ? 'vg-mode-btn--active' : ''}`}
                      onClick={() => setDraft((p) => ({ ...p, gateMode: m.id }))}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {showDor && (
                <div className="vg-section vg-section--dor">
                  <div className="vg-section-title">Definition of Ready (DOR)</div>
                  <div className="vg-form-group">
                    <label>Hiện checklist khi status là</label>
                    <select
                      className="vg-select"
                      value={draft.dor.blockOnTransitionTo}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, dor: { ...p.dor, blockOnTransitionTo: e.target.value } }))
                      }
                    >
                      {statuses.map((s) => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <ItemEditor
                    gateLabel="DOR"
                    items={draft.dor.items}
                    onChange={(items) => setDraft((p) => ({ ...p, dor: { ...p.dor, items } }))}
                  />
                </div>
              )}

              {showDod && (
                <div className="vg-section vg-section--dod">
                  <div className="vg-section-title">Definition of Done (DOD)</div>
                  <div className="vg-form-group">
                    <label>Hiện checklist khi status là</label>
                    <select
                      className="vg-select"
                      value={draft.dod.blockOnTransitionTo}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, dod: { ...p.dod, blockOnTransitionTo: e.target.value } }))
                      }
                    >
                      {statuses.map((s) => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <ItemEditor
                    gateLabel="DOD"
                    items={draft.dod.items}
                    onChange={(items) => setDraft((p) => ({ ...p, dod: { ...p.dod, items } }))}
                  />
                </div>
              )}
            </div>
            <div className="vg-modal-foot">
              <button className="vg-btn vg-btn--ghost" onClick={() => setModalOpen(false)}>Hủy</button>
              <button className="vg-btn vg-btn--primary" onClick={save} disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
