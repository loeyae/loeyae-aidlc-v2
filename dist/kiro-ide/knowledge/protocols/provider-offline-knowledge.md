# 离线 Provider 知识交付与宿主确认

Core 从项目 `providers.lock.yaml` 锁定的 Git object database 读取知识，不 fetch、不 checkout、不执行 Provider entrypoint、安装脚本或过滤器。离线读取禁止全部 Git transport，不继承 SSH agent、askpass 或宿主凭证。内容仅作为不可信参考资料，不能授予 state、audit、Evidence 或 Gate 权限。

## 包声明

沿用 repository `aidlc.provider/v1.1` 的 `kind: knowledge` 和既有字段映射。通过已存在的 namespaced `extensions` 明确声明独立协议 `aidlc.knowledge-package/v1`；缺少声明的旧包不会被猜测为可加载。其余 Provider 和 v1.1 Manifest 行为保持兼容。

```yaml
extensions:
  aidlc.knowledge:
    schema: aidlc.knowledge-package/v1
    version: 0.1.0 # 必须等于 Manifest version
    topics:
      - capability_id: framework.conventions
        topic: framework
        sections:
          - id: conventions
            path: knowledge/conventions.md
            digest: sha256:<章节原始 UTF-8 字节的 64 位小写十六进制摘要>
```

每个选中 capability 必须唯一映射到一个 topic；topic 的全部章节都是本次交付内容。章节路径相对于锁定包 subdir，必须是 portable relative POSIX path，拒绝路径逃逸、符号链接、submodule、缺章、摘要不匹配和无效 UTF-8。每个 topic 最多 128 章，总内容最多 4 MiB。

## 最小宿主接口

1. 从 `orchestrate next` 的 `provider_context.plan.id` 和 `provider_actions[].plan_node_id` 获取固定上下文。
2. 执行 `provider knowledge-load --plan <plan-id> --node <node-id>`。返回 `aidlc.knowledge-delivery/v1`，包括实际章节内容、章节摘要、scope、lock、Plan/node 和确定性的 `delivery_digest`。
3. **宿主必须先把返回的全部章节放进当前 execution context**，再执行 `provider knowledge-confirm --plan <plan-id> --node <node-id> --delivery-digest <digest> --consumer <host-session>`。确认代表可信宿主对加载动作的显式声明；摘要回传不能自动证明模型已阅读或理解内容。禁止仅因读取文件成功就自动确认，禁止让 Provider 进程调用此 Core 接口。
4. 执行 `provider knowledge-verify --plan <plan-id> --node <node-id>` 或重新运行 `orchestrate next`。若 Plan 需要审批，next/report 保留相同的 `--provider-approval <approval-ref>`。

没有有效确认时，next 返回 `ask_type: provider-knowledge-confirmation`，不派发阶段；report/reattest 也复验确认，避免直接 report 绕过前置条件。无 Provider 项目不增加该流程。

## 回执与信任边界

Core 签发既有 `aidlc.knowledge-receipt/v1.1`（`issuer: aidlc-core`、`gate_eligible: false`），并放入新协议 `aidlc.knowledge-confirmation/v1`。外层包含 `receipt`、`delivery_digest`、`consumer`、`expires_at` 和 `signature`。签名使用与受控 Evidence 相同的 Core 本地 HMAC signer；密钥位于 Git common directory，不交给 Provider。只有整个签名封装通过验证，回执才被接受；单独的 receipt_digest 不能证明签发身份。

确认保存在 `.aidlc/provider-knowledge/knowledge-<delivery digest 前 32 位>.json`，有效期 24 小时。验证重新读取锁定章节并重算交付摘要，核对签名、Plan/node、项目 lock、scope、版本、当前源码 revision 和有效期。下一次 next 的 Resolver 重新解析当前 Profile、policy 与 binding；变化将生成不同 Plan，从而要求新的确认。知识加载和确认不写 workflow state/audit。

知识 Provider 的 `provider run` 被拒绝，不能通过知识 entrypoint 签发 accepted Evidence。知识确认不能作为 `provider gate --evidence` 输入，不能满足 validation Gate。本轮不变更混合知识/验证 Plan 的 Gate 聚合协议，也不新增 MCP 默认注册或修改共享宿主配置。

项目专属章节与模板由外部知识包维护，Core 仅引用实际技术事实、锁定知识与受控验证结果。共享 MCP 服务的用途应单独核实，知识迁移不授权删除宿主已有配置。
