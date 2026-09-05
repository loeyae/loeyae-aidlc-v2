---
name: aidlc-docx-beautification
description: "独立 DOCX 检查与保守美化能力：只修改关系解析出的 styles Part，报告直接格式覆盖率并验证所有非样式内容不变；不负责 AI-DLC 阶段路由和完成判定。"
triggers: DOCX 美化, Word 美化, 文档美化, DOCX 检查, Word 样式, docx beautify, docx inspect, docx validate, professional-zh
---

# DOCX 保守美化能力

开始时宣布："使用 aidlc-docx-beautification 进行 DOCX 检查与保守样式美化"。

## 定位

Independent Capability — not an AIDLC phase.

本能力按需检查或美化现有 `.docx`。它不调用 46-stage 主状态机，不更新 `docs/aidlc/aidlc-state.json`、handoff、audit 或 Evidence，也不宣布任何 AI-DLC Stage 完成。

## 输入与写入边界

调用方提供：

- 输入 DOCX 的绝对路径；
- 只读检查、dry-run 或写入目标；
- 写入时必须提供与输入不同的显式绝对输出路径；
- 可选内置 preset，当前仅支持 `professional-zh`；或严格 allowlist 的自定义 JSON Style Spec；
- 目标已存在时，只有用户明确授权替换才使用 `--force`。

永不原地覆盖或修改源 DOCX。临时验收产物写入会话 scratch 或用户明确指定的安全位置，不写回源目录。不得把真实业务文档复制进源码仓库。

## 标准流程

严格按以下顺序执行：

1. `docx inspect`：只读检查 OPC 结构、安全边界、正文统计、样式、直接字体和 theme-font 引用；
2. `docx beautify --dry-run`：先输出角色映射、跳过角色、直接格式覆盖率和保守模式预计有效覆盖率；
3. `docx beautify --output`：仅在输出路径和写入授权明确后生成新文件；
4. `docx validate --against`：验证 Part 集合不变、所有非 styles Part 字节完全相同、正文文本不变。

```bash
loeyae-aidlc docx inspect "/absolute/path/input.docx" --json

loeyae-aidlc docx beautify "/absolute/path/input.docx" \
  --preset professional-zh \
  --dry-run \
  --json

loeyae-aidlc docx beautify "/absolute/path/input.docx" \
  --output "/absolute/path/output.docx" \
  --preset professional-zh \
  --json

loeyae-aidlc docx validate "/absolute/path/output.docx" \
  --against "/absolute/path/input.docx" \
  --json
```

自定义 Style Spec 与 `--preset` 互斥：

```bash
loeyae-aidlc docx beautify "/absolute/path/input.docx" \
  --output "/absolute/path/output.docx" \
  --style-spec "/absolute/path/style-spec.json" \
  --json
```

## 保守变换契约

- styles Part 必须通过主文档 relationships 解析，不假定固定路径；
- 只允许该 styles Part 改变；`document.xml`、relationships、媒体、批注、脚注、尾注、修订及其他 Part 必须保持原字节；
- 保留所有直接格式，不清理段落或 run 的直接属性；
- 样式角色优先依据 `w:name` 和样式类型匹配，不把裸数字 style ID 当通用标题别名；
- 自定义 Style Spec 只接受已定义的字体、颜色、字号、段落、标题和表格属性，未知字段或任意 XML 均拒绝；
- 输出采用同目录临时文件、静态复核、fsync 和原子替换；`--force` 失败时恢复旧输出或保留可恢复备份。

## 状态与验收

- dry-run 状态为 `DRY_RUN`；
- 写入和 `validate --against` 通过只表示 `STATIC_PASS`；
- `visual_validation` 未经 Microsoft Word 或 LibreOffice 真实打开/渲染时必须为 `not_run`；
- 没有真实渲染证据时不得声明视觉 `PASS`；
- 直接格式会覆盖样式时，必须原样报告 coverage 和 warning，不得按“已映射段落数”虚报实际美化效果。

## 禁止事项

不得：

- 原地覆盖源文件；
- 修改 `document.xml` 或执行语义重写；
- 清理直接格式、接受修订、删除批注或替换媒体；
- 通过 DOCX→Markdown→DOCX、整包重建或任意 XML 脚本绕过 styles-only 契约；
- 访问外部 relationship 目标或上传文档；
- 把静态包级校验表述为 Word/LibreOffice 视觉通过；
- 更新 AI-DLC state/audit、推进 Stage 或创建 Git commit。

## 输出

最终报告至少包含：输入与输出绝对路径、输入/输出 SHA-256、preset 或 Style Spec 摘要、样式角色映射、coverage、changed parts、不变量结果、`visual_validation`、warnings，以及是否创建 Git commit。
