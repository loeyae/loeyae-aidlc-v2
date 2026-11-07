# C8 按角色适用性与测试统计

普通业务范围始终要求真实 test，至少一个通过且没有失败。build/check 默认必需；缺少命令不是不适用依据。不得复制 check 为 build、增加空 build 脚本或将有业务行为的 I13 改成 not_applicable。

## 可核验的原生 Node 例外（v1）

本轮提供保守、可扩展的原生 Node 适配；其他项目保留默认要求，沿用已有/批准构建和检查工具。没有独立构建步骤的 CommonJS/原生 JS 项目，可由项目已有/明确批准政策在自身 `package.json` 声明：

```json
{
  "scripts": { "test": "node --test tests/native.test.cjs", "check": "node --check router.cjs" },
  "aidlc_validation": {
    "module_id": "project",
    "runtime": "native-node",
    "approval_ref": "approved:REQ-1",
    "build": {
      "status": "not_applicable",
      "reason": "CommonJS 由 Node 直接执行，没有转译或制品生成步骤"
    }
  }
}
```

`approval_ref` 是可追溯的项目政策来源引用，采用已有审批语义，不增加工作流审批阶段，也不是人类身份认证。Agent 不能为绕过失败凭空声称批准。包声明、原因与引用非空，并且模块 ID、运行方式与配置相符才是有效依据。配置中的 build/compile/bundle/transpile/prepare/prepublish/generate 脚本或已识别构建工具与该声明冲突时拒绝例外。

工具依赖存在不等于生产构建。TypeScript **仅作为 devDependency**，且本包有受控 `check` 明确执行 `tsc --allowJs --checkJs --noEmit router.cjs`（或 `node <typescript/bin/tsc> ...`）时，可保留已批准的 build 不适用政策。也支持 `--project/-p`、本地 `tsconfig.json` 的 `compilerOptions.noEmit: true`、JSONC 注释/尾逗号及本地相对 `extends`；输入文件与 project 不能混用。包脚本中的简单 tsc 调用及 `npm run <script> -- ...` 会递归解析，不仅按脚本名称判断。实际命令仍须在宿主可执行，适配器不提供 shell 包装或改变退出码。

适配器使用实际选定 TypeScript 5.x 编译器的解析 API，按被执行命令、所选配置、本地继承及 CLI 覆盖后的最终选项判断。最终 `noEmit: true` 会抑制 JS、声明和映射文件输出；`outDir`、`outFile`、`declarationDir`、`declaration` 等被抑制的设置可合法保留，共享输出配置也可通过 CLI `--noEmit` 用于检查。不能仅按字段存在认定需要构建，也不扫描未被命令或声明脚本消费的 tsconfig。无关配置仍参与正常 source revision 校验，修改后可能需要重验，但其存在本身不要求增加 build。

适配范围仍有界：未知编译器版本/选项、shell 表达式/自定义包装器、无法定位的本地编译器、响应文件、包式/数组继承、references、循环继承均明确诊断。最终允许 emit、增量/composite 的真实 build-info、独立 trace/profile 输出、build/watch 模式及 prepare/generate 等构建流程仍阻断例外；`tsBuildInfoFile` 仅指定路径，不单凭字段判定副产物，实际非法组合或类型错误由真实命令失败阻断。showConfig/help/listFilesOnly/noCheck 等不能代替真实静态检查。声明脚本中的实际构建或未决工具归属仍须分析，不能用闲置配置隐藏必需流程。不能用另一个模块的 noEmit 命令为本包免责，不能把类型检查复制为 build。其他构建工具及其他语言沿用原边界。

在 `.aidlc/commands/build-and-test.json`（或默认 allowlist）加入：

```json
{
  "version": "1",
  "stage": "build-and-test",
  "role_applicability": [
    { "module_id": "project", "package_json": "package.json", "roles": ["build"] }
  ],
  "commands": [
    { "id": "test", "role": "test", "argv": ["node", "--test", "--test-reporter=tap", "tests/native.test.cjs"] },
    { "id": "syntax", "role": "check", "argv": ["node", "--check", "router.cjs"] }
  ]
}
```

