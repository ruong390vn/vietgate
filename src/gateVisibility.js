import { isRequiredItem } from './engine';

/**
 * User-facing helper text under the Description field.
 */
const BASE_NOTICE =
  'VietGate đã chèn DOR/DOD checklist vào Description. Item màu đỏ (có dấu * ở cuối) là bắt buộc. Tick trực tiếp tại đây khi checklist hiện.';

function summarizeRequiredProgress(items) {
  const required = (items || []).filter(isRequiredItem);
  if (required.length === 0) {
    return null;
  }

  const done = required.filter((item) => item.isChecked).length;
  return `${done}/${required.length} item bắt buộc`;
}

export function buildChecklistNotice(displayInstance, currentStatus, scheduledGates = []) {
  const parts = [];

  const dorProgress = summarizeRequiredProgress(displayInstance.dor?.items);
  if (dorProgress) {
    parts.push(`DOR: ${dorProgress}`);
  }

  const dodProgress = summarizeRequiredProgress(displayInstance.dod?.items);
  if (dodProgress) {
    parts.push(`DOD: ${dodProgress}`);
  }

  if (parts.length > 0) {
    return `${BASE_NOTICE} Vui lòng hoàn thành checklist bắt buộc (${parts.join(', ')}).`;
  }

  const scheduleText =
    scheduledGates.length > 0
      ? `Checklist sẽ hiện tại: ${scheduledGates.join(', ')}.`
      : 'Chưa có checklist cho status này.';

  return `${BASE_NOTICE} ${scheduleText} Status hiện tại: ${currentStatus || '—'}.`;
}

export function getBaseDescriptionNotice() {
  return BASE_NOTICE;
}

/**
 * Whether a gate checklist should appear for the current issue status.
 */
export function shouldShowGateInUI(gate, currentStatus) {
  if (!gate?.items?.length) {
    return false;
  }
  return (currentStatus || '') === gate.blockOnTransitionTo;
}

/**
 * Return a copy of the instance with gates hidden per gateMode and current status.
 */
export function filterInstanceForDisplay(instance, currentStatus) {
  const gateMode = instance.gateMode || 'both';
  const filtered = {
    ...instance,
    dor: { ...instance.dor, items: [...(instance.dor?.items || [])] },
    dod: { ...instance.dod, items: [...(instance.dod?.items || [])] },
  };

  if (gateMode === 'dod') {
    filtered.dor = { ...instance.dor, items: [] };
  }
  if (gateMode === 'dor') {
    filtered.dod = { ...instance.dod, items: [] };
  }

  if (!shouldShowGateInUI(filtered.dor, currentStatus)) {
    filtered.dor = { ...instance.dor, items: [] };
  }
  if (!shouldShowGateInUI(filtered.dod, currentStatus)) {
    filtered.dod = { ...instance.dod, items: [] };
  }

  return filtered;
}

export function hasVisibleGates(instance, currentStatus) {
  const filtered = filterInstanceForDisplay(instance, currentStatus);
  return (filtered.dor?.items?.length || 0) > 0 || (filtered.dod?.items?.length || 0) > 0;
}
