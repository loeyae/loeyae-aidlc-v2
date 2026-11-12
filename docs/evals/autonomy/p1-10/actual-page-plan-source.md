# UI 页面计划 — SCENARIO-001 / REQ-001

Author and technical planner: Codex (GPT-6), actual AI model. The formal ui-page-planning@module:project route uses notify and choices=[]. This plan records source-derived semantics, not human approval or stage completion. One project/default ownership boundary is preserved.

## 页面清单
| ID | 端 | 页面名称 | 类型 | 来源 | 改造基础 | 目标代码文件 | 角色与权限 | 状态差异 |
|----|----|----------|------|------|----------|--------------|------------|----------|
| PAGE-001 | web | Publish item | 局部改动 | REQ-001; STORY-001 / US-001; AC-001–AC-012 | Existing / route and title/control/result group verified by read-only inventory in design-reference.md; independent frozen reference is the design baseline | src/web.html | editor; Publish only for ready; Retry after recoverable failure; View result after success | ready, draft, error, published; retry is error-to-published |

One existing page covers the four state variants. No additional form, modal, list or result UI page is introduced. /result remains the existing service response endpoint. Target-file identification is inventory only and never design-source precedence.

## 页面内容契约
| 页面 ID | 可见字段/组件 | 输入与展示约束 | 条件可见性 | 来源引用 |
|---------|---------------|----------------|------------|----------|
| PAGE-001 | Page title | Read-only text Publish item | All four states | REQ-001; PAGE-001; design-reference.md |
| PAGE-001 | Publication control | One control, label Publish; enabled only for a ready item | ready enabled; draft disabled | US-001; AC-001,AC-004; RULE-PUBLISH,RULE-DRAFT |
| PAGE-001 | Recovery control | Same control becomes Retry and remains enabled; diagnostic output cannot disable it | Recoverable error | AC-007,AC-008,AC-011; RULE-RETRY |
| PAGE-001 | Terminal control | Same control becomes disabled Published after genuine API success | published | AC-002; RULE-PUBLISH |
| PAGE-001 | Status message | Exact copy Ready to publish. or Draft cannot publish. or Failed. Please retry.; messages are read-only | Matches ready/draft/error respectively | AC-001,AC-004,AC-007,AC-011 |
| PAGE-001 | Result entry | Read-only View result link to existing /result endpoint | Visible only after actual publication success | AC-002,AC-003 |

No editable form fields, required-field validation, columns, masking or extra empty state is specified. Item readiness is existing trial state, not a new user-entry field. Unpublished service result state pending is API data and does not introduce a fifth page state. Detailed visual facts belong to the frozen reference registry and later Mock reception, not this semantic plan.

## 操作闭环
| 来源页面 | 按钮/入口 | 目标页面或反馈 | 来源引用 |
|----------|-----------|----------------|----------|
| PAGE-001 ready | Publish | Existing POST /publish; success updates same page to published and exposes View result; recoverable failure stays on page with Failed. Please retry. and enabled Retry | REQ-001; US-001; AC-001,AC-002,AC-007; ACTION-PUBLISH |
| PAGE-001 draft | Disabled Publish | No enabled UI action; direct API bypass must return 400/not-ready | AC-004,AC-005,AC-006; RULE-DRAFT and RULE-DRAFT-API |
| PAGE-001 error | Retry | Existing POST /publish without transient trigger; success updates same page to published; repeat failure retains actionable Retry and fixed visible error | AC-007,AC-008,AC-011; ACTION-RETRY |
| PAGE-001 published | Disabled Published | No further publication action introduced | AC-002 |
| PAGE-001 published | View result | Existing /result endpoint confirms persisted publication in the same service lifetime | AC-003; ACTION-VIEW-RESULT |

## 跨端数据流
| 产生端/页面 | 数据或动作 | 消费端/页面 | 来源引用 |
|-------------|------------|-------------|----------|
| PAGE-001 editor ready | Publish or Retry request to existing POST /publish | Same local Node service owns publication and result memory | REQ-001; AC-002,AC-008 |
| Existing local Node service | Actual success or recoverable failure response | PAGE-001 updates to published or error; no DOM-only success | AC-002,AC-007,AC-009 |
| Direct draft caller | POST /publish bypass | Same service returns 400/not-ready without publishing | AC-005,AC-006 |
| Existing result memory | GET /result published/state fields | Editor follows View result and can read persistence | AC-003 |

## 页面范围、角色和状态对账
US-001 is the quality alias of STORY-001, not a second story. All twelve ACs remain in scope. AC-005/AC-006/AC-009 require API observations and have no extra UI field/page; retaining those defenses does not expand the visual surface. AC-010/AC-012 retain the complete frozen panel and mandatory controls at both 800x600 and 390x844. Ready, draft, published, error, and the retry journey must all be checked. This source review does not assert actual API tests or image alignment.

The independent frozen reference registry is design-reference.md. Its provenance, exact source identities and visual facts are recorded there. Later Mock generation must use those references, preserve source immutability and execute the full native reception/alignment gates. The existing target is confirmed only for local-change classification. No implementation/test code or transport/source/design edits are authorized by this plan.

