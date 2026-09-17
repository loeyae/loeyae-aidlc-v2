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
- 含有成功构建、通过的检查和至少一个通过测试；
- 不包含失败测试、越界路径、符号链接或伪造结果。

Agent 不得手写通过 Evidence，也不得用聊天结论代替命令输出。