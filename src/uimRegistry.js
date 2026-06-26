import api, { route, storage } from '@forge/api';

const UIM_REGISTRY_KEY = 'dor_dod_uim_registry';

async function getRegistry() {
  return (await storage.get(UIM_REGISTRY_KEY)) || {};
}

async function saveRegistry(registry) {
  await storage.set(UIM_REGISTRY_KEY, registry);
}

/**
 * One UI modification per project (wildcard issue type) for create + view.
 */
async function upsertProjectUiModification(projectId, projectName) {
  const response = await api.asApp().requestJira(route`/rest/api/3/uiModifications`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      name: `VietGate DOR/DOD — ${projectName || projectId}`,
      description: 'Inject DOR/DOD checklist into Description on create and view.',
      data: JSON.stringify({ projectId: String(projectId) }),
      contexts: [
        { projectId: String(projectId), issueTypeId: null, viewType: 'GIC' },
        { projectId: String(projectId), issueTypeId: null, viewType: 'IssueView' },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`UIM create failed (${response.status}): ${body}`);
  }

  const created = await response.json();
  return String(created.id);
}

async function deleteUiModification(uimId) {
  const response = await api.asApp().requestJira(route`/rest/api/3/uiModifications/${uimId}`, {
    method: 'DELETE',
  });

  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(`UIM delete failed (${response.status}): ${body}`);
  }
}

/**
 * Keep one UI modification per enabled project.
 */
export async function syncUiModificationsForProject(projectId, configs, enabled, projectName = '') {
  const registry = await getRegistry();
  const projectKey = String(projectId);
  const currentId = registry[projectKey];

  if (!enabled || configs.length === 0) {
    if (currentId) {
      await deleteUiModification(currentId);
      delete registry[projectKey];
      await saveRegistry(registry);
    }
    return { registered: false };
  }

  if (currentId) {
    await deleteUiModification(currentId);
  }

  const uimId = await upsertProjectUiModification(projectId, projectName);
  registry[projectKey] = uimId;
  await saveRegistry(registry);
  return { registered: true, uimId };
}
