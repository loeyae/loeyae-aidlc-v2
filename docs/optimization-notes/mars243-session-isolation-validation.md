# MARS-243 会话隔离验证记录

基线：main / 98f955f，4.20.0。实现使用独立 worktree；不升级版本、不合并 main、不发布包，不操作真实业务流程或宿主全局配置。

## 已实现

- Stop 只读、允许保留 running 阶段；不扫描无绑定会话的其他流程，不调用 sensors 或 evidence producer，不自动 report/park。
- Markdown claim 记录 owner/session/generation/handoff；绑定包含项目 realpath、workflow ID 和精确 instance，module/unit 从 instance 派生。旧八列 claim 可读；写入需显式绑定。
- `module inspect|bind|transfer` 与 `next --preview`；未过期领取可按明确人类指令转交，支持无副作用 preview、parked 当前实例 resume。预期领取 token 使用字段排序后的摘要，转交不重试覆盖。
- 专用 ownership CAS 仅接受目标 claim/selection 与精确 parked resume，禁止改变产物阶段、审批、历史或其他领取。保存路径检查当前会话与代次，心跳/选择/report/park/next 拒绝旧绑定。
- 本地 evidence 与 Provider accepted Evidence、GateDecision、knowledge receipt 在同一 workflow 锁内复验会话快照后发布；report 的审计与模块 checkpoint 在提交锁内收尾，长任务计算不持锁，旧代次完成后仍不能发布。
- 九套 harness 入口与交接协议更新；OpenCode 显式传 session_id，其他 hook 使用原生 JSON 输入。缺少 host session ID 时使用显式会话局部 binding。

## 失败复现

修复前运行 `node node_modules/tsx/dist/cli.mjs tests/test_mars243_stop.ts`：无领取的 Provider 安装会话 A 被 m11 的 application-design 阶段阻断，实际 stdout 为 decision=block，并要求继续或 park。断言要求空 stdout，测试失败。复现仅使用临时 fixture。

## 定向验证

- `npm run test:mars243`：通过。包含七种 hook 格式、同 owner 不同 session、旧写入拒绝且 state/audit 字节不变、并发转交单方提交、在途受控命令产证拒绝发布、split/global/integration、parked resume、过期续领与旧 claim 往返；另验证真实模块 report 在提交锁内生成 Git checkpoint。
- `node node_modules/tsx/dist/cli.mjs tests/test_construction_tdd_gates.ts`：通过。fixture 使用显式领取，保留 I13/RED/GREEN 原有准入准出断言。
- `node node_modules/tsx/dist/cli.mjs tests/test_provider_runner_gate.ts`：通过。独立 Provider restricted runner、Evidence 与 GateDecision 回归。
- `python tests/test_platform_hooks.py`：通过。使用实际 CLI/hook 与临时 HOME、安装目录。
- `npm run typecheck`、`npm run build:all` 与 distribution parity：通过，2292 个文件、九套 harness 一致。

## 边界与迁移

人类来源引用是审计记录，不是 CLI 对真实人类身份的认证；宿主必须从真实用户指令调用 transfer。Provider/文档/agent 输出不能授权接管。引擎防护不承诺阻止任意进程直接编辑磁盘。

旧脚本必须迁移到 preview → inspect/bind → 写入；不能继续凭 owner 字符串推进。历史全量 CLI fixture 未全量迁移/运行；本次按影响执行上述定向集，未执行全量 npm/Maven 测试。原 `test_v4_3_module_workflows.ts` 的整条历史迁移链未执行，本次用同类临时 state/registry fixture 覆盖已存在单流程及拆分布局的会话隔离。

整项目 archive/split/upgrade 与 state recover/adopt/rebuild 不能借一个拆分 workflow 的 binding 扩大到其他 workflow；需单独安排静止状态下的维护交接。没有自动 Stop 的 KiroCrew、Qoder CN Desktop 仅提供启动/续作显式绑定。七类格式通过 CLI fixture 验证，未逐一启动真实宿主做端到端验证。
