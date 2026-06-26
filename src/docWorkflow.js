/**
 * VietGate — Document Review Gate validator (độc lập với DOR/DOD).
 *
 * Chặn transition khi issue rời một status mà còn tài liệu BẮT BUỘC (required)
 * chưa được duyệt (status khác `approved`). Cơ chế giống validator checklist
 * DOR/DOD nhưng dữ liệu lấy từ Document Review (template + review state).
 *
 * Admin gắn validator "VietGate Document Review Gate" vào transition mong muốn
 * trong cấu hình workflow (Validate details → chọn validator này).
 */

import api, { route } from '@forge/api';
import { buildDocGateErrorMessage, evaluateDocGateLeave } from './docReview';
import { fetchStatusName } from './metadata';

/**
 * Status đang rời là transition.from (không phải issue.fields.status, vì lúc
 * validate trường này có thể đã trỏ tới status đích).
 */
async function resolveLeavingStatus(event, issue) {
  const fromId = event?.transition?.from?.id;
  if (fromId) {
    const fromName = await fetchStatusName(fromId);
    if (fromName) {
      return fromName;
    }
  }
  return issue?.fields?.status?.name || null;
}

export async function validator(event) {
  const issueKey = event?.issue?.key || event?.issue?.id;
  if (!issueKey) {
    console.warn('VietGate docGate: missing issue key/id');
    return { result: true };
  }

  const response = await api
    .asApp()
    .requestJira(route`/rest/api/3/issue/${issueKey}?fields=project,issuetype,status`);

  if (!response.ok) {
    const body = await response.text();
    console.warn(`VietGate docGate: could not load issue ${issueKey} (${response.status}): ${body}`);
    return { result: true };
  }

  const issue = await response.json();
  const issueId = String(issue.id || issueKey);
  const projectId = String(issue.fields?.project?.id || '');
  const issueTypeName = issue.fields?.issuetype?.name;
  const leavingStatus = await resolveLeavingStatus(event, issue);

  if (!projectId || !issueTypeName || !leavingStatus) {
    console.warn('VietGate docGate: missing context', { projectId, issueTypeName, leavingStatus });
    return { result: true };
  }

  const check = await evaluateDocGateLeave(issueId, projectId, issueTypeName, leavingStatus);

  console.log('VietGate docGate', {
    issueKey,
    issueTypeName,
    leavingStatus,
    blocked: check.hasViolations,
    blockingCount: check.blocking.length,
  });

  if (!check.hasViolations) {
    return { result: true };
  }

  return {
    result: false,
    errorMessage: buildDocGateErrorMessage(check.blocking, leavingStatus),
  };
}

export const run = validator;
