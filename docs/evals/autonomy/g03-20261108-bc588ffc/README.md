# G-03 Codex CLI 实际模型与工具探针

| 项目 | 实际记录 |
| --- | --- |
| Probe ID | g03-20261108-bc588ffc |
| 日期 | 2026-11-08（Asia/Shanghai） |
| 授权 | 用户明确要求核验所选宿主实际模型与工具能力、解决 G-03；暂不修改代码 |
| CLI | 本机 codex-cli 0.164.0，入口 E:/Work/repo/node/codex.ps1 |
| 模型配置 | 继承本机配置 gpt-6.1-sol / high；未传 --model，不更换默认模型 |
| 身份证明范围 | 实际原生模型 turn 完成；模型名依据配置，不声称独立核验服务端模型权重身份 |
| 隔离工作区 | D:/Users/loeye/AppData/Local/Temp/g03-20261108-bc588ffc，仅 input.json/result.json 两个数据文件 |
| CLI 沙箱 | workspace-write；未使用 danger-full-access、关闭审批或关闭 Hook 信任选项 |
| 会话持久性 | ephemeral；本次不验证 resume、自动重启或压缩恢复 |
| 最终结论 | 正常本机外层执行下，实际模型调用及连续三次本地工具执行通过，独立复核通过；受限外层直接嵌套启动失败需保留 |

## 1. 探针输入和实际调用

[prompt.txt](prompt.txt)要求模型仅在临时目录内完成三个独立工具调用：读取 input.json；计算并写 result.json；重新读回并断言。要求不委派、不创建代码/脚本、不读取凭据或其他目录、不操作 AI-DLC 状态。

原始[输入副本](input.json)和[结果副本](result.json)在探针完成后由父进程从临时工作区复制保留。随机 nonce 未在 prompt 中给出；其精确一致性用于证明实际读回，不能靠最终文字猜测通过。

调用参数为 `exec --json --ephemeral --sandbox workspace-write --skip-git-repo-check --cd <临时数据目录> --output-last-message <本次日志目录/last-message.txt> -`，prompt 通过 stdin 传入。目录没有 Git 仓库，因此只跳过仓库存在检查，不放宽命令沙箱。继承正常用户配置与认证，未读取或复制认证文件。

采用 JSONL 与 ephemeral 的行为参考 [OpenAI 官方非交互执行说明](https://learn.chatgpt.com/docs/non-interactive-mode)和[本机选项对应的官方参考](https://learn.chatgpt.com/docs/cli/reference)。实际结果以本目录原始记录为准。

## 2. 两次尝试

| 尝试 | 外层环境 | 实际结果 | 证据 |
| --- | --- | --- | --- |
| 01 | 当前受限父执行环境 | CLI 退出 1；arg0 清理/PATH alias 权限警告，随后初始化 in-process app-server client 拒绝访问；没有模型 JSONL 事件或结果文件 | [stderr](stderr.txt)、[exit](exit.json)、[空事件流](events.jsonl) |
| 02 | 经执行权限审核允许的正常本机环境；保留子 CLI workspace-write 沙箱 | CLI 退出 0；stderr 为空；模型自行连续完成三次命令并正常 turn.completed | [start](attempt-02/start.json)、[events](attempt-02/events.jsonl)、[stderr](attempt-02/stderr.txt)、[exit](attempt-02/exit.json)、[final](attempt-02/last-message.txt) |

第二次开始于 2026-11-08T12:07:43.5065873Z，结束于 2026-11-08T12:08:33.4031346Z，约 49.9 秒。会话事件 thread_id 为 `01a1bb0e-b657-7532-b9ec-c3bb382d2745`。它是此次临时 CLI 探针会话，不是接管现有 AI-DLC workflow 的凭据。

权限上下文改变后启动成功且警告消失，支持将首次失败定位为外层受限环境的启动访问问题；本次没有修改 CLI 安装、用户配置、目录权限或默认模型。未对 OS 拒绝访问点做更底层定位，不声称找到了唯一系统调用根因。不能从成功复验推导任意嵌套沙箱都能运行。

## 3. 模型和工具观察

成功事件流包含 thread.started、turn.started、三组 command_execution started/completed、最终 agent_message 和 turn.completed。三次命令退出码均为 0：

1. 读取 input.json，取得真实 nonce、probe_id 和七个整数。
2. 写 result.json，保存 nonce、probe_id、count、sum 和排序结果。
3. 在单独工具调用中重新读取两个文件并做严格检查，实际输出 `Readback assertions succeeded. Sum: 679`。

父进程随后独立读取临时数据与日志核验，没有采用模型一句“成功”作为通过依据。验证结果保存于[verification.json](verification.json)，原始设置与数据摘要见[manifest.json](manifest.json)。

| 检查 | 结果 |
| --- | --- |
| 原生模型 turn.completed 与 CLI exit=0 | 通过 |
| 三次独立本地命令及其实际退出码 | 通过，0/0/0 |
| 随机 nonce 与 probe_id | 与实际输入一致 |
| count | 7，与实际输入一致 |
| sum | 679，与实际整数求和一致 |
| 排序结果 | 17,29,43,71,113,167,239，与实际输入排序一致 |
| 原始 JSONL 可解析、成功 stderr 为空 | 通过 |
| 无须用户逐步输入“继续” | 此次三步工具循环已观察到 |

实际原生用量事件记录 input_tokens=72726、cached_input_tokens=54144、output_tokens=655；这是本次观察，不是成本或未来性能承诺。

## 4. 能力与结论边界

G-03 的最小模型/工具执行缺口可在此次验证的正常本机环境下关闭。P1 宿主接入应保留已验证入口、正常用户配置、明确隔离工作目录和 workspace-write 沙箱；如果改变宿主配置、权限上下文或工具入口，需要针对性复验。

已证实：实际模型 turn、本地命令执行、数据读取/写入/读回、多步工具循环、结构化事件及原生退出码可观察。

未证实：UI DOM/截图/交互、数小时稳定运行、上下文压缩续作、跨 turn 持续驱动、resume、自动拉起、后继授权、业务试点完成、AI-DLC 新 grant/准入功能。P1 原生驱动适配和完整试点验收仍需按原计划实施。

本目录是宿主能力探针的原始观察和父进程校验，不是 `.aidlc/evidence`，不是 AutonomyPolicy/ExecutionGrant/AdmissionReceipt，也不代表 P1 已编码或交付通过。
