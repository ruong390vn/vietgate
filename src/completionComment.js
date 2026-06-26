import api, { route } from '@forge/api';
import { isRequiredItem } from './engine';

const TERMINAL_STATUSES = ['Done', 'Closed', 'Resolved'];

const userNameCache = new Map();

async function fetchUserDisplayName(accountId) {
  if (!accountId) {
    return 'Chưa xác định';
  }

  if (userNameCache.has(accountId)) {
    return userNameCache.get(accountId);
  }

  const response = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
  if (!response.ok) {
    return accountId;
  }

  const user = await response.json();
  const name = user.displayName || accountId;
  userNameCache.set(accountId, name);
  return name;
}

function summarizeGate(label, gate) {
  const items = (gate?.items || []).filter(isRequiredItem);
  if (items.length === 0) {
    return null;
  }

  const checked = items.filter((item) => item.isChecked);
  return {
    label,
    checkedCount: checked.length,
    totalCount: items.length,
    checkedItems: checked,
    uncheckedItems: items.filter((item) => !item.isChecked),
  };
}

async function buildGateLines(summary) {
  const lines = [
    `${summary.label}: ${summary.checkedCount}/${summary.totalCount} item bắt buộc đã hoàn thành`,
  ];

  for (const item of summary.checkedItems) {
    const who = await fetchUserDisplayName(item.updatedBy);
    lines.push(`  • ${item.text} — bởi ${who}`);
  }

  for (const item of summary.uncheckedItems) {
    lines.push(`  • ${item.text} — chưa hoàn thành`);
  }

  return lines;
}

/**
 * Build ADF comment body for terminal status completion report.
 */
export async function buildCompletionCommentBody(instance, statusName) {
  const dorSummary = summarizeGate('DOR (Definition of Ready)', instance.dor);
  const dodSummary = summarizeGate('DOD (Definition of Done)', instance.dod);

  const lines = [
    `VietGate — Báo cáo checklist khi chuyển sang "${statusName}"`,
    '',
  ];

  if (dorSummary) {
    lines.push(...(await buildGateLines(dorSummary)), '');
  }

  if (dodSummary) {
    lines.push(...(await buildGateLines(dodSummary)), '');
  }

  if (!dorSummary && !dodSummary) {
    lines.push('Không có checklist DOR/DOD cho issue này.');
  }

  return {
    type: 'doc',
    version: 1,
    content: lines
      .filter((line) => line !== undefined)
      .map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : [],
      })),
  };
}

export async function postCompletionComment(issueId, instance, statusName) {
  const body = await buildCompletionCommentBody(instance, statusName);

  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.warn(`VietGate completion comment failed (${response.status}): ${text}`);
    return false;
  }

  return true;
}

/**
 * Post auto comment once when issue reaches Done / Closed / Resolved.
 */
export async function maybePostCompletionComment(instance, changelog) {
  if (!instance || !Array.isArray(changelog?.items)) {
    return instance;
  }

  const statusChange = changelog.items.find((item) => item.field === 'status');
  if (!statusChange) {
    return instance;
  }

  const newStatus = statusChange.toString || statusChange.to;
  if (!TERMINAL_STATUSES.includes(newStatus)) {
    return instance;
  }

  instance.completionCommentsPosted = instance.completionCommentsPosted || {};
  if (instance.completionCommentsPosted[newStatus]) {
    return instance;
  }

  const posted = await postCompletionComment(instance.issueId, instance, newStatus);
  if (posted) {
    instance.completionCommentsPosted[newStatus] = new Date().toISOString();
  }

  return instance;
}
