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

每个选中 capability 必须唯一映射到一个 topic；v1 交付 topic 的全部章节，v2 仅交付符合当前模块事实和版本条件的章节。章节路径相对于锁定包 subdir，必须是 portable relative POSIX path，拒绝路径逃逸、符号链接、submodule、缺章、摘要不匹配和无效 UTF-8。每个 topic 最多 128 章，总内容最多 4 MiB。

## 按模块事实匹配的可选技术包

技术专属章节使用 `aidlc.knowledge-package/v2`；每章必须声明 `requires`。
AND 数组中每项为 `dependency` 与 `exact`，或数值三段版本的 `minimum`（含）和
`maximum_exclusive`（不含）；`{ "any_of": [AND数组, AND数组] }` 支持最多 16 个替代条件。
内容仍是不可信参考资料，项目规范和批准技术决策优先，章节不能自行改变技术选择。

项目显式登记批准的模块身份和根目录，不根据目录名、PC/移动端或旧 handoff 标记猜测框架：

```json
{
  "schema": "aidlc.module-facts/v1",
  "modules": [
    { "id": "web", "root": "apps/web" },
    { "id": "service", "root": "services/api" }
  ]
}
```

保存到 `.aidlc/module-facts.json`。每模块仅读取本根目录下 `package.json`、
`package-lock.json`（npm v2/v3）、`pom.xml` 的直接依赖。坐标为 `npm:vue` 或
`maven:org.springframework.cloud:spring-cloud-starter-gateway` 等真实包身份。
`package.json` 的精确 `packageManager`（如 `pnpm@9.15.0`）提供对应 `runtime:pnpm` 工具事实。
精确依赖版本直接采用；简单 npm `^`/`~` 范围仅在模块内 lock 的根依赖声明一致且解析版本
满足范围时采用。没有经核验的显式有效版本声明时，缺版本、继承/BOM、属性变量、其他包管理器、tag、workspace/git
依赖及未支持的 prerelease 范围保持 unknown；清单/lock 或明确声明版本不一致为 conflict。
不会运行安装脚本、构建文件、Provider 代码、远程查询或自动解析父目录。

其他可信事实通过模块的 `declarations` 数据列表显式补充，例如：

```json
{
  "id": "web", "root": "apps/web",
  "declarations": [
    { "dependency": "runtime:node", "version": "18.20.8", "decision": ".aidlc/decisions/web-runtime.json" }
  ]
}
```

引用文件限 `.aidlc/decisions/<name>.json`，内容为
`{ "schema": "aidlc.module-decision/v1", "module_id": "web", "approved": true,
"dependencies": [{ "dependency": "runtime:node", "version": "18.20.8" }] }`。
这代表项目已确认的事实，不能由包生成批准；不得用来掩盖与真实清单的冲突。
不允许任意字段、路径逃逸、符号链接或超过 2 MiB 的来源文件。

可选外部包位于 Provider 仓的 `providers/vue-element-knowledge`、`uniapp-knowledge`、
`spring-cloud-knowledge`、`spring-testing-knowledge`、`runtime-knowledge`，另有仅供旧项目迁移参考的
`legacy-security-reference`（必须显式批准 `convention:legacy-security-reference` 版本 `1.0.0`；不从库名猜测，旧密码样例不作为新实现建议）。capability 为
`tech.<目录名>`。按实际需求安装并显式绑定模块及阶段，例如
`provider add <Git-URL> --ref <immutable-commit> --subdir providers/vue-element-knowledge
--instance web-knowledge --module web --stage code-generation --capability tech.vue-element-knowledge`。
安装、信任和锁定沿用既有 Git Provider 策略；知识加载不增加网络或凭据。

Resolver 只给兼容模块派发知识动作；完全不匹配或未启用包零加载，无领域占位。
显式要求但缺少必需知识时给出缺失/unknown/conflict 诊断，不回退旧固定规则。
同项目多个模块各自读取版本，只有兼容章节进入上下文；Spring Cloud 不代表所有组件启用。
原版本表、旧运行时镜像和代码例保存在包中，仅兼容事实才允许加载，不作为默认或升级建议。

delivery 包含 `module_facts`：相对来源路径、原始字节摘要、依赖坐标、版本来源、状态及
`facts_digest`。每次 load/confirm/verify 都重读，事实、兼容章节或锁变化会改变 delivery
摘要，旧签名确认不再适用。缺省 registry 不触发递归探测；普通无包项目沿用自身规范。
旧 handoff 技术标记仅作迁移线索，须核验真实模块事实后才建立显式绑定。

## 最小宿主接口（执行）

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
