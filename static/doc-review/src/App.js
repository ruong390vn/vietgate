/**
 * VietGate — Document Review (Custom UI).
 * Hiển thị link tài liệu theo Issue Type + Status, giao reviewer và duyệt/từ chối.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { events, invoke, view } from '@forge/bridge';

const STATUS_META = {
  pending: { label: 'Chưa review', cls: 'vg-badge--default' },
  in_review: { label: 'Đang review', cls: 'vg-badge--progress' },
  approved: { label: 'Đã duyệt', cls: 'vg-badge--success' },
  rejected: { label: 'Từ chối – cần làm lại', cls: 'vg-badge--danger' },
};

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.pending;
}

/**
 * Tìm user Jira để giao reviewer.
 * - Preload sẵn danh sách user khi mở (query rỗng) để user có thể chọn ngay.
 * - Gõ để lọc; mọi truy vấn đi qua resolver backend (docReview.searchUsers)
 *   nên ổn định trong ngữ cảnh custom field edit.
 */
function UserSearch({ value, onSelect, placeholder }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Tải user theo query (debounce). query rỗng => preload danh sách mặc định.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await invoke('docReview.searchUsers', {
          query,
          maxResults: query ? 10 : 20,
        });
        if (!cancelled) {
          setSuggestions(Array.isArray(res?.users) ? res.users : []);
        }
      } catch {
        if (!cancelled) {
          setSuggestions([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, query ? 300 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const handlePick = (user) => {
    onSelect(user.accountId);
    setSelectedLabel(user.displayName || user.accountId);
    setQuery('');
    setOpen(false);
  };

  return (
    <div>
      {selectedLabel || value ? (
        <div className="vg-card-meta" style={{ marginBottom: 4 }}>
          Đã chọn: <strong>{selectedLabel || value}</strong>
        </div>
      ) : null}
      <input
        className="vg-input"
        type="text"
        placeholder={placeholder || 'Gõ tên / email để tìm, hoặc chọn từ danh sách…'}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {open ? (
        <div className="vg-user-suggest">
          {loading ? (
            <button type="button" disabled>
              Đang tải danh sách người dùng…
            </button>
          ) : suggestions.length > 0 ? (
            suggestions.map((u) => (
              <button key={u.accountId} type="button" onClick={() => handlePick(u)}>
                {u.displayName}
                {u.email ? ` · ${u.email}` : ''}
              </button>
            ))
          ) : (
            <button type="button" disabled>
              Không tìm thấy người dùng phù hợp.
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Ô nhập link tài liệu (user dán URL rồi nộp). Validate http(s) phía client.
 */
function LinkInput({ initial, busy, onSubmit, submitLabel }) {
  const [url, setUrl] = useState(initial || '');
  const valid = /^https?:\/\//i.test(url.trim());
  return (
    <div className="vg-link-input">
      <input
        className="vg-input"
        type="url"
        placeholder="https://… dán link tài liệu của bạn"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <button
        type="button"
        className="vg-btn vg-btn--primary vg-btn--sm"
        disabled={busy || !valid}
        onClick={() => onSubmit(url.trim())}
      >
        {submitLabel || '📎 Nộp link'}
      </button>
    </div>
  );
}

function DocRow({
  item,
  expanded,
  onToggle,
  currentUserId,
  busy,
  pickReviewer,
  onPickReviewer,
  onSubmitLink,
  onAssign,
  onSetStatus,
  onReject,
  onResubmit,
}) {
  const [editingLink, setEditingLink] = useState(false);

  const meta = statusMeta(item.status);
  const submitted = Boolean(item.url);
  const hasReviewer = Boolean(item.reviewerId);
  const isReviewer = currentUserId === item.reviewerId;
  const isOwner = currentUserId === item.addedById;
  // Người đã nộp link (hoặc dữ liệu cũ chưa gắn người nộp) được phép đổi link.
  const isSubmitter = !item.submittedById || currentUserId === item.submittedById;

  const canAssign = submitted && (!hasReviewer || isOwner) && item.status !== 'approved';
  const canReview = isReviewer && item.status !== 'approved';
  const canResubmit = isOwner && item.status === 'rejected';
  const canEditLink = submitted && isSubmitter && item.status !== 'approved';

  const headBadge = submitted ? (
    <span className={`vg-badge ${meta.cls} vg-row-badge`}>{meta.label}</span>
  ) : (
    <span className="vg-badge vg-badge--default vg-row-badge">Chưa nộp link</span>
  );

  return (
    <div className={`vg-row ${expanded ? 'is-open' : ''}`}>
      <button type="button" className="vg-row-head" onClick={onToggle}>
        <span className={`vg-dot ${submitted ? `vg-dot--${item.status}` : 'vg-dot--unsubmitted'}`} />
        <span className="vg-row-name">{item.title || 'Tài liệu'}</span>
        {item.required ? <span className="vg-tag vg-tag--req">Bắt buộc</span> : null}
        {headBadge}
        <span className="vg-chevron">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded ? (
        <div className="vg-row-body">
          {!submitted ? (
            // CHƯA NỘP: user dán link để bắt đầu quy trình review.
            <>
              <div className="vg-card-meta">
                Chưa có link. Dán link tài liệu bạn đã hoàn thành để gửi đi review.
              </div>
              <LinkInput
                busy={busy}
                onSubmit={(url) => onSubmitLink(item.templateId, url)}
              />
            </>
          ) : (
            <>
              <div className="vg-card-meta">
                {hasReviewer
                  ? `Reviewer: ${isReviewer ? 'Bạn' : item.reviewerName || '—'}`
                  : 'Chưa giao reviewer'}
                {item.submittedByName ? ` · Nộp bởi ${item.submittedByName}` : ''}
                {item.round > 1 ? ` · Vòng #${item.round}` : ''}
              </div>

              {item.status === 'rejected' && item.rejectReason ? (
                <div className="vg-reason">
                  <strong>Lý do từ chối:</strong> {item.rejectReason}
                </div>
              ) : null}

              {editingLink ? (
                <div className="vg-assign">
                  <span className="vg-label">Đổi link tài liệu</span>
                  <LinkInput
                    initial={item.url}
                    busy={busy}
                    submitLabel="Lưu link mới"
                    onSubmit={(url) => {
                      onSubmitLink(item.templateId, url);
                      setEditingLink(false);
                    }}
                  />
                </div>
              ) : null}

              {canAssign ? (
                <div className="vg-assign">
                  <span className="vg-label">
                    {hasReviewer ? 'Đổi reviewer' : 'Chọn người review'}
                  </span>
                  <UserSearch
                    value={pickReviewer}
                    onSelect={(id) => onPickReviewer(item.templateId, id)}
                    placeholder="Gõ tên để tìm…"
                  />
                </div>
              ) : null}

              <div className="vg-actions">
                <a
                  className="vg-btn vg-btn--ghost vg-btn--sm"
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  🔗 Mở tài liệu
                </a>

                {canEditLink ? (
                  <button
                    type="button"
                    className="vg-btn vg-btn--ghost vg-btn--sm"
                    disabled={busy}
                    onClick={() => setEditingLink((v) => !v)}
                  >
                    {editingLink ? 'Huỷ đổi link' : '✏️ Đổi link'}
                  </button>
                ) : null}

                {canAssign ? (
                  <button
                    type="button"
                    className="vg-btn vg-btn--primary vg-btn--sm"
                    disabled={busy || !pickReviewer}
                    onClick={() => onAssign(item.templateId)}
                  >
                    {hasReviewer ? 'Giao lại' : 'Giao review'}
                  </button>
                ) : null}

                {canReview ? (
                  <>
                    {item.status !== 'in_review' ? (
                      <button
                        type="button"
                        className="vg-btn vg-btn--ghost vg-btn--sm"
                        disabled={busy}
                        onClick={() => onSetStatus(item.templateId, 'in_review')}
                      >
                        Đang review
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="vg-btn vg-btn--success vg-btn--sm"
                      disabled={busy}
                      onClick={() => onSetStatus(item.templateId, 'approved')}
                    >
                      Duyệt
                    </button>
                    <button
                      type="button"
                      className="vg-btn vg-btn--warning vg-btn--sm"
                      disabled={busy}
                      onClick={() => onReject(item)}
                    >
                      Từ chối
                    </button>
                  </>
                ) : null}

                {canResubmit ? (
                  <button
                    type="button"
                    className="vg-btn vg-btn--primary vg-btn--sm"
                    disabled={busy}
                    onClick={() => onResubmit(item.templateId)}
                  >
                    Gửi lại để review
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentStatus, setCurrentStatus] = useState('');
  const [pickReviewer, setPickReviewer] = useState({});
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  // Link đang mở rộng (accordion) — chỉ 1 link mở tại một thời điểm.
  const [expandedId, setExpandedId] = useState(null);
  // true khi app đang chạy trong ngữ cảnh "edit" của custom field (có nút đóng).
  const [isFieldEdit, setIsFieldEdit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    view
      .getContext()
      .then((ctx) => {
        if (!cancelled && ctx?.extension?.type === 'jira:customFieldType') {
          setIsFieldEdit(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Đóng trình chỉnh sửa field: value function sẽ tự tính lại giá trị hiển thị.
  const closeFieldEdit = useCallback(async () => {
    try {
      await view.submit(null);
    } catch {
      try {
        await view.close();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const applyResponse = useCallback((res) => {
    setItems(Array.isArray(res?.items) ? res.items : []);
    if (res?.currentUserId) {
      setCurrentUserId(res.currentUserId);
    }
    if (typeof res?.currentStatus === 'string') {
      setCurrentStatus(res.currentStatus);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await invoke('docReview.panel');
      applyResponse(res);
    } catch (e) {
      setError(e.message || 'Không tải được danh sách tài liệu.');
    } finally {
      setLoading(false);
    }
  }, [applyResponse]);

  useEffect(() => {
    refresh();
    const sub = events.on('JIRA_ISSUE_CHANGED', () => setTimeout(refresh, 600));
    return () => {
      sub.then((s) => s.unsubscribe());
    };
  }, [refresh]);

  const runAction = useCallback(
    async (fn) => {
      setBusy(true);
      setError('');
      try {
        const res = await fn();
        applyResponse(res);
        return true;
      } catch (e) {
        setError(e.message || 'Thao tác thất bại.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applyResponse]
  );

  const handleAssign = async (templateId) => {
    const reviewerId = pickReviewer[templateId];
    if (!reviewerId) {
      return;
    }
    const ok = await runAction(() =>
      invoke('docReview.assign', { templateId, reviewerId })
    );
    if (ok) {
      setPickReviewer((p) => ({ ...p, [templateId]: '' }));
    }
  };

  const handleSubmitLink = (templateId, url) =>
    runAction(() => invoke('docReview.submitLink', { templateId, url }));

  const handleSetStatus = (templateId, status) =>
    runAction(() => invoke('docReview.setStatus', { templateId, status }));

  const handleResubmit = (templateId) =>
    runAction(() => invoke('docReview.resubmit', { templateId }));

  const submitReject = async () => {
    if (!rejectTarget) {
      return;
    }
    const ok = await runAction(() =>
      invoke('docReview.setStatus', {
        templateId: rejectTarget.templateId,
        status: 'rejected',
        reason: rejectReason,
      })
    );
    if (ok) {
      setRejectTarget(null);
      setRejectReason('');
    }
  };

  if (loading) {
    return (
      <div className="vg-app">
        <div className="vg-loading">
          <div className="vg-spinner" />
          Đang tải danh sách tài liệu…
        </div>
      </div>
    );
  }

  const total = items.length;
  const approvedCount = items.filter((i) => i.status === 'approved').length;
  const rejectedCount = items.filter((i) => i.status === 'rejected').length;
  // Chưa nộp link = chưa có URL. Các nhóm còn lại chỉ tính tài liệu đã nộp.
  const submittedItems = items.filter((i) => i.url);
  const notSubmitted = items.filter((i) => !i.url);
  const rejected = submittedItems.filter((i) => i.status === 'rejected');
  const pending = submittedItems.filter((i) => i.status === 'pending');
  const inReview = submittedItems.filter((i) => i.status === 'in_review');
  const approved = submittedItems.filter((i) => i.status === 'approved');
  const pct = total > 0 ? Math.round((approvedCount / total) * 100) : 0;

  const renderRow = (item) => (
    <DocRow
      key={item.templateId}
      item={item}
      expanded={expandedId === item.templateId}
      onToggle={() =>
        setExpandedId((cur) => (cur === item.templateId ? null : item.templateId))
      }
      currentUserId={currentUserId}
      busy={busy}
      pickReviewer={pickReviewer[item.templateId]}
      onPickReviewer={(id, reviewerId) =>
        setPickReviewer((p) => ({ ...p, [id]: reviewerId }))
      }
      onSubmitLink={handleSubmitLink}
      onAssign={handleAssign}
      onSetStatus={handleSetStatus}
      onReject={(it) => {
        setRejectTarget(it);
        setRejectReason('');
      }}
      onResubmit={handleResubmit}
    />
  );

  const renderSection = (title, list, accent) =>
    list.length > 0 ? (
      <div className="vg-group" key={title}>
        <div className="vg-section-title" style={accent ? { color: accent } : undefined}>
          {title} ({list.length})
        </div>
        <div className="vg-rows">{list.map(renderRow)}</div>
      </div>
    ) : null;

  return (
    <div className="vg-app">
      <div className="vg-head">
        <h2>Review tài liệu</h2>
        {isFieldEdit ? (
          <button type="button" className="vg-btn vg-btn--ghost vg-btn--sm" onClick={closeFieldEdit}>
            Đóng
          </button>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="vg-summary">
          <div className="vg-summary-top">
            <span className="vg-summary-count">
              {approvedCount}/{total} đã duyệt
            </span>
            {rejectedCount > 0 ? (
              <span className="vg-summary-rej">{rejectedCount} từ chối</span>
            ) : null}
            <span className="vg-summary-status">@ {currentStatus || '—'}</span>
          </div>
          <div className="vg-summary-bar">
            <div className="vg-summary-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}

      {error ? <div className="vg-alert vg-alert--error">{error}</div> : null}

      {items.length === 0 ? (
        <div className="vg-alert vg-alert--info">
          Chưa có tài liệu nào cần nộp cho status này. Admin khai báo trong Project Settings →
          DOR / DOD Configuration → Tài liệu cần nộp theo Status.
        </div>
      ) : (
        <>
          {renderSection('📎 Chưa nộp link', notSubmitted, '#475569')}
          {renderSection('⛔ Từ chối – cần làm lại', rejected, '#991b1b')}
          {renderSection('⏳ Cần xử lý', pending, '#b45309')}
          {renderSection('🔍 Đang review', inReview, '#1d4ed8')}
          {renderSection('✅ Đã duyệt', approved, '#065f46')}
        </>
      )}

      {rejectTarget ? (
        <div className="vg-overlay">
          <div className="vg-modal">
            <h3>Từ chối tài liệu</h3>
            <p style={{ fontSize: 12, marginBottom: 10, color: '#64748b' }}>
              Nhập lý do từ chối cho &quot;{rejectTarget.title || rejectTarget.url}&quot;. Người
              giao review sẽ được mention để làm lại.
            </p>
            <label className="vg-label" htmlFor="reject-reason">
              Lý do từ chối
            </label>
            <textarea
              id="reject-reason"
              className="vg-input"
              rows={4}
              placeholder="Ví dụ: Thiếu phần xử lý lỗi 401…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="vg-modal-foot">
              <button type="button" className="vg-btn vg-btn--ghost" onClick={() => setRejectTarget(null)}>
                Huỷ
              </button>
              <button
                type="button"
                className="vg-btn vg-btn--danger"
                disabled={busy || !rejectReason.trim()}
                onClick={submitReject}
              >
                Xác nhận từ chối
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
