import { storage } from '@forge/api';
import { storageKeys } from './engine';

/**
 * Load enablement metadata for a project.
 */
export async function getProjectMeta(projectId) {
  const meta = await storage.get(storageKeys.projectMeta(projectId));
  return {
    enabled: Boolean(meta?.enabled),
    projectId: String(projectId),
    projectKey: meta?.projectKey || '',
    projectName: meta?.projectName || '',
    updatedAt: meta?.updatedAt || null,
  };
}

/**
 * Check whether DOR/DOD is enabled for a project.
 */
export async function isProjectEnabled(projectId) {
  const meta = await getProjectMeta(projectId);
  return meta.enabled;
}

/**
 * Enable or disable VietGate for a project.
 */
export async function setProjectEnabled(projectId, enabled, projectInfo = {}) {
  const meta = {
    enabled: Boolean(enabled),
    projectId: String(projectId),
    projectKey: projectInfo.key || '',
    projectName: projectInfo.name || '',
    updatedAt: new Date().toISOString(),
  };

  await storage.set(storageKeys.projectMeta(projectId), meta);
  return meta;
}
