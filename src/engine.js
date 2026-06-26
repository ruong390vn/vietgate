/**
 * DOR/DOD engine — simplified checklist logic for VietGate.
 */

export const GATE_TYPES = {
  DOR: 'dor',
  DOD: 'dod',
};

export const storageKeys = {
  projectMeta: (projectId) => `dor_dod_meta_${String(projectId)}`,
  projectConfigs: (projectId) => `dor_dod_config_${String(projectId)}`,
  issueInstance: (issueId) => `dor_dod_instance_${issueId}`,
};

/**
 * Normalize status names for reliable comparisons across Jira APIs.
 */
export function normalizeStatusName(statusName) {
  return String(statusName || '').trim();
}

/**
 * Only items explicitly marked Required in admin should block transitions.
 */
export function isRequiredItem(item) {
  return item?.isRequired === true;
}

/**
 * Normalize admin config for one issue type.
 */
export function normalizeProjectConfig(raw) {
  const gateMode = raw.gateMode || 'both';
  const dorEnabled = gateMode === 'dor' || gateMode === 'both';
  const dodEnabled = gateMode === 'dod' || gateMode === 'both';

  return {
    configId: raw.configId || `cfg_${Date.now()}`,
    issueType: raw.issueType,
    gateMode,
    dor: {
      enabled: dorEnabled,
      blockOnTransitionTo: raw.dor?.blockOnTransitionTo || 'In Progress',
      items: dorEnabled
        ? (raw.dor?.items || []).map((item, index) => ({
            id: item.id || `dor-${index + 1}`,
            text: item.text,
            isRequired: item.isRequired === true,
          }))
        : [],
    },
    dod: {
      enabled: dodEnabled,
      blockOnTransitionTo: raw.dod?.blockOnTransitionTo || 'Done',
      items: dodEnabled
        ? (raw.dod?.items || []).map((item, index) => ({
            id: item.id || `dod-${index + 1}`,
            text: item.text,
            isRequired: item.isRequired === true,
          }))
        : [],
    },
  };
}

/**
 * Find all project configs for an issue type name.
 */
export function findConfigsForIssueType(configs, issueTypeName) {
  return configs.filter((cfg) => cfg.issueType === issueTypeName);
}

/**
 * @deprecated Use findConfigsForIssueType — kept for backward compatibility.
 */
export function findConfigForIssueType(configs, issueTypeName) {
  return findConfigsForIssueType(configs, issueTypeName)[0] || null;
}

/**
 * Collect gate target statuses declared in one config record.
 */
export function collectGateStatusesFromConfig(config) {
  const statuses = [];
  if ((config.gateMode === 'dor' || config.gateMode === 'both') && config.dor?.items?.length > 0) {
    statuses.push(config.dor.blockOnTransitionTo);
  }
  if ((config.gateMode === 'dod' || config.gateMode === 'both') && config.dod?.items?.length > 0) {
    statuses.push(config.dod.blockOnTransitionTo);
  }
  return statuses;
}

/**
 * Validate that statuses are unique per issue type across all config records.
 */
export function validateConfigStatusUniqueness(configs, incoming, excludeConfigId = '') {
  const newStatuses = collectGateStatusesFromConfig(incoming);
  const uniqueNew = new Set(newStatuses);
  if (uniqueNew.size !== newStatuses.length) {
    throw new Error('Trong một cấu hình, DOR và DOD không thể dùng cùng một status.');
  }

  const usedStatuses = [];
  for (const cfg of configs) {
    if (cfg.configId === excludeConfigId || cfg.issueType !== incoming.issueType) {
      continue;
    }
    usedStatuses.push(...collectGateStatusesFromConfig(cfg));
  }

  for (const status of newStatuses) {
    if (usedStatuses.includes(status)) {
      throw new Error(
        `Status "${status}" đã có cấu hình cho Issue Type "${incoming.issueType}". Chọn status khác hoặc sửa cấu hình hiện có.`
      );
    }
  }
}

/**
 * List scheduled gate labels for admin / user notices.
 */
export function collectScheduledGateLabels(configs, issueTypeName) {
  const labels = [];
  for (const cfg of findConfigsForIssueType(configs, issueTypeName)) {
    if ((cfg.gateMode === 'dor' || cfg.gateMode === 'both') && cfg.dor?.items?.length > 0) {
      labels.push(`DOR @ ${cfg.dor.blockOnTransitionTo}`);
    }
    if ((cfg.gateMode === 'dod' || cfg.gateMode === 'both') && cfg.dod?.items?.length > 0) {
      labels.push(`DOD @ ${cfg.dod.blockOnTransitionTo}`);
    }
  }
  return labels;
}

/**
 * Merge all config records for one issue type into a runtime instance for the active status.
 */
