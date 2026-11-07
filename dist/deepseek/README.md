# DeepSeek Harness

通过 DeepSeek Harness（`dsh`）原生文件系统 Skill 加载 AI-DLC。

```bash
loeyae-aidlc install --harness deepseek
```

默认安装到 `~/.dsh/skills/loeyae-aidlc/`。设置 `DSH_HOME` 时安装到该目录的 `skills/loeyae-aidlc/`；空白值视为未设置，支持 `~`、`~/` 和 `~\` 前缀。CLI 的 `install --list` 显示本次实际目标。使用 `--all` 时仅在 PATH 找到 `dsh` 才自动安装；通过 `npx` 或源码运行的用户可以显式指定 harness。

项目级安装使用现有项目根目录：

```bash
loeyae-aidlc install --harness deepseek --project /absolute/path/to/project
```

目标为 `<项目>/.dsh/skills/loeyae-aidlc/`，不同时安装用户级 Skill。DeepSeek Harness 以最近的 `.git` 祖先作为项目根；没有 `.git` 时使用当前工作目录，请将 `--project` 指向同一目录。`--target` 可用于自定义 Skill 包目录，调用者需确保其位于宿主扫描范围。配置中的显式 `dshHome` 或 `customSkillDirs` 可通过 `--target` 对齐。

在 dsh 会话中加载 `loeyae-aidlc` Skill，给出明确工作目标。CLI 在业务项目目录执行，包内阶段和协议按需读取。嵌套 `skills/` 是包资源，不会被 dsh 递归加入技能目录。

升级重新执行同一安装命令。卸载使用相同范围：

```bash
loeyae-aidlc uninstall --harness deepseek
loeyae-aidlc uninstall --harness deepseek --project /absolute/path/to/project
```

安装器使用资产所有权、冲突检测和事务回滚。适配不注册 Stop Hook；启动/续作按会话协议显式 bind，阶段完成仍通过 Core 门禁。

自定义 dsh 插件组合需加载 `@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-skill-filesystem` 和 `@deepseek-ai/dsh-tool-skill`，并允许扫描安装目录。关闭默认扫描根时需在 `customSkillDirs` 中配置相应 Skill 根目录。

接入契约核对于 2026-11-07：[官方文件系统 Skill 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md)、[官方 Home 路径规则](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/home-paths/README.md)。
