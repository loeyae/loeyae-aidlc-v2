---
name: aidlc-build-test-evidence
description: "运行项目真实构建与测试，解释结果并选择最小充分复验范围。"
triggers: 构建测试证据, 测试证据, 构建证据, 生成测试报告, build test evidence, 受控测试证据
---

# build-test-evidence

从项目脚本、配置和现有测试确定真实命令；不因调用方没填写命令矩阵就停止，先读取仓库查明。运行所需构建和目标测试，不要求审查先通过。按影响补必要集成验证，只有广泛影响或明确交付要求才全量。

执行前按 [真实验证](../../knowledge/protocols/verification.md) 限定读取、扫描与输出，产出物和依赖从明确入口定位。保留命令、退出码、关键输出和未验证项。失败后修复并复测受影响部分；相关输入未变时复用已有结果。文档、生成源和合并后的复验按实际影响判断，不按文件扩展名豁免业务检查。

不手工编造通过结果；无法运行时说明真实环境缺口并继续可做的检查。默认不创建证据命令清单、签名 JSON、无行为证明或额外测试汇总文档。

默认由宿主执行，结果和必要业务文档是工作依据；共享边界见 [宿主执行协议](../../knowledge/protocols/host-execution.md)。


涉及接口、数据、安全或配置时按需读取 [工程检查](../../knowledge/protocols/engineering-checks.md)。

所有结论遵循 [统一完成判定](../../knowledge/protocols/completion.md)，未知、失败、过期和外部待办不能省略。
