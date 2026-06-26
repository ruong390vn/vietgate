import {
  buildMergedInstanceForStatus,
  collectScheduledGateLabels,
  findConfigsForIssueType,
} from './engine';
import {
  applyDescriptionStatesToInstance,
  buildBulletFallbackDoc,
  mergeVietgateIntoDoc,
  normalizeDescriptionValue,
} from './description';
import {
  buildChecklistNotice,
  filterInstanceForDisplay,
  hasVisibleGates,
} from './gateVisibility';
import { getProjectConfigs } from './instance';
import { isProjectEnabled } from './projectMeta';

/**
 * Fast path: build Description checklist from all configs for an issue type.
 */
export async function buildChecklistPreview({
  projectId,
  issueTypeName,
  currentStatus = 'Open',
  existingDescription = null,
}) {
  if (!(await isProjectEnabled(projectId))) {
    return { shouldRender: false };
  }

  const configs = await getProjectConfigs(projectId);
  const typeConfigs = findConfigsForIssueType(configs, issueTypeName);
  if (typeConfigs.length === 0) {
    return { shouldRender: false };
  }

  let snapshot = buildMergedInstanceForStatus(
    configs,
    issueTypeName,
    'preview',
    projectId,
    currentStatus
  );

  const baseDoc = normalizeDescriptionValue(existingDescription);
  snapshot = applyDescriptionStatesToInstance(snapshot, baseDoc);

  const displayInstance = filterInstanceForDisplay(snapshot, currentStatus);
  const descriptionDoc = mergeVietgateIntoDoc(baseDoc, displayInstance);
  const visible = hasVisibleGates(snapshot, currentStatus);
  const scheduledGates = collectScheduledGateLabels(configs, issueTypeName);

  return {
    shouldRender: true,
    hasVisibleGates: visible,
    issueType: issueTypeName,
    currentStatus,
    scheduledGates,
    descriptionDoc,
    fallbackDescriptionDoc: buildBulletFallbackDoc(baseDoc, displayInstance),
    noticeMessage: buildChecklistNotice(displayInstance, currentStatus, scheduledGates),
    snapshot: displayInstance,
  };
}
