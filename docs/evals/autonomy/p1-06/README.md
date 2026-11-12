# P1-06 工程与原生验证

本目录记录一个实际 Codex 宿主接入，复用 app-server Supervisor、现有 grant/session binding 和正式 Core 路由。它不是实际业务批准、完整试点交付或批次 verified。

## 实际检查

| 检查 | 结果与原始记录 |
| --- | --- |
| 宿主网关/预算/取消/精确领取 | [28 场景](native-host-final.log) |
| 持续路由/准入刷新/多单元切换/诚实终止 | [10 场景](native-driver-final.log) |
| P1-01/02/03 | [44](autonomy-scope-verified.log) / [55](autonomy-policy-verified.log) / [48](execution-grant-verified.log) 场景通过 |
| P1-04 | [40 场景](admission-verified.log)、[首次原生路由](admission-route-verified.log)、[3 项预检](dependency-preflight-verified.log) |
| P1-05 | [20 主要场景](dependencies-verified.log)、[20 边界](boundaries-verified.log) |
| 现有会话/split/交接/摘要 | [session](sessions-verified.log)、[layout](layout-verified.log)、[handoff](handoff-verified.log)、[summary](delivery-summary-verified.log) |
| Runner/原执行策略/I13 RED GREEN | [runner](provider-runner-verified.log)、[policy](execution-policy-verified.log)、[TDD gates](tdd-gates-verified.log) |
| 类型检查 | [最终 TypeScript](typecheck-final.log) |
| 实际 Native 配置/模型/工具/取消/浏览器 | [最终日志](native-adapter-final.log)、[原始观察](native-adapter-raw.json)、[Core 适配器结果](native-adapter-result.json)、[实际 PNG](native-browser.png) |
| prepare 后同 thread 复用 | [实际会话结果](native-session-result.json)、[实际读回](native-session-reverified.log) |
| 构建/分发 | [十种 Harness 构建成功](build-results.json)、[2868 文件一致性通过](distribution-parity.log) |

最终命令、选择的成功日志和源码摘要在 [verification.json](verification.json)，原生失败及中间成功观察均保留，不能只取一句最终文字。[双轴审查](code-review.md) 是工程维护审查，不是业务 C7 证据。

## 原生观察与边界

实际二进制为本机 Codex，版本以 [host-version.log](host-version.log) 为准。继承配置中的 gpt-6.1-sol，不另选模型、不读取/复制认证文件、不修改用户 Codex 配置。Core 适配器在隔离临时项目实际调用模型：两次动态工具读取 nonce，同一原生 thread；第三次使用 turn/interrupt，并在观测自有命令 close 后才认定对账完成。预算来自同一受限 kernel，拒绝已过期限的操作；原生模型不是预算授权来源。

实际 Chrome 使用新的临时 profile，保留默认浏览器沙箱，执行受控本地页面的 DOM click handler，捕获 DOM 和 PNG。它证明基础 DOM/截图/脚本点击能力，不证明用户坐标命中、业务交互链、视觉还原或 PAGE/状态/角色覆盖；这些仍属于 P1-07。截图原始字节也在 raw observation 中绑定，不只记录文件名。

协议测试使用隔离 Git 项目、模拟操作终端批准和测试接收 adapter；它们不被计为实际人类批准。原生 probe 与这些夹具分开，未给当前项目创建实际 grant、issuer、admission receipt 或 host attempt。

## 限制与保全

只接入 Codex Harness。PreToolUse 对工具覆盖存在原生限制，支持的副作用经结构化网关核验；冻结命令的声明 footprint 仍须按可信操作约定审阅，不声称解析任意 shell、抵抗恶意 OS 程序或回滚外部副作用。预算实现限于现有 wall-time、等价重试和单并发契约，没有美元或 Token 硬配额承诺。

同一 P1 grant 的已存在 attempt 不自动重启，不因此清零预算或接管未知命令。P2 的自动拉起/后继授权/跨进程业务恢复、P1-07 的业务/UI 断言、P1-08 的候选/批次终态、P1-09 的完整两个无人值守试点仍未验收。未运行完整 npm test 或完成真实业务批次。

当前 DeepSeek state/audit 的哈希及未新增授权目录的检查在 verification.json；没有操作该业务 workflow。分发清理仅针对验证过边界、无 reparse point 的本工作区 dist/<harness>，Windows 文件占用与有界恢复记录在 cleanup-results.json，构建器和权限未修改。

接口依据：[OpenAI 官方 app-server](https://learn.chatgpt.com/docs/app-server) 与 [官方 Hook 覆盖及拒绝约定](https://learn.chatgpt.com/docs/hooks)；本机运行结果优先于文档中未实测的能力。

