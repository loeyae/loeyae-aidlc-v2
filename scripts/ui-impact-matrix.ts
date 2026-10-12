#!/usr/bin/env tsx
/**
 * 向后兼容入口。实际实现位于 core/tools/aidlc-ui-governance.ts，因而会随 9 个 harness 分发。
 * 推荐使用：loeyae-aidlc ui <impact-matrix|dry-run|lock|accept|check> ...
 */
import { runUiGovernanceCli } from "../core/tools/aidlc-ui-governance";

runUiGovernanceCli(process.argv.slice(2)).catch((error) => {
  console.error(`UI governance blocked: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
