import React from 'react';
import { createRoot } from 'react-dom/client';
import { view, invoke } from '@forge/bridge';
import { uiModificationsApi } from '@forge/jira-bridge';

function readStatusName(statusField) {
  if (!statusField) {
    return 'Open';
  }
  const value = statusField.getValue?.();
  if (!value) {
    return 'Open';
  }
  if (typeof value === 'string') {
    return value;
  }
  return value.name || value.status?.name || 'Open';
}

/**
 * Inject checklist into Description — fast single resolver call.
 */
async function applyChecklistToDescription(api) {
  const context = await view.getContext();
  const extension = context.extension || {};
  const { project, issueType } = extension;

  const descriptionField = api.getFieldById('description');
  if (!descriptionField || !project?.id || !issueType?.name) {
    return;
  }

  const statusField = api.getFieldById('status');
  const currentStatus = readStatusName(statusField);
  const currentValue = descriptionField.getValue();

  const preview = await invoke('getChecklistPreview', {
    projectId: project.id,
    issueTypeName: issueType.name,
    existingDescription: currentValue,
    currentStatus,
  });

  if (preview?.shouldRender) {
    const docs = [preview.descriptionDoc, preview.fallbackDescriptionDoc].filter(Boolean);

    for (const doc of docs) {
      try {
        descriptionField.setValue(doc);
        break;
      } catch (error) {
        console.warn('VietGate setValue failed, trying fallback:', error);
      }
    }
  }

  descriptionField.setDescription(
    preview?.noticeMessage ||
      'VietGate đã chèn DOR/DOD checklist vào Description. Item màu đỏ (có dấu * ở cuối) là bắt buộc. Tick trực tiếp tại đây khi checklist hiện.'
  );
}

uiModificationsApi.onInit(
  async ({ api }) => {
    await applyChecklistToDescription(api);
  },
  () => ['description', 'status']
);

uiModificationsApi.onChange(
  async ({ api }) => {
    await applyChecklistToDescription(api);
  },
  () => ['description', 'status']
);

uiModificationsApi.onError((error) => {
  console.error('VietGate UIM error:', error);
});

createRoot(document.getElementById('root')).render(<React.Fragment />);