没有独立静态检查的原生 Node 项目还可在同一包政策中以 `check: {status:"not_applicable", reason:"..."}` 声明，并把 `check` 加到 roles。已有 check/lint/typecheck 脚本或检查工具与此冲突时拒绝。不适用理由不能替代项目实际必需的检查。

模块清单决定 C8 项目轴全部范围。未声明模块默认仍需 build/check；任一模块需要某角色，就必须执行该角色。聚合命令必须覆盖其负责模块；已配置的每条 build/test/check 都必须执行，`--command-id` 不能漏掉另一模块的构建。模块声明不能重复、使用未知模块或豁免 test；来源必须是项目内普通非符号链接 `package.json`。

producer 保存 `role_applicability`：`kind: native-node-role-policy-v1`、规范化配置摘要、所有模块的 required 角色、包路径/字节 SHA-256/政策。producer、实际 sensor gate、report 和证据重验使用同一个复核函数，重新读取来源、聚合范围和命令。配置、命令或包来源漂移拒绝旧证据，必须重新受控执行；正常 source revision/freshness/session 校验仍适用。未使用新声明的旧证据保持原语义。

使用 TypeScript 检查适配时，模块额外保存 `check_tooling` 输入摘要：命令和声明脚本实际读取的 tsconfig（含本地继承）、依赖锁文件及编译器包/CLI/解析 API 实现。`@execution-context` 仅保存运行时和环境的摘要：按现有 evidence_inputs.environment 契约绑定声明变量及执行器发现变量，未声明时保守绑定环境，排除会话令牌；不写出环境值。producer、gate、report 和重验共用该判断与绑定。上述来源、环境、依赖声明或审批引用变化使旧适用性证据失效；新增适配字段不改变无 TypeScript 的旧角色声明。

编译器语义参考：[noEmit](https://www.typescriptlang.org/tsconfig/noEmit.html)、[incremental](https://www.typescriptlang.org/tsconfig/incremental.html)。noEmit 不保证增量检查没有磁盘副产物。

I13 无行为或批准空 UC-D 子集的既有替代验证单独保留：检查必须真实成功，测试数如实为零；本角色契约不授予零测试豁免。

## Node TAP 与旧格式

Node 的非 TTY 输出可直接使用 TAP；为明确输出格式建议显式 `--test-reporter=tap`，无需另包摘要脚本。解析器要求单个 TAP 13 头、连续根测试编号、完整根 plan、唯一且连续的最终 tests/suites/pass/fail/cancelled/skipped/todo/duration_ms 汇总。嵌套 suite 只采用最终叶测试数，不累计父子结果；多个测试文件由一次 Node runner 的唯一汇总计数。重复/拼接、截断、计数不一致或未知格式阻断，不降级为日志中偶然出现的 passed。

duration_ms 后可紧跟 Node 原生 `# start of coverage report` 至 `# end of coverage report` 表格（如 `--experimental-test-coverage`）：校验固定列头、分隔线、文件/目录行、0–100 的百分比和唯一 all files 行，最多 10000 行/1 MiB。截断、未知尾部、第二份 TAP/摘要或覆盖率表均拒绝；不能任意丢弃尾部。测试计数仍来自同一次真实运行的唯一 TAP 汇总，不重跑测试或要求关闭覆盖率，不新增覆盖率阈值。

`passed = pass`，`failed = fail + cancelled`，`skipped = skipped + todo`，`total = tests`，要求总数一致。退出非零、失败、取消、零通过（包括全 skipped/todo）均阻断。含真实通过的部分 skipped/todo 按项目政策记录，不计为通过。旧数字摘要（例如 `1 passed`）仍受支持，也校验总数；退出 0 从不推导测试数。每条 test 命令必须自身至少一次通过、零失败，C8 汇总须与全部执行记录逐项对账。

参考：[Node 官方 test reporter 文档](https://nodejs.org/download/release/v22.23.0/docs/api/test.html#test-reporters)。报告器输出可能随 Node 版本变化；未识别格式应明确适配，不默认放行。
