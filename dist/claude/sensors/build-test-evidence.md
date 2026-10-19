---
sensor: build-test-evidence
---
# Build/Test Evidence

使用受控 producer 运行当前项目允许的 build、test 与 check 命令：

```bash
loeyae-aidlc evidence run --stage build-and-test
```

Evidence 必须：

- 位于当前 directive 的 Evidence 路径；
- 包含合法时间、受控 producer、source revision 和真实命令结果；
- 含有实际适用的成功构建/检查和业务范围至少一个通过测试；角色不适用按 `knowledge/protocols/common-c8-role-applicability.md` 从项目政策和全部模块来源复核，不机械要求三角色；
- Node TAP 接受完整一致的唯一最终汇总，跳过/todo 不计通过，取消/失败/截断/零通过阻断；保留旧数字测试摘要兼容；
- TypeScript 开发依赖可按真实 noEmit check、包脚本和 tsconfig 证明不需要 build；命令/配置/依赖锁/编译器/批准来源漂移失效，产物配置或语义歧义阻断。TAP duration 后仅允许有界、完整的 Node 原生覆盖率表，未知或重复尾部不得忽略；
- 不包含失败测试、越界路径、符号链接或伪造结果。

Agent 不得手写通过 Evidence，也不得用聊天结论代替命令输出。
