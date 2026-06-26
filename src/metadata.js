import api, { route } from '@forge/api';

async function parseJiraResponse(response, contextLabel) {
  if (!response.ok) {
    const body = await response.text();
    console.warn(`${contextLabel} failed (${response.status}): ${body}`);
    throw new Error(`${contextLabel} thất bại. Vui lòng thử lại sau.`);
  }
  return response.json();
}

export async function fetchProjectDetails(projectId) {
  const response = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}`);
  const project = await parseJiraResponse(response, 'Load project details');
  return {
    id: String(project.id),
    key: project.key,
    name: project.name,
  };
}

export async function fetchProjectIssueTypes(projectId) {
  const response = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}`);
  const project = await parseJiraResponse(response, 'Load project issue types');
  return (project.issueTypes || []).map((type) => ({
    id: String(type.id),
    name: type.name,
  }));
}

export async function fetchProjectStatuses(projectId, issueTypeId = null) {
  const response = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}/statuses`);
  const statusByIssueType = await parseJiraResponse(response, 'Load project statuses');

  if (issueTypeId) {
    const normalizedId = String(issueTypeId);
    const match = statusByIssueType.find((entry) => String(entry.id) === normalizedId);
    return (match?.statuses || []).map((status) => ({
      id: status.id,
      name: status.name,
    }));
  }

  const unique = new Map();
  statusByIssueType.forEach((entry) => {
    (entry.statuses || []).forEach((status) => {
      if (!unique.has(status.name)) {
        unique.set(status.name, { id: status.id, name: status.name });
      }
    });
  });
  return Array.from(unique.values());
}

/**
 * Resolve a Jira status id or name to its display name (for workflow validators).
 */
export async function fetchStatusName(statusIdOrName) {
  if (!statusIdOrName) {
    return null;
  }

  const response = await api.asApp().requestJira(route`/rest/api/3/status/${statusIdOrName}`);
  if (!response.ok) {
    return null;
  }

  const status = await response.json();
  return status.name || null;
}
