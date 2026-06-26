import api, { route } from '@forge/api';
import { fetchDescriptionDoc } from './description';
import { evaluateGateLeave } from './gateLeaveCheck';

/**
 * Post a visible comment when an issue leaves a gate status with incomplete items.
 * Acts as a backup when the workflow validator is not attached to a transition.
 */
export async function maybePostGateLeaveWarning(instance, changelog, configs, issueTypeName) {
  if (!instance || !Array.isArray(changelog?.items)) {
    return instance;
  }

  const statusChange = changelog.items.find((item) => item.field === 'status');
  if (!statusChange) {
    return instance;
  }

  const fromStatus = statusChange.fromString || statusChange.from;
  const toStatus = statusChange.toString || statusChange.to;
  if (!fromStatus || !toStatus) {
    return instance;
  }

  const descriptionDoc = await fetchDescriptionDoc(instance.issueId);
  const check = evaluateGateLeave(configs, issueTypeName, fromStatus, descriptionDoc);

  if (!check.hasViolations) {
    return instance;
  }

  const warningKey = `${fromStatus}->${toStatus}`;
  instance.gateLeaveWarningsPosted = instance.gateLeaveWarningsPosted || {};

  // Avoid duplicate comments for the same transition pair on rapid webhook retries.
  if (instance.gateLeaveWarningsPosted[warningKey]) {
    return instance;
  }

  const posted = await postGateLeaveWarningComment(
    instance.issueId,
    fromStatus,
    toStatus,
    check
  );

  if (posted) {
    instance.gateLeaveWarningsPosted[warningKey] = new Date().toISOString();
  }

  return instance;
}

async function postGateLeaveWarningComment(issueId, fromStatus, toStatus, check) {
  const lines = [
    `⚠️ VietGate — Cảnh báo checklist`,
    '',
    `Issue vừa chuyển từ "${fromStatus}" sang "${toStatus}" nhưng checklist bắt buộc tại "${fromStatus}" chưa hoàn thành.`,
    '',
    'Các item còn thiếu:',
    '',
  ];

  for (const violation of check.violations) {
    lines.push(`${violation.gateLabel}:`);
    for (const item of violation.items) {
      lines.push(`  • ${item.text}`);
    }
    lines.push('');
  }

  lines.push('Vui lòng quay lại Description và tick đủ checklist trước khi tiếp tục.');

  const body = {
    type: 'doc',
    version: 1,
    content: lines
      .filter((line) => line !== undefined)
      .map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : [],
      })),
  };

  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.warn(`VietGate gate-leave warning comment failed (${response.status}): ${text}`);
    return false;
  }

  return true;
}
