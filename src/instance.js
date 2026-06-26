import { storage } from '@forge/api';
import { applyDescriptionStatesToInstance, fetchDescriptionDoc } from './description';
import {
  buildMergedInstanceForStatus,
  findConfigsForIssueType,
  storageKeys,
} from './engine';
import { isProjectEnabled } from './projectMeta';

async function getProjectConfigs(projectId) {
  const store =
    (await storage.get(storageKeys.projectConfigs(String(projectId)))) || { configs: [] };
  return store.configs || [];
}

/**
 * Keep a lightweight merged instance for completion comments.
 */
export async function ensureInstance(issueId, projectId, issueTypeName, currentStatus) {
  if (!(await isProjectEnabled(projectId))) {
    return null;
  }

  const configs = await getProjectConfigs(projectId);
  if (findConfigsForIssueType(configs, issueTypeName).length === 0) {
    return null;
  }

  const instanceKey = storageKeys.issueInstance(issueId);
  const stored = await storage.get(instanceKey);

  let instance = buildMergedInstanceForStatus(
    configs,
    issueTypeName,
    issueId,
    projectId,
    currentStatus
  );

  if (stored?.completionCommentsPosted) {
    instance.completionCommentsPosted = stored.completionCommentsPosted;
  }

  const descriptionDoc = await fetchDescriptionDoc(issueId);
  instance = applyDescriptionStatesToInstance(instance, descriptionDoc);

  await storage.set(instanceKey, instance);
  return instance;
}

export { getProjectConfigs };
