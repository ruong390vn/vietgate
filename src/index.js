import { storage } from '@forge/api';
import Resolver from '@forge/resolver';
import { buildChecklistPreview } from './checklistPreview';
import { normalizeProjectConfig, storageKeys, validateConfigStatusUniqueness } from './engine';
import { ensureInstance, getProjectConfigs } from './instance';
import { fetchProjectDetails, fetchProjectIssueTypes, fetchProjectStatuses } from './metadata';
import { getProjectMeta, setProjectEnabled, isProjectEnabled } from './projectMeta';
import { syncUiModificationsForProject } from './uimRegistry';
import { registerDocReviewResolvers } from './docReview';
import { assertProjectAdmin } from './projectAuth';

const resolver = new Resolver();

// Tính năng cộng thêm: Document Review (độc lập, không đụng logic DOR/DOD).
registerDocReviewResolvers(resolver);

async function saveProjectConfigs(projectId, configs) {
  await storage.set(storageKeys.projectConfigs(projectId), { configs });
}

/**
 * Fast resolver for UIM — inject checklist into Description by status + gate mode.
 */
resolver.define('getChecklistPreview', async (req) => {
  const extension = req.context.extension || {};
  const payload = req.payload || {};

  const projectId = payload.projectId || extension.project?.id;
  const issueTypeName = payload.issueTypeName || extension.issueType?.name;
  const currentStatus =
    payload.currentStatus ||
    extension.issue?.status?.name ||
    'Open';
  const existingDescription = payload.existingDescription ?? null;

  if (!projectId || !issueTypeName) {
    return { shouldRender: false };
  }

  return buildChecklistPreview({
    projectId,
    issueTypeName,
    currentStatus,
    existingDescription,
  });
});

resolver.define('getProjectConfigs', async (req) => {
  await assertProjectAdmin(req);
  const projectId = req.context.extension.project.id;
  const [configs, meta, project] = await Promise.all([
    getProjectConfigs(projectId),
    getProjectMeta(projectId),
    fetchProjectDetails(projectId),
  ]);

  if (meta.enabled) {
    try {
      await syncUiModificationsForProject(projectId, configs, true, project.name);
    } catch (error) {
      console.error('VietGate UIM sync failed:', error);
    }
  }

  return {
    enabled: meta.enabled,
    project,
    configs,
  };
});

resolver.define('setProjectEnabled', async (req) => {
  await assertProjectAdmin(req);
  const projectId = req.context.extension.project.id;
  const { enabled } = req.payload || {};
  const project = await fetchProjectDetails(projectId);
  const meta = await setProjectEnabled(projectId, enabled, project);

  const configs = await getProjectConfigs(projectId);
  await syncUiModificationsForProject(projectId, configs, meta.enabled, project.name);

  return { success: true, meta, project };
});

resolver.define('saveProjectConfig', async (req) => {
  await assertProjectAdmin(req);
  const projectId = req.context.extension.project.id;
  const incoming = req.payload.config;

  if (!(await isProjectEnabled(projectId))) {
    throw new Error('Cần bật VietGate cho project trước khi lưu cấu hình.');
  }

  if (!incoming?.issueType) {
    throw new Error('Issue Type là bắt buộc.');
  }

  const normalized = normalizeProjectConfig({ ...incoming, projectId: String(projectId) });
  const hasItems =
    (normalized.dor.enabled && normalized.dor.items.length > 0) ||
    (normalized.dod.enabled && normalized.dod.items.length > 0);

  if (!hasItems) {
    throw new Error('Cần ít nhất một item trong DOR hoặc DOD.');
  }

  const configs = await getProjectConfigs(projectId);
  validateConfigStatusUniqueness(configs, normalized, normalized.configId);

  const index = configs.findIndex((cfg) => cfg.configId === normalized.configId);
  if (index >= 0) {
    configs[index] = normalized;
  } else {
    configs.push(normalized);
  }

  await saveProjectConfigs(projectId, configs);

  const project = await fetchProjectDetails(projectId);
  await syncUiModificationsForProject(projectId, configs, true, project.name);

  return { success: true, config: normalized };
});

resolver.define('deleteProjectConfig', async (req) => {
  await assertProjectAdmin(req);
  const projectId = req.context.extension.project.id;
  const { configId } = req.payload;
  const configs = await getProjectConfigs(projectId);
  const remaining = configs.filter((cfg) => cfg.configId !== configId);
  await saveProjectConfigs(projectId, remaining);

  const project = await fetchProjectDetails(projectId);
  await syncUiModificationsForProject(projectId, remaining, remaining.length > 0, project.name);

  return { success: true };
});

resolver.define('getProjectIssueTypes', async (req) => {
  await assertProjectAdmin(req);
  const issueTypes = await fetchProjectIssueTypes(req.context.extension.project.id);
  return { issueTypes };
});

resolver.define('getProjectStatuses', async (req) => {
  await assertProjectAdmin(req);
  const projectId = req.context.extension.project.id;
  const { issueTypeId } = req.payload || {};
  const statuses = await fetchProjectStatuses(projectId, issueTypeId || null);
  return { statuses };
});

export const handler = resolver.getDefinitions();
