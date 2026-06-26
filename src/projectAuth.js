/**
 * Kiểm tra quyền quản trị project trước các thao tác cấu hình (admin).
 *
 * Dùng api.asUser() để Jira đánh giá đúng quyền của người gọi resolver — không
 * tin tưởng việc UI chỉ hiện cho admin (module Forge không phải lớp bảo vệ).
 *
 * Cho phép: ADMINISTER_PROJECTS trên project HOẶC ADMINISTER (Jira site admin)
 * để không chặn nhầm admin toàn site đang cấu hình project.
 */

import api, { route } from '@forge/api';

/**
 * @throws {Error} nếu caller không phải project admin / site admin
 */
export async function assertProjectAdmin(req) {
  const projectId = req?.context?.extension?.project?.id;
  if (!projectId) {
    throw new Error('Không xác định được project hiện tại.');
  }
  if (!req?.context?.accountId) {
    throw new Error('Không xác định được người dùng hiện tại.');
  }

  const response = await api.asUser().requestJira(
    route`/rest/api/3/mypermissions?projectId=${String(projectId)}&permissions=ADMINISTER_PROJECTS,ADMINISTER`
  );

  if (!response.ok) {
    const body = await response.text();
    console.warn(`VietGate auth: mypermissions failed (${response.status}): ${body}`);
    throw new Error('Không thể xác minh quyền quản trị project.');
  }

  const data = await response.json();
  const perms = data.permissions || {};
  const isProjectAdmin = perms.ADMINISTER_PROJECTS?.havePermission === true;
  const isSiteAdmin = perms.ADMINISTER?.havePermission === true;

  if (!isProjectAdmin && !isSiteAdmin) {
    throw new Error('Chỉ quản trị viên project mới được thực hiện thao tác này.');
  }
}
