// The owned client supplies the only side-effect gateway. No arbitrary shell parsing.
let input = "";
process.stdin.on("data", b => { input += b; if (input.length > 1048576) process.exit(2); });
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const allow = event.tool_name === "aidlc_action";
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: allow ? "allow" : "deny", permissionDecisionReason: "Use the bound AI-DLC structured gateway; native side effects are not authorized by this client." } }));
  } catch { process.exitCode = 2; }
});
