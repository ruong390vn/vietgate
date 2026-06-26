import api, { route } from '@forge/api';
import { normalizeDescriptionValue } from './description';
import { buildGateLeaveErrorMessage, evaluateGateLeave } from './gateLeaveCheck';
import { getProjectConfigs } from './instance';
import { fetchStatusName } from './metadata';
import { isProjectEnabled } from './projectMeta';

/**
 * The status being left is transition.from — not always issue.fields.status,
 * which may already reflect the destination during validation.
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

/**
 * Block workflow transition when leaving a gate status with incomplete required items.
 * Jira shows errorMessage as a dialog on the transition screen.
 */
export async function validator(event) {
  const issueKey = event?.issue?.key || event?.issue?.id;
  if (!issueKey) {
    console.warn('VietGate validator: missing issue key/id');
    return { result: true };
  }

  const response = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}?fields=project,issuetype,status,description`
  );

  if (!response.ok) {
    const body = await response.text();
    console.warn(`VietGate validator: could not load issue ${issueKey} (${response.status}): ${body}`);
    return { result: true };
  }

  const issue = await response.json();
  const projectId = String(issue.fields?.project?.id || '');
  const issueTypeName = issue.fields?.issuetype?.name;
  const leavingStatus = await resolveLeavingStatus(event, issue);

  if (!projectId || !issueTypeName || !leavingStatus) {
    console.warn('VietGate validator: missing context', {
      projectId,
      issueTypeName,
      leavingStatus,
      issueStatus: issue.fields?.status?.name,
      fromId: event?.transition?.from?.id,
    });
    return { result: true };
  }

  if (!(await isProjectEnabled(projectId))) {
    return { result: true };
  }

  const configs = await getProjectConfigs(projectId);
  const descriptionDoc =
    event.transition?.modifiedFields?.description ??
    normalizeDescriptionValue(issue.fields?.description);

  const check = evaluateGateLeave(configs, issueTypeName, leavingStatus, descriptionDoc);

  console.log('VietGate validator', {
    issueKey,
    issueTypeName,
    leavingStatus,
    issueStatus: issue.fields?.status?.name,
    toId: event?.transition?.to?.id,
    violationCount: check.violations.reduce((sum, v) => sum + v.items.length, 0),
    blocked: check.hasViolations,
  });

  if (!check.hasViolations) {
    return { result: true };
  }

  return {
    result: false,
    errorMessage: buildGateLeaveErrorMessage(check, leavingStatus),
  };
}

// Forge samples often export `run` — keep alias for compatibility.
export const run = validator;
