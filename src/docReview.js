/**
 * VietGate — Document Review Gate (tính năng cộng thêm, độc lập với DOR/DOD).
 *
 * Mô hình mới (theo yêu cầu):
 *  - ADMIN định nghĩa sẵn các "link tài liệu mẫu" trong DOR/DOD Configuration,
 *    mỗi link gắn với (Issue Type + Status). Lưu ở key riêng `doc_tpl_<projectId>`.
 *  - Khi một issue đang ở đúng Status đó, panel "VietGate Document Review" sẽ tự
 *    hiển thị các link tương ứng để review.
 *  - Mỗi issue lưu TRẠNG THÁI review riêng cho từng link mẫu (key `doc_review_<issueId>`),
 *    gồm reviewer, trạng thái phê duyệt, lý do từ chối, số vòng, lịch sử.
 *
 * File này KHÔNG đụng tới logic DOR/DOD. Nó chỉ đăng ký thêm resolver vào
 * instance @forge/resolver sẵn có của app (xem src/index.js).
 */

import api, { route, storage } from '@forge/api';
import { assertProjectAdmin } from './projectAuth';

// 4 trạng thái review hợp lệ của một link tài liệu.
export const DOC_STATUSES = {
  PENDING: 'pending',
  IN_REVIEW: 'in_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

const VALID_REVIEW_STATUSES = Object.values(DOC_STATUSES);

const MAX_HISTORY_PER_LINK = 20;

// Cache displayName trong phạm vi một invoke.
const userNameCache = new Map();

// Nhãn hiển thị ngắn gọn cho từng trạng thái (dùng cho custom field view).
const STATUS_LABELS = {
  pending: 'Chờ review',
  in_review: 'Đang review',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
};

const STATUS_ICONS = {
  pending: '⏳',
  in_review: '🔍',
  approved: '✅',
  rejected: '⛔',
};

/* ------------------------------------------------------------------ */
/* Storage keys                                                        */
/* ------------------------------------------------------------------ */

function templateKey(projectId) {
  return `doc_tpl_${String(projectId)}`;
}

function reviewKey(issueId) {
  return `doc_review_${String(issueId)}`;
}

/* ------------------------------------------------------------------ */
/* Context helpers                                                     */
/* ------------------------------------------------------------------ */

function resolveProjectId(req) {
  const projectId = req?.context?.extension?.project?.id;
  if (!projectId) {
    throw new Error('Không xác định được project hiện tại.');
  }
  return String(projectId);
}

function resolveIssueId(req) {
  const issueId = req?.context?.extension?.issue?.id;
  if (!issueId) {
    throw new Error('Không xác định được issue hiện tại.');
  }
  return String(issueId);
}

function resolveAccountId(req) {
  const accountId = req?.context?.accountId;
  if (!accountId) {
    throw new Error('Không xác định được người dùng hiện tại.');
  }
  return accountId;
}

/* ------------------------------------------------------------------ */
/* Storage read/write                                                  */
/* ------------------------------------------------------------------ */

async function readTemplates(projectId) {
  const stored = await storage.get(templateKey(projectId));
  return Array.isArray(stored?.templates) ? stored.templates : [];
}

async function writeTemplates(projectId, templates) {
  await storage.set(templateKey(projectId), { templates });
}

async function readReviews(issueId) {
  const stored = await storage.get(reviewKey(issueId));
  return stored?.reviews && typeof stored.reviews === 'object' ? stored.reviews : {};
}

async function writeReviews(issueId, reviews) {
  await storage.set(reviewKey(issueId), { reviews });
}

/* ------------------------------------------------------------------ */
/* Misc helpers                                                        */
/* ------------------------------------------------------------------ */

async function fetchUserDisplayName(accountId) {
  if (!accountId) {
    return 'Người dùng';
  }
  if (userNameCache.has(accountId)) {
    return userNameCache.get(accountId);
  }
  try {
    const response = await api
      .asApp()
      .requestJira(route`/rest/api/3/user?accountId=${accountId}`);
    if (!response.ok) {
      return accountId;
    }
    const user = await response.json();
    const name = user.displayName || accountId;
    userNameCache.set(accountId, name);
    return name;
  } catch (error) {
    console.warn('VietGate docReview: không lấy được displayName', error);
    return accountId;
  }
}

/**
 * Tìm user để giao reviewer. Gọi bằng .asApp() ở backend cho ổn định
 * (frontend requestJira trong ngữ cảnh custom field hay bị chặn).
 *
 * - Có `query`  -> /rest/api/3/user/search (tìm theo tên/email).
 * - Không query -> /rest/api/3/users/search (liệt kê user để preload danh sách).
 *
 * Chỉ trả về user thật (accountType = 'atlassian'), loại bỏ app/bot và user
 * không active. Trả về tối đa `maxResults` phần tử gọn nhẹ cho UI.
 */
async function searchAssignableUsers(query, maxResults = 20) {
  const trimmed = String(query || '').trim();
  const limit = Math.min(Math.max(Number(maxResults) || 20, 1), 50);

  const path = trimmed
    ? route`/rest/api/3/user/search?query=${trimmed}&maxResults=${String(limit)}`
    : route`/rest/api/3/users/search?maxResults=${String(limit)}`;

  try {
    const response = await api.asApp().requestJira(path, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      console.warn(`VietGate docReview user search failed (${response.status})`);
      return [];
    }
    const users = await response.json();
    if (!Array.isArray(users)) {
      return [];
    }
    return users
      .filter((u) => u.accountType === 'atlassian' && u.active !== false && u.accountId)
      .map((u) => ({
        accountId: u.accountId,
        displayName: u.displayName || u.accountId,
        email: u.emailAddress || '',
        avatarUrl: u.avatarUrls ? u.avatarUrls['24x24'] : '',
      }));
  } catch (error) {
    console.warn('VietGate docReview: lỗi tìm user', error);
    return [];
  }
}

/**
 * Lấy thông tin issue (project, issuetype, status) để biết link nào áp dụng.
 */
async function fetchIssueContext(issueId) {
  const response = await api
    .asApp()
    .requestJira(route`/rest/api/3/issue/${issueId}?fields=project,issuetype,status`);
  if (!response.ok) {
    const text = await response.text();
    console.warn(`VietGate docReview: fetchIssueContext failed (${response.status}): ${text}`);
    throw new Error('Không đọc được thông tin issue. Vui lòng thử lại sau.');
  }
  const issue = await response.json();
  return {
    projectId: String(issue.fields?.project?.id || ''),
    issueTypeName: issue.fields?.issuetype?.name || '',
    statusName: issue.fields?.status?.name || '',
  };
}

function isValidHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || '').trim());
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function pushHistory(review, entry) {
  review.history = Array.isArray(review.history) ? review.history : [];
  review.history.push(entry);
  if (review.history.length > MAX_HISTORY_PER_LINK) {
    review.history = review.history.slice(-MAX_HISTORY_PER_LINK);
  }
}

