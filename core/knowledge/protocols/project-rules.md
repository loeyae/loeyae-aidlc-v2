# 多端项目规范与按需加载

规范的选择不改变目标、质量或权限。先掌握适用的宿主/项目指令；原目标、STORY/AC、契约和消费者关系确定实际影响，不能以改动文件或规则命中数证明目标完整。未知范围先查现有来源，保留缺口，独立工作继续。

## 放置与唯一来源

- 每个独立 Git 仓库用根目录 `AGENTS.md` 作短入口，规范正文放在本仓库 `.agents/rules/`。按端/问题拆分，不按宿主复制正文。
- 跨端共用规范在项目文档仓库 `.agents/rules/common/` 维护一处。现有需求、STORY/AC、CR 和续作记录保持原位置；规则只引用它们，不另建目标、批准、状态或证据台账。
- 多仓库映射仅在一个现有 `AGENTS.md` 中声明。其他仓库入口引用它；独立打开端仓库时也先定位此入口。路径相对该文件，不能把某人的绝对目录当成共享配置。迁移经授权后移走旧正文并修正引用，不长期双写；不要覆盖他人改动或自动批量迁移项目。
- 没有当前布局的旧项目，沿现有入口按端/完整小节读取有效规范，明确缺失和冲突；不因工具尚不可用而补台账、重跑阶段或重新审批。权限和必需质量要求不能被过滤掉。

在已有 `AGENTS.md` 放一个 `aidlc-rules` YAML 代码块，例如（仓库名和 remote 换成实际项目）：

```aidlc-rules
repositories:
  docs:
    root: .
    remote: ssh://git@example.org/team/docs.git
  operation:
    root: ../operation-fe
    remote: ssh://git@example.org/team/operation-fe.git
shared: [docs]
```

每个显式映射都需声明预期 `origin`。工具只核对本地 Git 根与 remote 身份，不联网、不切分支；实施前的远端基线核对仍按[接手规则](project-continuity.md)执行。目录改名、worktree 或 Windows/POSIX 路径不改变端归属。没有映射时仅使用当前 Git 根，标识为 `self`；不猜测其他端。

## 规则声明和匹配

规则正文前用 YAML front matter 声明 `description`，以及 `always: true`、`include`、`tasks` 中适用的选择条件：

```yaml
---
description: 运营端页面与组件的表单实现要求
include: ["src/pages/**", "src/components/**"]
exclude: ["src/components/generated/**"]
requires: ["docs:common/permissions.md"]
---
```

- 仓库内路径相对**该规范所属 Git 根**，支持 `/`、Windows `\` 分隔符，匹配始终区分大小写。`*`、`?` 不跨目录，整段 `**` 跨零到多层目录；多个 `include` 取并集，`exclude` 只减去本规则的路径命中。不支持的 glob、绝对路径和 `..` 不会被静默忽略。用数组代替 brace/extglob。
- `always: true` 是所选端或 `shared` 仓库的最小必需约束，不能同时写 include/exclude/tasks。每个端的基础规则应短小。大型专项说明不设置 always。没有声明不是默认 always；冲突配置必须显式解决。
- `tasks: [ui-mock]` 等名称由当前任务意图明确选择，和路径命中取并集；HTML 文件不自动等于 UI Mock，Dart 文件不自动等于翻译迁移。先读描述再确定任务类型，不能凭模糊关键词跳过必需规则。
- `requires` 指向同仓库相对规则路径，或 `仓库标识:规则相对路径`，均从 `.agents/rules/` 解析。被选规则的依赖必须加载，不受其自身过滤条件排除；依赖循环、缺失来源、仓库身份不符或越界链接需解决，不能当作“不适用”。共用规则不复制到各端。
- 输入包含拟新增文件及受影响的测试、配置、消费者。端已确定但尚无路径时传空数组，先取该端基础要求，再定位细则。跨端 API/行为变化追加实际消费者范围，未实现的原目标和必要集成验收继续保留；不能把其他端全部加载，也不能只看 Git diff。
- 选择结果按权威来源去重；已完整读取且未变的正文复用。任务范围、规则或实际仓库变化时重新选择，不建立跨会话加载状态或缓存账本。冲突按指令层级和实际适用范围处理，局部规则不能降低上位质量、权限与完成约束。

## 按需读取

可选 `loeyae-aidlc rules` 是只读助手，也可由宿主按上述相同语义读取。没有命令调用、报告或回执门禁：

```text
loeyae-aidlc rules catalog --project <映射所在目录> --scope '{"operation":[]}'
loeyae-aidlc rules select --project <映射所在目录> --scope '{"operation":["src/pages/product/new.tsx"]}'
loeyae-aidlc rules load --project <映射所在目录> --scope '{"operation":["src/pages/product/new.tsx"]}' --rule operation:forms.md
```

命令中的 JSON 应按当前 shell 正确传参；可用原生工具等价读取，不为适配命令复制配置。`catalog` 只输出所选仓库与 shared 的规则元信息；仅遍历声明的规则目录，不扫描业务代码、产出物或依赖包。`select` 输出来源与命中原因，完整读取选中的必需正文与依赖；`load` 每次只展开一个已选来源。`--tasks` 接收显式任务名的 JSON 数组。未选择的正文不会输出；空列表、读完规范和 `coverage: not_evaluated` 都不代表完成。

## 宿主入口

`rules adapter --project <目录> --repository operation --host codex|kiro|skill` 只返回可审阅片段，不写文件、不覆盖原入口。将必要片段合并到已有宿主入口，保留原指令；同一份规则正文仍只维护一处。安装全局 AIDLC 不自动改造业务项目。

- Codex：短片段放在端仓库根 `AGENTS.md`，指向唯一映射及按需读取方法。原生 AGENTS 发现沿项目根到启动工作目录；切换目标端时主动加载适用指令，不能假定跨仓库文件编辑会自动注入另一端规则。
- Kiro：入口只含短的 always 导航；端内简单 include 转为同一工作区根下的 `fileMatch` 候选提示。含 exclude/tasks 的条件不能准确转换时用 manual 提示，由统一选择器判断。提示不内联正文，避免多条命中重复展开相同来源。多根工作区在各实际根放对应入口；自定义 Agent/Crew 还需沿宿主现有资源配置加载入口，不能假定 IDE 自动发现适用于所有运行方式。
- 其他宿主：使用 `skill` 片段，通过现有 AIDLC 入口和原生文件读取执行同一选择协议；只有验证了原生匹配能力才启用对应自动适配。宿主权限、用户配置和更高优先级指令保持不变。

迁移时检查旧 always、资源通配符及正文副本，避免宿主先全量注入、AIDLC 随后才过滤。只改本次已授权的相关入口，保留尚未迁移的必需约束；已注入当前上下文的内容不能撤回。工具选择与生成片段的测试不等于实际宿主会话加载证明，更不等于跨端交付完成；如实报告已验证范围，不默认追加完整新会话核验。
