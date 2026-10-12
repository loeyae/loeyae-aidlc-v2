# Loeyae Boot Provider 安装、迁移与回滚

本文适用于 `framework.java-loeyae-boot` `0.1.x` 与 Core `aidlc.provider/v1.1`。Provider 以项目级 Git lock 安装，`loeyae-compliance` 仅作为迁移期 compatibility adapter；通用挂载能力为 `implementation-validation`。

## 1. 安装并锁定

生产 `https`/`ssh` 来源先在 `.aidlc/provider-git-policy.json` 配置 `allowed_hosts`（可选 `allowed_organizations`），再安装固定 tag 或 commit：

```bash
loeyae-aidlc provider add https://github.com/loeyae/loeyae-aidlc-provider.git \
  --ref v0.1.0 \
  --subdir providers/loeyae-boot \
  --id framework.java-loeyae-boot \
  --instance loeyae-boot \
  --stage loeyae-compliance \
  --capability implementation-validation
```

显式 `--stage` / `--capability` binding 很重要：Provider 是项目级实例，不在 module/unit 重复安装，也不应因默认通配 binding 出现在无关阶段。安装只执行隔离 Git fetch/对象读取，不运行 entrypoint、hook、submodule、LFS/filter、package manager 或构建脚本。

项目 Profile 示例 `.aidlc/provider-profile.json`：

```json
{
  "version": 1,
  "active": "loeyae-java",
  "profiles": {
    "loeyae-java": {
      "facts": {
        "languages": ["java"],
        "frameworks": ["loeyae-boot"],
        "profiles": ["is_loeyae_boot"]
      },
      "risk": {"level": "standard", "protected_gate": false}
    }
  }
}
```

非 Loeyae 项目不应声明这些事实；Core 的 `is_loeyae_boot` 条件和 Provider selector 会在 Plan 前排除它。

## 2. Feature flag 与迁移顺序

```bash
# 默认：只使用原 framework-compliance
loeyae-aidlc provider compatibility

# 双写观察：旧门禁权威，Provider blocked/差异只读留痕
loeyae-aidlc provider compatibility --mode shadow --instance loeyae-boot

# 切换：Provider Gate 权威；无旧 Evidence 时生成兼容投影
loeyae-aidlc provider compatibility --mode enforce --instance loeyae-boot

# 回滚：不删除任何旧/新 Evidence、Gate 或对账报告
loeyae-aidlc provider compatibility --mode legacy
```

配置写入 `.aidlc/provider-compatibility.json`。模式进入 ProviderPlan policy digest；切换模式后旧 Plan/Gate 不能跨模式复用，必须重新 `next → run → gate`。

| 模式 | 权威 | blocked Provider Gate | framework-compliance |
|---|---|---|---|
| `legacy` | 旧 sensor | 不创建 ProviderPlan | 原 controlled producer |
| `shadow` | 旧 sensor | 可作为当前、已签名的对账输入，但不代表放行 | 原 controlled producer |
| `enforce` | Provider Gate | 阻断 | 缺失时从 accepted Provider Evidence 投影；已有旧记录不覆盖 |

## 3. 运行完整链路

`orchestrate next` 的 `provider_actions` 会绑定 instance、lock digest、Plan 与 node。仅运行这些动作，并给 Provider 显式只读源码输入：

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
  --stage loeyae-compliance \
  --result completed \
  --gate-decision <gate-id>