export function buildMergedInstanceForStatus(configs, issueTypeName, issueId, projectId, currentStatus) {
  const relevant = findConfigsForIssueType(configs, issueTypeName);
  const normalizedCurrent = normalizeStatusName(currentStatus);

  const snapshotItems = (items, configId) =>
    items.map((item) => ({
      id: `${configId}-${item.id}`,
      text: item.text,
      isRequired: isRequiredItem(item),
      isChecked: false,
      updatedBy: null,
      updatedAt: null,
    }));

  const merged = {
    issueId: String(issueId),
    projectId: String(projectId),
    issueType: issueTypeName,
    gateMode: 'both',
    currentStatus,
    isOrphaned: false,
    configIds: relevant.map((cfg) => cfg.configId),
    dor: { blockOnTransitionTo: currentStatus, items: [] },
    dod: { blockOnTransitionTo: currentStatus, items: [] },
  };

  for (const cfg of relevant) {
    if (
      (cfg.gateMode === 'dor' || cfg.gateMode === 'both') &&
      normalizeStatusName(cfg.dor?.blockOnTransitionTo) === normalizedCurrent &&
      cfg.dor.items?.length > 0
    ) {
      merged.dor = {
        blockOnTransitionTo: cfg.dor.blockOnTransitionTo,
        items: snapshotItems(cfg.dor.items, cfg.configId),
      };
    }

    if (
      (cfg.gateMode === 'dod' || cfg.gateMode === 'both') &&
      normalizeStatusName(cfg.dod?.blockOnTransitionTo) === normalizedCurrent &&
      cfg.dod.items?.length > 0
    ) {
      merged.dod = {
        blockOnTransitionTo: cfg.dod.blockOnTransitionTo,
        items: snapshotItems(cfg.dod.items, cfg.configId),
      };
    }
  }

  return merged;
}

/**
 * Create runtime instance snapshot from project config.
 */
export function createInstanceSnapshot(config, issueId, projectId, currentStatus) {
  const snapshotItems = (items) =>
    items.map((item) => ({
      id: item.id,
      text: item.text,
      isRequired: isRequiredItem(item),
      isChecked: false,
      updatedBy: null,
      updatedAt: null,
    }));

  return {
    issueId: String(issueId),
    projectId: String(projectId),
    configId: config.configId,
    issueType: config.issueType,
    gateMode: config.gateMode,
    currentStatus,
    isOrphaned: false,
    descriptionSynced: false,
    createdAt: new Date().toISOString(),
    dor: {
      blockOnTransitionTo: config.dor.blockOnTransitionTo,
      items: config.dor.enabled ? snapshotItems(config.dor.items) : [],
    },
    dod: {
      blockOnTransitionTo: config.dod.blockOnTransitionTo,
      items: config.dod.enabled ? snapshotItems(config.dod.items) : [],
    },
  };
}

/**
 * Calculate progress for a gate section.
 */
export function calculateGateProgress(items) {
  const required = items.filter(isRequiredItem);
  if (required.length === 0) {
    return 100;
  }
  const done = required.filter((item) => item.isChecked).length;
  return Math.round((done / required.length) * 100);
}

/**
 * Find unchecked required items for a gate.
 */
export function findGateViolations(items) {
  return items.filter((item) => isRequiredItem(item) && !item.isChecked);
}

/**
 * Determine which gate applies for a workflow transition target.
 */
export function resolveGateForTransition(instance, transitionToName) {
  if (
    instance.dor?.items?.length > 0 &&
    instance.dor.blockOnTransitionTo === transitionToName
  ) {
    return { gateType: GATE_TYPES.DOR, items: instance.dor.items, label: 'DOR' };
  }

  if (
    instance.dod?.items?.length > 0 &&
    instance.dod.blockOnTransitionTo === transitionToName
  ) {
    return { gateType: GATE_TYPES.DOD, items: instance.dod.items, label: 'DOD' };
  }

  return null;
}

/**
 * Build panel payload from instance.
 */
export function buildPanelPayload(instance) {
  const hasDor = instance.dor?.items?.length > 0;
  const hasDod = instance.dod?.items?.length > 0;

  return {
    shouldRender: hasDor || hasDod,
    gateMode: instance.gateMode,
    issueType: instance.issueType,
    isOrphaned: instance.isOrphaned,
    currentStatus: instance.currentStatus,
    dor: hasDor
      ? {
          label: 'Definition of Ready',
          blockOnTransitionTo: instance.dor.blockOnTransitionTo,
          progress: calculateGateProgress(instance.dor.items),
          items: instance.dor.items,
        }
      : null,
    dod: hasDod
      ? {
          label: 'Definition of Done',
          blockOnTransitionTo: instance.dod.blockOnTransitionTo,
          progress: calculateGateProgress(instance.dod.items),
          items: instance.dod.items,
        }
      : null,
    progress: calculateOverallProgress(instance),
  };
}

function calculateOverallProgress(instance) {
  const allItems = [...(instance.dor?.items || []), ...(instance.dod?.items || [])];
  return calculateGateProgress(allItems);
}
