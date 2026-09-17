# Loeyae AI-DLC 安装

安装包分发 AWS-style 轻量 AI-DLC workflow 到支持的 harness。

```bash
npm install -g https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
loeyae-aidlc install
```

可指定 harness：

```bash
loeyae-aidlc install --harness kiro-crew
loeyae-aidlc install --harness kiro-ide
loeyae-aidlc install --harness claude
loeyae-aidlc install --all
```

安装后从明确工作描述开始：

```bash
loeyae-aidlc orchestrate next --scope feature --work "修复订单导出超时"
```

workflow state 和 audit 写入目标项目的 `aidlc/active/`。团队成员使用 unit selection、Git 分支、review、构建、测试和 merge plan 协作交付。