import { createHash, randomUUID } from 'crypto';
import api, { route } from '@forge/api';
import { isRequiredItem } from './engine';

export const DOR_HEADING = 'VietGate — Definition of Ready (DOR)';
export const DOD_HEADING = 'VietGate — Definition of Done (DOD)';
export const REQUIRED_NOTICE = 'Lưu ý: Item màu đỏ (có dấu *) là bắt buộc.';

const REQUIRED_COLOR = '#DE350B';

function gateHasRequiredItems(items) {
  return (items || []).some(isRequiredItem);
}

function buildRequiredNoticeNode() {
  return {
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: REQUIRED_NOTICE,
        marks: [{ type: 'em' }],
      },
    ],
  };
}

function isRequiredNoticeParagraph(node) {
  return node?.type === 'paragraph' && node.content?.[0]?.text === REQUIRED_NOTICE;
}

/**
 * ADF inline content for a checklist item — required items get a red trailing asterisk.
 */
export function buildTaskItemTextContent(item) {
  const text = String(item.text || '').trim();

  if (!isRequiredItem(item)) {
    return [{ type: 'text', text }];
  }

  return [
    {
      type: 'text',
      text,
      marks: [{ type: 'textColor', attrs: { color: REQUIRED_COLOR } }],
    },
    {
      type: 'text',
      text: ' *',
      marks: [
        { type: 'strong' },
        { type: 'textColor', attrs: { color: REQUIRED_COLOR } },
      ],
    },
  ];
}

/**
 * Jira ADF requires UUID-shaped localId values on task lists/items.
 */
export function toStableLocalId(seed) {
  const hash = createHash('sha256').update(`vietgate:${seed}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Build ADF task list node from checklist items.
 */
export function buildTaskList(items, gateType) {
  const visibleItems = (items || []).filter((item) => String(item.text || '').trim());
  if (visibleItems.length === 0) {
    return null;
  }

  return {
    type: 'taskList',
    attrs: {
      localId: toStableLocalId(`${gateType}-list`),
    },
    content: visibleItems.map((item) => ({
      type: 'taskItem',
      attrs: {
        localId: toStableLocalId(`${gateType}-${item.id}`),
        state: item.isChecked ? 'DONE' : 'TODO',
      },
      content: buildTaskItemTextContent(item),
    })),
  };
}

/**
 * Build ADF nodes for VietGate DOR/DOD sections.
 */
export function buildVietgateNodes(instance) {
  const nodes = [];

  if (instance.dor?.items?.length > 0) {
    nodes.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: DOR_HEADING }],
    });
    if (gateHasRequiredItems(instance.dor.items)) {
      nodes.push(buildRequiredNoticeNode());
    }
    const dorList = buildTaskList(instance.dor.items, 'dor');
    if (dorList) {
      nodes.push(dorList);
    }
  }

  if (instance.dod?.items?.length > 0) {
    nodes.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: DOD_HEADING }],
    });
    if (gateHasRequiredItems(instance.dod.items)) {
      nodes.push(buildRequiredNoticeNode());
    }
    const dodList = buildTaskList(instance.dod.items, 'dod');
    if (dodList) {
      nodes.push(dodList);
    }
  }

  if (nodes.length > 0) {
    nodes.unshift({
      type: 'paragraph',
      content: [{ type: 'text', text: ' ' }],
    });
  }

  return nodes;
}

/**
 * Remove existing VietGate ADF blocks before re-sync.
 */
export function stripVietgateContent(content) {
  if (!Array.isArray(content)) {
    return [];
  }

  const result = [];
  let index = 0;

  while (index < content.length) {
    const node = content[index];

    if (node.type === 'heading') {
      const text = node.content?.[0]?.text || '';
      if (text === DOR_HEADING || text === DOD_HEADING) {
        index += 1;
        if (isRequiredNoticeParagraph(content[index])) {
          index += 1;
        }
        if (content[index]?.type === 'taskList') {
          index += 1;
        }
        continue;
      }
    }

    if (
      node.type === 'paragraph' &&
      node.content?.length === 1 &&
      node.content[0]?.type === 'text' &&
      node.content[0]?.text === ' '
    ) {
      const next = content[index + 1];
      if (next?.type === 'heading') {
        const headingText = next.content?.[0]?.text || '';
        if (headingText === DOR_HEADING || headingText === DOD_HEADING) {
          index += 1;
          continue;
        }
      }
    }

    result.push(node);
    index += 1;
  }

  return result;
}

/**
 * Merge VietGate checklist nodes into an ADF document.
 */
export function mergeVietgateIntoDoc(doc, instance) {
  const baseDoc =
    doc && typeof doc === 'object' && doc.type === 'doc'
      ? doc
      : { type: 'doc', version: 1, content: [] };

  const preserved = stripVietgateContent(baseDoc.content || []);
  const vietgateNodes = buildVietgateNodes(instance);

  if (vietgateNodes.length === 0) {
    return {
      type: 'doc',
      version: 1,
      content: preserved,
    };
  }

  return {
    type: 'doc',
    version: 1,
    content: [...preserved, ...vietgateNodes],
  };
}

/**
 * Normalize plain-text or ADF description into a doc node.
 */
export function normalizeDescriptionValue(value) {
  if (value && typeof value === 'object' && value.type === 'doc') {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    return {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
    };
  }

  return { type: 'doc', version: 1, content: [] };
}

/**
 * Read checked states from VietGate task lists inside Description ADF.
 */
export function readCheckedStatesFromDoc(doc) {
  const states = new Map();
  const content = doc?.content || [];
  let activeGate = null;

  for (const node of content) {
    if (node.type === 'heading') {
      const text = node.content?.[0]?.text || '';
      if (text === DOR_HEADING) {
        activeGate = 'dor';
      } else if (text === DOD_HEADING) {
        activeGate = 'dod';
      } else {
        activeGate = null;
      }
      continue;
    }

    if (node.type === 'taskList' && activeGate) {
      for (const task of node.content || []) {
        if (task.type !== 'taskItem') {
          continue;
        }
        const localId = task.attrs?.localId;
        const text = task.content?.[0]?.text || '';
        if (localId) {
          states.set(localId, task.attrs?.state === 'DONE');
        }
        if (text) {
          states.set(`${activeGate}::${text}`, task.attrs?.state === 'DONE');
        }
      }
      activeGate = null;
    }
  }

  return states;
}

/**
 * Apply checked states parsed from Description back to the runtime instance.
 */
export function applyDescriptionStatesToInstance(instance, doc) {
  const states = readCheckedStatesFromDoc(doc);
  if (states.size === 0) {
    return instance;
  }

  for (const gateType of ['dor', 'dod']) {
    const section = instance[gateType];
    if (!section?.items) {
      continue;
    }

    section.items = section.items.map((item) => {
      const byId = states.get(toStableLocalId(`${gateType}-${item.id}`));
      const byText = states.get(`${gateType}::${String(item.text || '').trim()}`);
      if (byId === undefined && byText === undefined) {
        return item;
      }
      return {
        ...item,
        isChecked: Boolean(byId ?? byText),
      };
    });
  }

  return instance;
}

/**
 * Fetch issue description ADF document.
 */
export async function fetchDescriptionDoc(issueId) {
  const response = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueId}?fields=description`
  );

  if (!response.ok) {
    return { type: 'doc', version: 1, content: [] };
  }

  const issue = await response.json();
  const description = issue.fields?.description;

  if (description && typeof description === 'object' && description.type === 'doc') {
    return description;
  }

  return { type: 'doc', version: 1, content: [] };
}

