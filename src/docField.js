/**
 * VietGate — Value function cho custom field "VietGate Document Review".
 *
 * Forge gọi hàm này trên MỖI lần xem issue (với danh sách issue ID). Ta tính
 * giá trị tươi của field cho từng issue dựa trên link tài liệu admin cấu hình
 * và trạng thái review đã lưu. Nhờ vậy field LUÔN hiển thị trạng thái mới nhất
 * ngay trên issue mà người dùng không cần bấm gì cả.
 *
 * Lưu ý của Forge: trong value function PHẢI gọi API bằng api.asApp() (đã được
 * xử lý bên trong computeIssueDocSummary). Hàm phải trả về MỘT mảng giá trị
 * theo ĐÚNG thứ tự của payload.issues.
 */

import { computeIssueDocSummaries } from './docReview';

export async function value(payload) {
  const issues = Array.isArray(payload?.issues) ? payload.issues : [];
  if (issues.length === 0) {
    return [];
  }

  // Một lượt tính cho TẤT CẢ issue: gộp REST + cache template theo project,
  // trả về mảng đúng thứ tự payload.issues.
  return computeIssueDocSummaries(issues.map((issue) => issue.id));
}
