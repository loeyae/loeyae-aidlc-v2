# 显式旧受管模式参考

仅在用户明确选择维护旧受管流程或受控 Provider 契约时阅读；默认能力不加载此文件。以下历史规则不覆盖默认宿主协议。


## 默认宿主执行

默认仅对用户尚未授权的重大架构、业务或部署决策请求批准；已有明确批准直接沿用。用对话或现有决策说明记录即可，不要求先获取阶段 directive、完成 sensor 或执行 report。下文正式批准命令仅适用于用户明确要求维护的旧受管流程。 参见 [宿主执行协议](../../knowledge/protocols/host-execution.md)。

## 能力说明与旧受管兼容

# Lightweight Approval

应用设计和部署阶段需要人工决策。

完成当前产物和适用 sensor 后，向用户展示：

- 当前工作描述；
- 当前阶段和关键决策；
- 产物、review、构建/测试状态；
- 影响与风险。

用户明确批准时报告：

```bash
loeyae-aidlc orchestrate report \
  --stage <slug> \
  --result approved \
  --user-input Approve
```

用户要求修改时，保留当前阶段并按反馈修订后重新报告。普通阶段按产物、review、构建和测试门禁推进。