/**
 * Append or update VietGate DOR/DOD block in issue Description field.
 */
export async function syncDescriptionChecklists(issueId, instance) {
  const currentDoc = await fetchDescriptionDoc(issueId);
  const mergedDoc = mergeVietgateIntoDoc(currentDoc, instance);

  const updateResponse = await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        description: mergedDoc,
      },
    }),
  });

  if (!updateResponse.ok) {
    const body = await updateResponse.text();
    return {
      ok: false,
      error: `Failed to sync Description (${updateResponse.status}): ${body}`,
      descriptionDoc: mergedDoc,
    };
  }

  return { ok: true, descriptionDoc: mergedDoc };
}

/**
 * Build a bullet-list fallback when task lists are rejected by Jira.
 */
export function buildBulletFallbackDoc(doc, instance) {
  const baseDoc = normalizeDescriptionValue(doc);
  const preserved = stripVietgateContent(baseDoc.content || []);
  const nodes = [];

  const formatBulletText = (item) => {
    const text = String(item.text).trim();
    const prefix = item.isChecked ? '[x]' : '[ ]';
    return isRequiredItem(item) ? `${prefix} ${text} *` : `${prefix} ${text}`;
  };

  const appendGate = (gateType, gateLabel, items) => {
    const visible = (items || []).filter((item) => String(item.text || '').trim());
    if (visible.length === 0) {
      return;
    }
    nodes.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: gateLabel }],
    });
    if (gateHasRequiredItems(visible)) {
      nodes.push(buildRequiredNoticeNode());
    }
    nodes.push({
      type: 'bulletList',
      content: visible.map((item) => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: formatBulletText(item),
                ...(isRequiredItem(item)
                  ? { marks: [{ type: 'textColor', attrs: { color: REQUIRED_COLOR } }] }
                  : {}),
              },
            ],
          },
        ],
      })),
    });
  };

  appendGate('dor', DOR_HEADING, instance.dor?.items);
  appendGate('dod', DOD_HEADING, instance.dod?.items);

  return {
    type: 'doc',
    version: 1,
    content: [...preserved, ...nodes],
  };
}

export function newLocalId() {
  return randomUUID();
}
