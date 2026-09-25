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

## 更新（升级到新版本）

升级到新版本时，按以下四步顺序执行（先清理旧安装，再装新版）：

```bash
# 1. 卸载已部署到各 harness 的资产
loeyae-aidlc uninstall --all

# 2. 从 npm 全局卸载旧的 CLI 包
npm uninstall -g loeyae-aidlc

# 3. 从 npm 全局安装新版本 CLI 包
npm install -g https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz

# 4. 重新部署到所有检测到的 harness
loeyae-aidlc install --all
```

> 说明：`loeyae-aidlc uninstall --all` / `install --all` 的 `--all` 是 CLI 选项（对所有 harness 生效）；`npm uninstall -g` / `npm install -g` 的 `-g` 是 npm 的全局选项。两者不要混用。
>
> 完成后需重启受影响的 harness（如 Kiro Crew / Kiro IDE）以加载新版本。

安装后从明确工作描述开始：

```bash
loeyae-aidlc orchestrate next --scope feature --work "修复订单导出超时"
```

workflow state 和 audit 写入目标项目的 `aidlc/active/`。团队成员使用 unit selection、Git 分支、review、构建、测试和 merge plan 协作交付。