```

链路为：add → immutable lock → Profile/selector resolve → directive/Plan → restricted-v1 Request → untrusted Result → Core-signed Evidence → GateDecision → report。Provider 只看到声明输入快照，只写 invocation 的 `output/result.json` 与声明报告；不能写 state/audit/最终 Evidence/Gate。

`provider probe` 必须报告 filesystem/network/environment/process/resources 五项隔离均可落实。当前生产 adapter 是 Linux `bubblewrap + prlimit`；Windows/macOS 会 fail-closed，不能 best-effort 执行。跨平台单元测试使用显式测试 adapter，不等价于生产 sandbox conformance。

## 4. Scope 深度

Profile 决定 Provider 是否适用，scope 只决定规则/知识深度：

| scope | 调用 | 深度 |
|---|---:|---|
| `feature` / `enterprise` / `mvp` / `classic` | 必须（Loeyae Boot） | full |
| `bugfix` / `refactor` / `express` / `workshop` | 必须（Loeyae Boot） | targeted，只检查显式输入中的适用规则 |

轻量 scope 不能整体跳过 Provider。没有适用规则时保留逐 Rule `not_applicable`；对已识别的 Loeyae 代码变更，适用规则数为 0 会在 compatibility reconciliation 中标记 `PROVIDER_NO_APPLICABLE_RULES`，`enforce` 模式阻断。

## 5. 双写对账和诊断

每个 Gate 生成不可变对账产物：

```text
.aidlc/provider-reconciliation/loeyae-compliance/<module>/<unit>/<gate-id>.json
.aidlc/provider-reconciliation/loeyae-compliance/<module>/<unit>/<gate-id>.md
```

JSON/Markdown 同时保留：旧 `checks_total/checks_failed/status`、Provider Evidence/commit/invocation、source revision、Rule ID、severity、文件/行位置、差异码和回滚动作。差异码包括：

- `LEGACY_NOT_READY`
- `STATUS_MISMATCH`
- `CHECK_TOTAL_MISMATCH`
- `CHECK_FAILED_MISMATCH`
- `SOURCE_REVISION_MISMATCH`
- `PROVIDER_NO_APPLICABLE_RULES`

`shadow` 中差异保留但旧 sensor 仍权威；`enforce` 中差异阻断。任何代码、Profile、config、lock、规则集或模式变化都要求新 Plan/invocation，不修改旧结论。

## 6. 更新与回滚

```bash
loeyae-aidlc provider status loeyae-boot
loeyae-aidlc provider update loeyae-boot --ref <new-tag-or-commit>
loeyae-aidlc provider compatibility --mode shadow
# 对账稳定后
loeyae-aidlc provider compatibility --mode enforce
```

回滚优先切回 `legacy`；若需要回退 Provider 版本，再显式 `provider update --ref <previous-commit>`。禁止删除或改写旧 Evidence、复用旧 Gate、用 waiver/fallback 掩盖 `CHECK_FAILED`。

## 7. 兼容矩阵

| Core | Provider | 协议/能力 | 状态 |
|---|---|---|---|
| MARS-150～154 Provider Core | `framework.java-loeyae-boot` `0.1.x` | `aidlc.provider/v1.1` + `implementation-validation` | 支持 |
| 未配置 compatibility 文件 | 任意 | 默认 `legacy` | 旧 workflow 兼容 |
| 非 Loeyae Profile | Loeyae Boot Provider | selector false/unknown | 不创建可执行 Plan |
| Windows/macOS production run | `restricted-v1` | 无完整 OS isolation | fail-closed |

## 8. 发布清单

- [ ] 外部 Provider `npm run typecheck && npm test` 通过，`providers/loeyae-boot/runtime/` 已由 build 打包并包含在待发布 Git commit；
- [ ] `providers/loeyae-boot/conformance/p0-report.json` 为 `passed`，Manifest capability 为 `implementation-validation`；
- [ ] Core typecheck、graph validate、Provider lifecycle/resolver/runner-gate、MARS-154 E2E 与 restricted-extension 回归通过；
- [ ] Linux CI 的 `provider probe` 五项控制通过，并以真实 `bubblewrap + prlimit` 运行首个 Provider smoke；
- [ ] 本地 bare Git fixture 覆盖 Java/Loeyae Boot、嵌套多模块、非 Loeyae、轻量 scope、source revision/CR 漂移；
- [ ] shadow 的 matched/mismatch 均产生 Rule/路径报告；enforce 缺旧 Evidence 时产生兼容投影；
- [ ] update/disable/remove/rollback 不删除旧 Evidence、Gate、lock history 或 audit；
- [ ] 发布负责人确认 P0～P5、版本 tag、Provider commit、Schema/能力兼容声明。未经确认不创建 tag。
