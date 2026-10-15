# Loeyae Boot Provider 安装与运行

本文适用于 `framework.java-loeyae-boot` `0.1.x` 与 Core `aidlc.provider/v1.1`。Core 已完成领域抽离：不再内置任何 Loeyae 专属 stage、sensor、MCP/skill 规则、`is_loeyae_boot` 检测或 compatibility 迁移层。外部 Loeyae Boot Provider 以项目级 Git lock 安装，并通过通用 `code-generation` 生命周期 Hook 注入，挂载能力为 `implementation-validation`。未安装 Provider 时 `code-generation` 行为完全不变。

> 不存在 compatibility / legacy / shadow / enforce 模式，也不存在 `provider compatibility` 命令或 `loeyae-compliance` 阶段。Core 只保留通用 Provider 生命周期 Hook（通用 Resolver / Runner / Gate）。

## 1. 安装并锁定

生产 `https`/`ssh` 来源先在 `.aidlc/provider-git-policy.json` 配置 `allowed_hosts`（可选 `allowed_organizations`），再安装固定 tag 或 commit，并显式绑定到通用 `code-generation` Hook：

```bash
loeyae-aidlc provider add ssh://git@git.dev.loeyae.com:31022/libraries/loeyae-aidlc-provider.git \
  --ref v0.1.0 \
  --subdir providers/loeyae-boot \
  --id framework.java-loeyae-boot \
  --instance loeyae-boot \
  --stage code-generation \
  --capability implementation-validation
```

显式 `--stage code-generation` / `--capability implementation-validation` binding 很重要：Provider 是项目级实例，不在 module/unit 重复安装，也不应因默认通配 binding 出现在无关阶段。安装只执行隔离 Git fetch/对象读取，不运行 entrypoint、hook、submodule、LFS/filter、package manager 或构建脚本。

项目 Profile 示例 `.aidlc/provider-profile.json`：

```json
{
  "version": 1,
  "active": "loeyae-java",
  "profiles": {
    "loeyae-java": {
      "facts": {
        "languages": ["java"],
        "frameworks": ["loeyae-boot"]
      },
      "risk": {"level": "standard", "protected_gate": false}
    }
  }
}
```

Profile selector 决定该 Provider 是否被选中：事实不匹配（selector false/unknown）时不创建可执行 Plan，`code-generation` 退回普通项目行为。领域事实（Loeyae Boot 识别、规则、知识、runtime、检测）全部由 Provider 自身拥有，Core 不感知。

### 离线知识包（独立安装）

实际接收包是同仓的 `providers/loeyae-boot-knowledge`，包含测试基类/工具、Entity 注解、术语、框架版本/Starter 上下文和合规表的实际内容。知识包 commit 为 `2978f09cc86d2643b050e4f79c44115e4f83aea0`；先允许 `git.dev.loeyae.com` 来源并把该 commit 加入项目 `allowed_commits`，再安装：

```bash
loeyae-aidlc provider add ssh://git@git.dev.loeyae.com:31022/libraries/loeyae-aidlc-provider.git \
  --ref 2978f09cc86d2643b050e4f79c44115e4f83aea0 \
  --subdir providers/loeyae-boot-knowledge --instance loeyae-knowledge \
  --trust allowlisted-commit --stage code-generation --capability framework.conventions
```

包为 `kind: knowledge`，通过 `aidlc.knowledge-package/v1` 声明 15 个章节与原始字节摘要。沿用上述 Java / `loeyae-boot` Profile；宿主按 `provider-offline-knowledge.md` 加载当前 Plan/node 的全部章节后显式确认，Core 签发并校验回执。现有 validation 包独立绑定 `implementation-validation`，不能用知识回执代替验证 Evidence 或 GateDecision。

Core 和模板不再强制加载领域 MCP Skill。保留的共享知识服务注册精确位于 `harness/claude/plugin.json`、`harness/kiro-crew/mcp.json`、`harness/qoder/mcp-cn.json` 与 CodeBuddy/Qoder/ZCode 的 `.mcp.json`；该服务还提供 `ai-context-file-guide` 等独立内容，当前离线领域包未替代这些用途，因此本轮不移除共享注册或用户配置。

实际外部包集成验证（会访问该远程固定 commit，不创建合成知识 fixture）：

```bash
npx --no-install tsx tests/test_external_provider_knowledge.ts \
  ssh://git@git.dev.loeyae.com:31022/libraries/loeyae-aidlc-provider.git \
  2978f09cc86d2643b050e4f79c44115e4f83aea0
```

## 2. 运行完整链路

