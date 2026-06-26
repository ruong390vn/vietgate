import { storage } from '@forge/api';
import { maybePostCompletionComment } from './completionComment';
import { storageKeys } from './engine';
import { ensureInstance, getProjectConfigs } from './instance';
import { maybePostGateLeaveWarning } from './transitionWarning';

export async function onIssueCreated(event) {
  const issue = event.issue;
  await ensureInstance(
    issue.id,
    issue.fields.project.id,
    issue.fields.issuetype.name,
    issue.fields.status.name
  );
}

export async function onIssueUpdated(event) {
  const issue = event.issue;
  const projectId = issue.fields.project.id;
  const issueTypeName = issue.fields.issuetype.name;

  let instance = await ensureInstance(
    issue.id,
    projectId,
    issueTypeName,
    issue.fields.status.name
  );

  if (!instance) {
    return;
  }

  const configs = await getProjectConfigs(projectId);
  instance = await maybePostGateLeaveWarning(
    instance,
    event.changelog,
    configs,
    issueTypeName
  );

  instance = await maybePostCompletionComment(instance, event.changelog);

  const instanceKey = storageKeys.issueInstance(issue.id);
  await storage.set(instanceKey, instance);
}