## 未决项
无

## Scope and review boundaries
No missing product fact affecting page count, fields, permissions or action destinations was identified from the supplied sources. GAP-001 already permits console-only diagnostic details with no visible change. Real Core block approvals, including application-design if routed, remain pending for their actual review stage. No operator grant, autonomous adoption or human approval is asserted.

## Structured UI source
```aidlc-quality
{
  "version": "1",
  "delivery_scope": "publish-pilot-h1-h3",
  "inputs": [
    "docs/aidlc/modules/project/inception/requirements.md",
    "docs/aidlc/modules/project/inception/user-stories.md",
    "docs/aidlc/modules/project/inception/user-stories/role-permission-matrix.md",
    "docs/aidlc/modules/project/inception/ui-design/design-reference.md",
    "docs/aidlc/modules/project/inception/ui-design/design-decisions.md"
  ],
  "interaction_mode": "explanatory",
  "regions": [
    {
      "id": "REGION-PUBLISH",
      "page_id": "PAGE-001",
      "change": "modified",
      "stories": [
        "US-001"
      ],
      "acs": [
        "AC-001",
        "AC-002",
        "AC-003",
        "AC-004",
        "AC-005",
        "AC-006",
        "AC-007",
        "AC-008",
        "AC-009",
        "AC-010",
        "AC-011",
        "AC-012"
      ],
      "required_states": [
        "ready",
        "draft",
        "error",
        "published"
      ],
      "states": [
        {
          "id": "ready",
          "condition": "editor has a ready item before publication",
          "behavior": "Enabled Publish; Ready to publish.; title Publish item",
          "source": "user-stories.md#AC-001"
        },
        {
          "id": "draft",
          "condition": "editor has a draft item",
          "behavior": "Disabled Publish; Draft cannot publish.; direct draft POST remains rejected by API",
          "source": "user-stories.md#AC-004"
        },
        {
          "id": "error",
          "condition": "recoverable API failure for a ready item",
          "behavior": "Enabled Retry; Failed. Please retry.; console detail cannot alter visible feedback",
          "source": "user-stories.md#AC-007"
        },
        {
          "id": "published",
          "condition": "real publication succeeds",
          "behavior": "Disabled Published; View result link to /result; service result confirms publication",
          "source": "user-stories.md#AC-002"
        }
      ],
      "base_structure": {
        "path": "docs/aidlc/modules/project/inception/ui-design/design-reference.md",
        "sha256": "ce38055ea78fe92fc9c6fd71721f05366ed730e375109ba1cb47ede84f742e7d"
      },
      "structure_changed": true,
      "decision": "Restore the existing page's publication group using the complete frozen independent panel; do not use the defective starter as design authority. Preserve title, action control and result area."
    }
  ],
  "actions": [
    {
      "id": "ACTION-PUBLISH",
      "region_id": "REGION-PUBLISH",
      "page_id": "PAGE-001",
      "target": "PAGE-001",
      "label": "Publish",
      "condition": "editor and item ready",
      "success": "Disabled Published and View result after real POST success; actual /result confirms publication",
      "failure_required": true,
      "failure": {
        "condition": "recoverable API failure",
        "behavior": "Failed. Please retry. with enabled Retry; no false success"
      },
      "asynchronous": true,
      "result_entry": "ACTION-VIEW-RESULT",
      "local": true,
      "stories": [
        "US-001"
      ],
      "acs": [
        "AC-001",
        "AC-002",
        "AC-007",
        "AC-009"
      ]
    },
    {
      "id": "ACTION-RETRY",
      "region_id": "REGION-PUBLISH",
      "page_id": "PAGE-001",
      "target": "PAGE-001",
      "label": "Retry",
      "condition": "editor and ready item after recoverable failure",
      "success": "Actual successful POST changes same page to published and exposes View result",
      "failure_required": true,
      "failure": {
        "condition": "recoverable failure persists",
        "behavior": "Keep Failed. Please retry. and enabled Retry"
      },
      "asynchronous": true,
      "result_entry": "ACTION-VIEW-RESULT",
      "local": true,
      "stories": [
        "US-001"
      ],
      "acs": [
        "AC-007",
        "AC-008",
        "AC-011"
      ]
    },
    {
      "id": "ACTION-VIEW-RESULT",
      "region_id": "REGION-PUBLISH",
      "page_id": "PAGE-001",
      "target": "/result",
      "label": "View result",
      "condition": "real publication succeeded",
      "success": "Existing service endpoint confirms published=true and state=published",
      "failure_required": false,
      "failure_exemption": "The selected product scope defines success/persistence for this existing read endpoint; no additional error page or unsupported UX is invented.",
      "asynchronous": false,
      "result_entry": true,
      "local": false,
      "stories": [
        "US-001"
      ],
      "acs": [
        "AC-002",
        "AC-003"
      ]
    }
  ],
  "ui_review": "docs/aidlc/modules/project/inception/ui-design/ui-review.json"
}
```
