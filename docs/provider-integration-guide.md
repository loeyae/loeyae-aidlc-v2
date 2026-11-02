# Provider 分仓集成验证

协议 SDK、Loeyae Boot 验证器和各声明包独立发布。每个待验证的领域 Provider 都应登记自己的 Git 来源、固定 commit 和干净 checkout，不能用协议仓的一个 revision 代表全部 Provider。

## 配置与执行

准备项目外或 `.artifacts/` 中的 JSON 配置，路径使用绝对路径：

```json
{
  "schema": "aidlc.integration-providers/v1",
  "providers": {
    "ssot-readonly": {
      "source": "<Git URL>",
      "revision": "<40-character commit SHA>",
      "checkout": "<absolute checkout path>"
    },
    "design-resource": {
      "source": "<Git URL>",
      "revision": "<40-character commit SHA>",
      "checkout": "<absolute checkout path>"
    }
  }
}
```

```bash
npm run test:provider-integration -- --providers /absolute/providers.json --output /absolute/results
# 定向验证时显式选择 Provider；不是整个集成矩阵通过的结论
npm run test:provider-integration -- --providers /absolute/providers.json --only ssot-readonly,design-resource
```

可登记的领域名称为 `loeyae-boot`、`loeyae-boot-knowledge`、`ssot-readonly`、`design-resource`、`figma-existing`、`figma-create`、`diagram-visual`、`technical-knowledge` 和 `document-render`。后两者是独立能力，缺少其仓库时不能用已有知识包或设计包代替。运行前需准备 Python 3；Windows 可用进程级 `AIDLC_TEST_PYTHON` 指定实际解释器。

入口会核验每个 checkout 的 HEAD 和已跟踪文件。未提供但属于本次选择范围的 Provider 记为 `not_verified` 并返回非零；显式未选择项记为 `not_selected`。结果保留各 Provider 的来源和 commit，不把未验证项计为通过。原有单仓 `--source/--revision/--checkout` 参数仍可用于兼容布局，不能与 `--providers` 混用。

## 协议与实现验证器

协议仓和 Loeyae Boot 验证仓分别执行 `npm run typecheck`、`npm test`。跨仓 wire 校验还需要先在协议仓执行 `npm run build`，再从 Core 运行真实 Runner 回归：

```powershell
$env:AIDLC_PROVIDER_PROTOCOL_CHECKOUT = 'C:\src\loeyae-aidlc-provider'
npx --no-install tsx tests/test_provider_runner_gate.ts
```

这条回归把实际 Runner 生成的请求交给 SDK，校验返回的 Result，并保留 Runner 的权限、错误结果和 Gate 拒绝测试。当前公开 wire API 使用 Core Request/Result；旧内部 DTO 只能经协议 SDK 的显式 Legacy API 使用，不按字段自动降级。

## 知识版本与验证范围

Loeyae Boot 知识包 v2 的适用下限为维护者确认的 `3.0.0-SNAPSHOT`，不设上限。范围匹配需要批准的模块版本事实；父 POM、BOM、变量无法直接解析时，使用 `.aidlc/module-facts.json` 中引用已批准 `.aidlc/decisions/*.json` 的精确版本声明，不从 handoff 推断。未知或冲突版本不加载章节。该范围是知识选择策略，不等于所有后续框架版本均已完成逐版本运行验收。

Figma、SSOT 和设计资源集成测试使用锁定的实际 Provider 包与本地协议服务 fixture。通过这些测试不能证明生产账户、OAuth 或远程创建能力可用；生产创建声明为 `unsupported` 时继续阻断，不用 fixture 代替授权。
