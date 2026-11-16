---
name: aidlc-continuity
description: Continue from actual code, Git and verification using native host tools.
---

# 继续实施

按[项目接手与资料收敛](../../knowledge/protocols/project-continuity.md)恢复原始目标，实施前先核实远端实际工作分支、已有修复及本地是否包含它们，保护未提交成果；本地 main 和旧交接不是最新实现的保证。再核对适用结果与未决操作，只处理真实未完成项，已有修复不重做。可选 `loeyae-aidlc work` 只读查看相关摘要，不代表已核实远端，也不是恢复前提；缺交接文档时调查已有来源，不要求重建阶段身份或补凭据。

只补真实缺口及相关输入变化所需的检查，未变结果继续引用，不因接手而全目录扫描、重审整模块用例或重写所有关联文档。纠正会影响当前实施、消费或验收的权威资料；新事实只归回原记录，有效导航保持稳定引用。保留尚无实现的目标、必需检查和外部待办，不以收窄工作冒充完成。跨人或跨宿主的授权适用性见 [授权边界](../../knowledge/protocols/permissions.md)，收口遵循 [完成判定](../../knowledge/protocols/completion.md)。

只剩提交或推送时，按[提交与推送续作](../../knowledge/protocols/project-continuity.md#提交与推送续作)复用已加载规则和适用证据，核对新增差异、远端整合与原 hook，不重新启动整轮实施验证。Git 已有明确损坏证据时，先核对 hook 的仓库定位方式并选定可行恢复路径，避免在相同故障下连续重试；健康仓库按授权独立推进，保护原成果和他人改动。