`orchestrate next` 到达 `code-generation` 时，若已安装并被 Profile 选中的 Provider 绑定了该阶段，directive 的 `provider_actions` 会绑定 instance、lock digest、Plan 与 node。仅运行这些动作，并给 Provider 显式只读源码输入：

```bash
loeyae-aidlc orchestrate next
loeyae-aidlc provider run \
  --plan .aidlc/provider-plans/<plan-id>.json \
  --node <plan-node-id> \
  --input source=services/orders/src
loeyae-aidlc provider gate \
  --plan .aidlc/provider-plans/<plan-id>.json \
  --evidence <evidence-id>
loeyae-aidlc orchestrate report \
  --stage code-generation \
  --result completed \
  --gate-decision <gate-id>
```

链路为：add → immutable lock → Profile/selector resolve → directive/Plan → restricted-v1 Request → untrusted Result → Core-signed Evidence → 通用 GateDecision → report。被选中的 `implementation-validation` 动作为 required，orchestrate 在未携带有效通用 GateDecision 时拒绝推进 `code-generation`。Provider 只看到声明输入快照，只写 invocation 的 `output/result.json` 与声明报告；不能写 state/audit/最终 Evidence/Gate。

`provider probe` 必须报告 filesystem/network/environment/process/resources 五项隔离均可落实。当前生产 adapter 是 Linux `bubblewrap + prlimit`；Windows/macOS 会 fail-closed，不能 best-effort 执行。跨平台单元测试使用显式测试 adapter，不等价于生产 sandbox conformance。

## 3. Scope 深度

Profile 决定 Provider 是否适用，scope 只决定 Provider 内部规则/知识深度（由 Provider 自行实现）：

| scope | code-generation Provider 动作 | 深度 |
|---|---:|---|
| `feature` / `enterprise` / `mvp` / `classic` | 选中则执行 | full |
| `bugfix` / `refactor` / `express` / `workshop` | 选中则执行 | targeted，只检查显式输入中的适用规则 |

未安装 Provider 的项目在任何 scope 下 `code-generation` 都不产生 provider 动作，行为与抽离前的非 Loeyae 项目一致。

## 4. 更新与卸载

```bash
loeyae-aidlc provider status loeyae-boot
loeyae-aidlc provider update loeyae-boot --ref <new-tag-or-commit>
loeyae-aidlc provider disable loeyae-boot
loeyae-aidlc provider remove loeyae-boot
```

任何代码、Profile、config、lock 或 Provider 版本变化都要求新 Plan/invocation，不复用旧 Gate。禁止删除或改写已签名 Evidence、复用旧 Gate、或用 waiver/fallback 掩盖 `CHECK_FAILED`。卸载 Provider 后 `code-generation` 立即回到无 Provider 的通用行为。

## 5. 兼容矩阵

| Core | Provider | 协议/能力 | 状态 |
|---|---|---|---|
| Provider 领域抽离后的 Core | `framework.java-loeyae-boot` `0.1.x` | `aidlc.provider/v1.1` + `implementation-validation` | 支持 |
| 未安装任何 Provider | — | — | `code-generation` 行为不变 |
| 非 Loeyae Profile | Loeyae Boot Provider | selector false/unknown | 不创建可执行 Plan |
| Windows/macOS production run | `restricted-v1` | 无完整 OS isolation | fail-closed |

## 6. 发布清单

- [ ] 外部 Provider `npm run typecheck && npm test` 通过，`providers/loeyae-boot/runtime/` 已由 build 打包并包含在待发布 Git commit；
- [ ] `providers/loeyae-boot/conformance/p0-report.json` 为 `passed`，Manifest capability 为 `implementation-validation`，安装说明绑定 `code-generation`；
- [ ] Core typecheck、graph compile/validate、Provider lifecycle/resolver/runner-gate、Provider domain extraction 回归与 restricted-extension 回归通过；
- [ ] Core 不含 `loeyae-compliance`、`framework-compliance`、`is_loeyae_boot` 或 compatibility 层的任何残留（由 `tests/test_provider_domain_extraction.ts` 校验）；
- [ ] Linux CI 的 `provider probe` 五项控制通过，并以真实 `bubblewrap + prlimit` 运行首个 Provider smoke；
- [ ] 本地 bare Git fixture 覆盖 Java/Loeyae Boot、嵌套多模块、非 Loeyae、轻量 scope、source revision/CR 漂移；
- [ ] update/disable/remove 不删除已签名 Evidence、Gate、lock history 或 audit；
- [ ] 发布负责人确认版本 tag、Provider commit、Schema/能力兼容声明。未经确认不创建 tag。
