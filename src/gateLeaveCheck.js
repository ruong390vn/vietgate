import { applyDescriptionStatesToInstance } from './description';
import {
  buildMergedInstanceForStatus,
  findGateViolations,
} from './engine';

const GATE_LABELS = {
  dor: 'DOR (Definition of Ready)',
  dod: 'DOD (Definition of Done)',
};

/**
 * Check whether required checklist items are incomplete for the status being left.
 */
export function evaluateGateLeave(configs, issueTypeName, leavingStatus, descriptionDoc) {
  const instance = buildMergedInstanceForStatus(
    configs,
    issueTypeName,
    '',
    '',
    leavingStatus
  );

  applyDescriptionStatesToInstance(instance, descriptionDoc);

  const violations = [];

  for (const gateType of ['dor', 'dod']) {
    const section = instance[gateType];
    const unchecked = findGateViolations(section?.items || []);

    if (unchecked.length > 0) {
      violations.push({
        gateLabel: GATE_LABELS[gateType],
        status: leavingStatus,
        items: unchecked,
      });
    }
  }

  return {
    hasViolations: violations.length > 0,
    violations,
  };
}

/**
 * User-facing message shown in the workflow transition dialog.
 */
export function buildGateLeaveErrorMessage(check, leavingStatus) {
  const lines = [
    `VietGate — Chưa hoàn thành checklist bắt buộc tại status "${leavingStatus}".`,
    '',
    'Vui lòng tick các item bắt buộc sau trong Description trước khi chuyển status:',
    '',
  ];

  for (const violation of check.violations) {
    lines.push(`${violation.gateLabel}:`);
    for (const item of violation.items) {
      lines.push(`  • ${item.text}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}