/* ------------------------------------------------------------------ */
/* ADF comment builders                                                */
/* ------------------------------------------------------------------ */

async function postComment(issueId, body) {
  try {
    const response = await api
      .asApp()
      .requestJira(route`/rest/api/3/issue/${issueId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
    if (!response.ok) {
      const text = await response.text();
      console.warn(`VietGate docReview comment failed (${response.status}): ${text}`);
    }
  } catch (error) {
    console.warn('VietGate docReview: lỗi khi đăng comment', error);
  }
}

function linkParagraph(template) {
  return {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Link: ' },
      {
        type: 'text',
        text: template.title || template.url,
        marks: [{ type: 'link', attrs: { href: template.url } }],
      },
    ],
  };
}

function buildMentionComment(mentionId, mentionName, leadSegments, template) {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'mention', attrs: { id: mentionId, text: `@${mentionName}` } },
          ...leadSegments,
        ],
      },
      linkParagraph(template),
    ],
  };
}

function buildPlainStatusComment(text, template) {
  return {
    type: 'doc',
    version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text }] },
      linkParagraph(template),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Build payload cho panel                                             */
/* ------------------------------------------------------------------ */

/**
 * Ghép template (theo status hiện tại) với trạng thái review đã lưu của issue.
 */
function buildPanelItems(templates, reviews, issueTypeName, statusName) {
  return templates
    .filter(
      (tpl) => tpl.issueType === issueTypeName && tpl.status === statusName
    )
    .map((tpl) => {
      const review = reviews[tpl.id] || {};
      // URL thật do USER nộp (lưu theo issue). `tpl.url` chỉ là fallback cho
      // dữ liệu cũ (mô hình trước đây admin dán sẵn link).
      const url = review.url || tpl.url || '';
      return {
        templateId: tpl.id,
        title: tpl.title || '',
        url,
        submitted: Boolean(url),
        required: tpl.required === true,
        status: review.status || DOC_STATUSES.PENDING,
        reviewerId: review.reviewerId || '',
        reviewerName: review.reviewerName || '',
        addedById: review.addedById || '',
        addedByName: review.addedByName || '',
        submittedById: review.submittedById || '',
        submittedByName: review.submittedByName || '',
        rejectReason: review.rejectReason || '',
        round: review.round || 0,
      };
    });
}

/* ------------------------------------------------------------------ */
/* Custom field value function                                         */
/* ------------------------------------------------------------------ */

/**
 * Chuyển danh sách item (đã ghép template + review) thành object giá trị field.
 * Trả về `null` nếu không có item nào (để field trống, không làm rối issue).
 */
function buildDocSummary(items) {
  if (!items || items.length === 0) {
    return null;
  }

  const total = items.length;
  const approved = items.filter((i) => i.status === DOC_STATUSES.APPROVED).length;

  // Sắp xếp: chưa nộp link lên đầu, rồi rejected/pending/in_review, approved cuối.
  const order = { rejected: 0, pending: 1, in_review: 2, approved: 3 };
  const rank = (i) => (!i.submitted ? -1 : order[i.status] ?? 1);
  const sorted = [...items].sort((a, b) => rank(a) - rank(b));

  // Mỗi tài liệu 1 dòng riêng cho dễ đọc:
  //   ⏳ Tiêu đề  •  Chờ review · Reviewer  [BẮT BUỘC]
  const lines = sorted.map((item) => {
    const req = item.required ? '  🔴 bắt buộc' : '';
    const title = item.title || '(chưa đặt tên)';
    if (!item.submitted) {
      // User chưa nộp link cho ô tài liệu này.
      return `📎 ${title}  •  Chưa nộp link${req}`;
    }
    const icon = STATUS_ICONS[item.status] || '⏳';
    const label = STATUS_LABELS[item.status] || 'Chờ review';
    const who = item.reviewerName ? ` · ${item.reviewerName}` : '';
    return `${icon} ${title}  •  ${label}${who}${req}`;
  });

  // Thanh tiến độ dạng text: ▰▰▱▱▱
  const ratio = total > 0 ? approved / total : 0;
  const filled = Math.round(ratio * 5);
  const bar = '▰'.repeat(filled) + '▱'.repeat(5 - filled);
  const header = `📋 Review tài liệu   ${bar}  ${approved}/${total} đã duyệt`;

  // CHỈ trả về đúng các thuộc tính khai báo trong schema (text/count/approved).
  // Nếu thêm thuộc tính lạ (vd. items), Jira loại bỏ cả giá trị => field rỗng.
  return {
    text: `${header}\n\n${lines.join('\n')}`,
    count: total,
    approved,
  };
}

/**
 * Lấy context (project, issuetype, status) cho NHIỀU issue trong tối thiểu số
 * lần gọi REST, dùng endpoint bulkfetch (tối đa 100 issue/lần). Trả về Map
 * issueId(string) -> { projectId, issueTypeName, statusName }.
 *
 * Đây là tối ưu quan trọng: value function có thể nhận nhiều issue cùng lúc
 * (vd. List View). Thay vì gọi REST cho từng issue, ta gộp lại 1 request.
 */
async function fetchIssueContextsBulk(issueIds) {
  const map = new Map();
  const CHUNK = 100;

  const chunks = [];
  for (let i = 0; i < issueIds.length; i += CHUNK) {
    chunks.push(issueIds.slice(i, i + CHUNK));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const response = await api
          .asApp()
          .requestJira(route`/rest/api/3/issue/bulkfetch`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              issueIdsOrKeys: chunk,
              fields: ['project', 'issuetype', 'status'],
            }),
          });
        if (!response.ok) {
          console.warn(`VietGate docReview bulkfetch failed (${response.status})`);
          return;
        }
        const data = await response.json();
        for (const issue of data.issues || []) {
          map.set(String(issue.id), {
            projectId: String(issue.fields?.project?.id || ''),
            issueTypeName: issue.fields?.issuetype?.name || '',
            statusName: issue.fields?.status?.name || '',
          });
        }
      } catch (error) {
        console.warn('VietGate docReview: bulkfetch lỗi', error);
      }
    })
  );

  return map;
}

/**
 * Tính giá trị field cho NHIỀU issue cùng lúc (dùng cho value function).
 * Trả về MỘT mảng giá trị theo ĐÚNG thứ tự của `issueIds`.
 *
 * Tối ưu:
 *  - 1 request bulkfetch cho toàn bộ issue (thay vì N request).
 *  - Đọc template 1 lần / project rồi cache trong phạm vi lần gọi này.
 *  - Bỏ qua việc đọc review (storage) cho issue KHÔNG có tài liệu khớp status
 *    — đây là phần lớn issue, nên tiết kiệm rất nhiều lượt đọc storage.
 */
export async function computeIssueDocSummaries(issueIds) {
  const ids = (issueIds || []).map(String).filter(Boolean);
  if (ids.length === 0) {
    return [];
  }

  let ctxMap;
  try {
    ctxMap = await fetchIssueContextsBulk(ids);
  } catch (error) {
    console.warn('VietGate docReview: bulkfetch lỗi, sẽ fallback', error);
    ctxMap = new Map();
  }

  // Fallback: issue nào bulkfetch không trả về context thì đọc lẻ (an toàn).
  const missing = ids.filter((id) => !ctxMap.has(id));
  if (missing.length > 0) {
    await Promise.all(
      missing.map(async (id) => {
        try {
          const ctx = await fetchIssueContext(id);
          ctxMap.set(id, ctx);
        } catch (error) {
          console.warn('VietGate docReview: fallback context lỗi cho issue', id, error);
        }
      })
    );
  }

  // Đọc template 1 lần cho mỗi project khác nhau (song song).
  const templatesByProject = new Map();
  const distinctProjects = [
    ...new Set([...ctxMap.values()].map((c) => c.projectId).filter(Boolean)),
  ];
  await Promise.all(
    distinctProjects.map(async (projectId) => {
      try {
        templatesByProject.set(projectId, await readTemplates(projectId));
      } catch {
        templatesByProject.set(projectId, []);
      }
    })
  );

  return Promise.all(
    ids.map(async (id) => {
      try {
        const ctx = ctxMap.get(id);
        if (!ctx || !ctx.projectId) {
          return null;
        }
        const templates = templatesByProject.get(ctx.projectId) || [];
        // Lọc nhanh: nếu status hiện tại không có tài liệu thì khỏi đọc review.
        const hasMatch = templates.some(
          (tpl) => tpl.issueType === ctx.issueTypeName && tpl.status === ctx.statusName
        );
        if (!hasMatch) {
          return null;
        }
        const reviews = await readReviews(id);
        const items = buildPanelItems(templates, reviews, ctx.issueTypeName, ctx.statusName);
        return buildDocSummary(items);
      } catch (error) {
        console.warn('VietGate docReview: summary lỗi cho issue', id, error);
        return null;
      }
    })
  );
}

/**
 * Tính giá trị field cho MỘT issue (tiện cho các nơi gọi lẻ).
 */
export async function computeIssueDocSummary(issueId) {
  const [summary] = await computeIssueDocSummaries([issueId]);
  return summary ?? null;
}

/* ------------------------------------------------------------------ */
/* Document Review Gate — chặn rời status nếu tài liệu Required chưa duyệt */
/* ------------------------------------------------------------------ */

/**
 * Kiểm tra: tại status đang rời (`leavingStatus`) của issue, có tài liệu nào
 * đánh dấu Required mà CHƯA `approved` hay không.
 *
 * Trả về:
 *   { hasViolations, blocking: [{ title, url, status }] }
 *
 * Chỉ tài liệu `required === true` mới chặn transition; tài liệu tuỳ chọn
 * không ảnh hưởng. Logic này tương tự gate của checklist DOR/DOD.
 */
export async function evaluateDocGateLeave(issueId, projectId, issueTypeName, leavingStatus) {
  const [templates, reviews] = await Promise.all([
    readTemplates(projectId),
    readReviews(issueId),
  ]);

  const required = templates.filter(
    (tpl) =>
      tpl.required === true &&
      tpl.issueType === issueTypeName &&
      tpl.status === leavingStatus
  );

  const blocking = required
    .filter((tpl) => (reviews[tpl.id]?.status || DOC_STATUSES.PENDING) !== DOC_STATUSES.APPROVED)
    .map((tpl) => {
      const review = reviews[tpl.id] || {};
      const url = review.url || tpl.url || '';
      return {
        title: tpl.title || url || '(tài liệu)',
        url,
        submitted: Boolean(url),
        status: review.status || DOC_STATUSES.PENDING,
      };
    });

  return { hasViolations: blocking.length > 0, blocking };
}

/**
 * Thông báo hiển thị trong dialog transition khi bị chặn.
 */
export function buildDocGateErrorMessage(blocking, leavingStatus) {
  const lines = [
    `VietGate — Có tài liệu BẮT BUỘC chưa được duyệt tại status "${leavingStatus}".`,
    '',
    'Vui lòng hoàn tất duyệt các tài liệu sau trước khi chuyển status:',
    '',
  ];
  for (const doc of blocking) {
    const label = !doc.submitted
      ? 'Chưa nộp link'
      : STATUS_LABELS[doc.status] || 'Chờ review';
    lines.push(`  • ${doc.title} (${label})`);
  }
  return lines.join('\n').trim();
}

/* ------------------------------------------------------------------ */
/* Đăng ký resolver                                                    */
/* ------------------------------------------------------------------ */

export function registerDocReviewResolvers(resolver) {
  /* ----- ADMIN: quản lý link mẫu theo status ----- */

  resolver.define('docTemplate.list', async (req) => {
    await assertProjectAdmin(req);
    const projectId = resolveProjectId(req);
    const templates = await readTemplates(projectId);
    return { templates };
  });

  resolver.define('docTemplate.save', async (req) => {
    await assertProjectAdmin(req);
    const projectId = resolveProjectId(req);
    const { id, issueType, status, title, url, required } = req.payload || {};

    if (!issueType) {
      throw new Error('Vui lòng chọn Issue Type cho tài liệu.');
    }
    if (!status) {
      throw new Error('Vui lòng chọn Status để hiển thị tài liệu.');
    }
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) {
      throw new Error('Vui lòng nhập tên tài liệu (vd: URD, Test Plan).');
    }

    const templates = await readTemplates(projectId);
    const clean = {
      id: id || generateId('tpl'),
      issueType,
      status,
      // Slot chỉ là "yêu cầu tài liệu". USER sẽ tự nộp link trên issue.
      title: cleanTitle,
      // Required = tài liệu BẮT BUỘC phải duyệt mới cho rời status (như checklist).
      required: required === true,
    };
    // URL chỉ giữ để tương thích dữ liệu cũ; nếu admin cố tình truyền vào thì
    // vẫn validate. Mô hình mới KHÔNG yêu cầu admin nhập URL.
    const cleanUrl = String(url || '').trim();
    if (cleanUrl) {
      if (!isValidHttpUrl(cleanUrl)) {
        throw new Error('Link tài liệu phải bắt đầu bằng http:// hoặc https://');
      }
      clean.url = cleanUrl;
    }

    const index = templates.findIndex((tpl) => tpl.id === clean.id);
    if (index >= 0) {
      templates[index] = clean;
    } else {
      templates.push(clean);
    }

    await writeTemplates(projectId, templates);
    return { templates };
  });

  // Lưu NHIỀU link cùng lúc cho 1 Issue Type + Status (1 lần ghi storage).
  resolver.define('docTemplate.saveMany', async (req) => {
    await assertProjectAdmin(req);
    const projectId = resolveProjectId(req);
    const { issueType, status, links } = req.payload || {};

    if (!issueType) {
      throw new Error('Vui lòng chọn Issue Type cho tài liệu.');
    }
    if (!status) {
      throw new Error('Vui lòng chọn Status để hiển thị tài liệu.');
    }

    const rows = Array.isArray(links) ? links : [];
    // Mỗi dòng là một "ô tài liệu" cần USER nộp link. Chỉ cần TÊN là hợp lệ.
    const cleaned = [];
    rows.forEach((row, i) => {
      const title = String(row?.title || '').trim();
      if (!title) {
        return; // bỏ qua dòng chưa đặt tên
      }
      const slot = {
        id: generateId('tpl'),
        issueType,
        status,
        title,
        required: row?.required === true,
      };
      // URL tuỳ chọn (tương thích dữ liệu cũ); validate nếu có.
      const url = String(row?.url || '').trim();
      if (url) {
        if (!isValidHttpUrl(url)) {
          throw new Error(`Link #${i + 1} phải bắt đầu bằng http:// hoặc https://`);
        }
        slot.url = url;
      }
      cleaned.push(slot);
    });

    if (cleaned.length === 0) {
      throw new Error('Vui lòng nhập ít nhất một tài liệu (cần có tên).');
    }

    const templates = await readTemplates(projectId);
    templates.push(...cleaned);
    await writeTemplates(projectId, templates);
    return { templates, added: cleaned.length };
  });

  resolver.define('docTemplate.delete', async (req) => {
    await assertProjectAdmin(req);
    const projectId = resolveProjectId(req);
    const { id } = req.payload || {};
    const templates = await readTemplates(projectId);
    const remaining = templates.filter((tpl) => tpl.id !== id);
    await writeTemplates(projectId, remaining);
    return { templates: remaining };
  });

  /* ----- PANEL: review link theo issue ----- */

  // Tìm / preload user để chọn reviewer (gọi backend cho chắc chắn).
  resolver.define('docReview.searchUsers', async (req) => {
    const { query, maxResults } = req.payload || {};
    const users = await searchAssignableUsers(query, maxResults);
    return { users };
  });

  resolver.define('docReview.panel', async (req) => {
    const issueId = resolveIssueId(req);
    const currentUserId = resolveAccountId(req);

    const ctx = await fetchIssueContext(issueId);
    const [templates, reviews] = await Promise.all([
      readTemplates(ctx.projectId),
      readReviews(issueId),
    ]);

    const items = buildPanelItems(
      templates,
      reviews,
      ctx.issueTypeName,
      ctx.statusName
    );

    return {
      items,
      currentUserId,
      currentStatus: ctx.statusName,
      issueType: ctx.issueTypeName,
      statuses: DOC_STATUSES,
    };
  });

  // USER nộp / cập nhật link tài liệu cho một ô (slot). Link lưu theo issue.
  resolver.define('docReview.submitLink', async (req) => {
    const issueId = resolveIssueId(req);
    const currentUserId = resolveAccountId(req);
    const { templateId, url } = req.payload || {};

    if (!templateId) {
      throw new Error('Thiếu thông tin tài liệu.');
    }
    const clean = String(url || '').trim();
    if (!isValidHttpUrl(clean)) {
      throw new Error('Link tài liệu phải bắt đầu bằng http:// hoặc https://');
    }

    const ctx = await fetchIssueContext(issueId);
    const [templates, reviews] = await Promise.all([
      readTemplates(ctx.projectId),
      readReviews(issueId),
    ]);

    const template = templates.find((tpl) => tpl.id === templateId);
    if (!template) {
      throw new Error('Không tìm thấy ô tài liệu này (có thể admin đã xoá).');
    }

    const existing = reviews[templateId];
    if (existing?.status === DOC_STATUSES.APPROVED) {
      throw new Error('Tài liệu đã được duyệt, không thể đổi link.');
    }
    // Nếu đã có người nộp, chỉ người đó mới được đổi link.
    if (existing?.submittedById && existing.submittedById !== currentUserId) {
      throw new Error(
        `Chỉ ${existing.submittedByName || 'người đã nộp link'} mới được đổi link.`
      );
    }

    const now = new Date().toISOString();
    const actorName = await fetchUserDisplayName(currentUserId);
    const isUpdate = Boolean(existing?.url);

    const review = existing || {
      status: DOC_STATUSES.PENDING,
      round: 1,
      history: [],
    };
    review.url = clean;
    review.submittedById = currentUserId;
    review.submittedByName = actorName;
    review.submittedAt = now;
    // Đổi link khi reviewer đang xem -> đưa về pending để review lại từ đầu.
    if (review.status === DOC_STATUSES.IN_REVIEW) {
      review.status = DOC_STATUSES.PENDING;
    }
    review.updatedAt = now;
    pushHistory(review, {
      status: review.status,
      byId: currentUserId,
      byName: actorName,
      at: now,
      reason: '',
      note: isUpdate ? 'Cập nhật link tài liệu' : 'Nộp link tài liệu',
    });

    reviews[templateId] = review;
    await writeReviews(issueId, reviews);

    // Nếu đã có reviewer thì báo cho họ biết link mới.
    if (review.reviewerId) {
      await postComment(
        issueId,
        buildMentionComment(
          review.reviewerId,
          review.reviewerName || 'reviewer',
          [
            {
              type: 'text',
              text: ` link tài liệu “${template.title}” đã được ${
                isUpdate ? 'cập nhật' : 'nộp'
              }, mời review.`,
            },
          ],
          { title: template.title, url: clean }
        )
      );
    }

    const items = buildPanelItems(templates, reviews, ctx.issueTypeName, ctx.statusName);
    return { items, currentUserId, currentStatus: ctx.statusName, issueType: ctx.issueTypeName };
  });

  // Giao / giao lại reviewer cho một link.
  resolver.define('docReview.assign', async (req) => {
    const issueId = resolveIssueId(req);
    const currentUserId = resolveAccountId(req);
    const { templateId, reviewerId } = req.payload || {};

    if (!templateId) {
      throw new Error('Thiếu thông tin tài liệu.');
    }
    if (!reviewerId) {
      throw new Error('Vui lòng chọn người review.');
    }

    const ctx = await fetchIssueContext(issueId);
    const [templates, reviews] = await Promise.all([
      readTemplates(ctx.projectId),
      readReviews(issueId),
    ]);

    const template = templates.find((tpl) => tpl.id === templateId);
    if (!template) {
      throw new Error('Không tìm thấy link tài liệu này (có thể admin đã xoá).');
    }

    const existing = reviews[templateId];
    // Phải nộp link trước khi giao review (không thể review tài liệu chưa có).
    const docUrl = existing?.url || template.url || '';
    if (!docUrl) {
      throw new Error('Vui lòng nộp link tài liệu trước khi giao review.');
    }
    // Nếu đã có reviewer, chỉ owner (người giao đầu tiên) mới được giao lại.
    if (existing?.addedById && existing.addedById !== currentUserId) {
      throw new Error(
        `Chỉ ${existing.addedByName || 'người giao review'} mới được đổi reviewer.`
      );
    }

    const now = new Date().toISOString();
    const [reviewerName, actorName] = await Promise.all([
      fetchUserDisplayName(reviewerId),
      fetchUserDisplayName(currentUserId),
    ]);

    const review = existing || {
      status: DOC_STATUSES.PENDING,
      addedById: currentUserId,
      addedByName: actorName,
      round: 1,
      history: [],
    };
    review.reviewerId = reviewerId;
    review.reviewerName = reviewerName;
    review.status = DOC_STATUSES.PENDING;
    review.rejectReason = '';
    review.addedById = review.addedById || currentUserId;
    review.addedByName = review.addedByName || actorName;
    review.round = review.round || 1;
    review.updatedAt = now;
    pushHistory(review, {
      status: DOC_STATUSES.PENDING,
      byId: currentUserId,
      byName: actorName,
      at: now,
      reason: '',
      note: `Giao review cho ${reviewerName}`,
    });

    reviews[templateId] = review;
    await writeReviews(issueId, reviews);

    await postComment(
      issueId,
      buildMentionComment(
        reviewerId,
        reviewerName,
        [
          { type: 'text', text: ' bạn được giao review tài liệu ' },
          { type: 'text', text: template.title || docUrl, marks: [{ type: 'strong' }] },
          { type: 'text', text: '.' },
        ],
        { title: template.title, url: docUrl }
      )
    );

    const items = buildPanelItems(templates, reviews, ctx.issueTypeName, ctx.statusName);
    return { items, currentUserId, currentStatus: ctx.statusName, issueType: ctx.issueTypeName };
  });

  // Reviewer đổi trạng thái.
  resolver.define('docReview.setStatus', async (req) => {
    const issueId = resolveIssueId(req);
    const currentUserId = resolveAccountId(req);
    const { templateId, status, reason } = req.payload || {};

    if (!VALID_REVIEW_STATUSES.includes(status) || status === DOC_STATUSES.PENDING) {
      throw new Error('Trạng thái không hợp lệ.');
    }

    const ctx = await fetchIssueContext(issueId);
    const [templates, reviews] = await Promise.all([
      readTemplates(ctx.projectId),
      readReviews(issueId),
    ]);

    const template = templates.find((tpl) => tpl.id === templateId);
    const review = reviews[templateId];
    if (!template || !review) {
      throw new Error('Tài liệu chưa được giao review.');
    }
    if (review.reviewerId !== currentUserId) {
      throw new Error(
        `Chỉ ${review.reviewerName || 'người được giao review'} mới được đổi trạng thái tài liệu này.`
      );
    }

    const docUrl = review.url || template.url || '';

    const cleanReason = String(reason || '').trim();
    if (status === DOC_STATUSES.REJECTED && !cleanReason) {
      throw new Error('Vui lòng nhập lý do từ chối.');
    }

    const now = new Date().toISOString();
    const actorName = await fetchUserDisplayName(currentUserId);

    review.status = status;
    review.rejectReason = status === DOC_STATUSES.REJECTED ? cleanReason : '';
    review.updatedAt = now;
    pushHistory(review, {
      status,
      byId: currentUserId,
      byName: actorName,
      at: now,
      reason: cleanReason,
      note: '',
    });

    reviews[templateId] = review;
    await writeReviews(issueId, reviews);

    if (status === DOC_STATUSES.REJECTED) {
      await postComment(
        issueId,
        buildMentionComment(
          review.addedById,
          review.addedByName || 'người tạo',
          [
            { type: 'text', text: ' tài liệu ' },
            { type: 'text', text: template.title || docUrl, marks: [{ type: 'strong' }] },
            { type: 'text', text: ` bị từ chối bởi ${actorName}. Lý do: ` },
            { type: 'text', text: cleanReason, marks: [{ type: 'em' }] },
          ],
          { title: template.title, url: docUrl }
        )
      );
    } else {
      const label = status === DOC_STATUSES.APPROVED ? 'Đã duyệt' : 'Đang review';
      await postComment(
        issueId,
        buildPlainStatusComment(
          `Tài liệu "${template.title || docUrl}" chuyển sang "${label}" bởi ${actorName}.`,
          { title: template.title, url: docUrl }
        )
      );
    }

    const items = buildPanelItems(templates, reviews, ctx.issueTypeName, ctx.statusName);
    return { items, currentUserId, currentStatus: ctx.statusName, issueType: ctx.issueTypeName };
  });

  // Owner gửi lại tài liệu đang bị từ chối.
  resolver.define('docReview.resubmit', async (req) => {
    const issueId = resolveIssueId(req);
    const currentUserId = resolveAccountId(req);
    const { templateId } = req.payload || {};

    const ctx = await fetchIssueContext(issueId);
    const [templates, reviews] = await Promise.all([
      readTemplates(ctx.projectId),
      readReviews(issueId),
    ]);

    const template = templates.find((tpl) => tpl.id === templateId);
    const review = reviews[templateId];
    if (!template || !review) {
      throw new Error('Tài liệu chưa được giao review.');
    }
    if (review.addedById !== currentUserId) {
      throw new Error('Chỉ người giao review mới được gửi lại.');
    }
    if (review.status !== DOC_STATUSES.REJECTED) {
      throw new Error('Chỉ gửi lại được tài liệu đang ở trạng thái Từ chối.');
    }

    const now = new Date().toISOString();
    const actorName = await fetchUserDisplayName(currentUserId);

    review.status = DOC_STATUSES.PENDING;
    review.round = (Number(review.round) || 1) + 1;
    review.rejectReason = '';
    review.updatedAt = now;
    pushHistory(review, {
      status: DOC_STATUSES.PENDING,
      byId: currentUserId,
      byName: actorName,
      at: now,
      reason: '',
      note: `Gửi lại để review (vòng #${review.round})`,
    });

    reviews[templateId] = review;
    await writeReviews(issueId, reviews);

    await postComment(
      issueId,
      buildMentionComment(
        review.reviewerId,
        review.reviewerName || 'reviewer',
        [
          { type: 'text', text: ' tài liệu ' },
          {
            type: 'text',
            text: template.title || review.url || template.url || 'tài liệu',
            marks: [{ type: 'strong' }],
          },
          { type: 'text', text: ` đã được cập nhật, mời review lại (vòng #${review.round}).` },
        ],
        { title: template.title, url: review.url || template.url || '' }
      )
    );

    const items = buildPanelItems(templates, reviews, ctx.issueTypeName, ctx.statusName);
    return { items, currentUserId, currentStatus: ctx.statusName, issueType: ctx.issueTypeName };
  });
}
