The diagram CLI uses a Git-locked external `diagram.visual` host adapter. Core retains validation and evidence authority. The adapter ships the DOM geometry/computed-style recipe and launches an installed browser in an isolated profile. It has no dependency installer, MCP registration, shared browser attachment, or evidence signer.

Review the external package before explicitly authorizing host execution. This executes reviewed package code with the operator's OS privileges; a Git lock provides integrity, not sandboxing. It is separate from `restricted-v1`, whose restrictions remain unchanged. The subprocess receives only its data request and OS path variables, excluding credentials and Node startup configuration.

First configure `.aidlc/provider-git-policy.json` to allow the repository host and reviewed immutable commit. Then install and lock the package using the existing Provider CLI:

```sh
loeyae-aidlc provider add ssh://git@git.dev.loeyae.com:31022/libraries/loeyae-aidlc-provider.git \
  --ref <reviewed-full-commit> --subdir providers/diagram-visual \
  --instance diagram --capability diagram.visual --stage <stage> \
  --trust allowlisted-commit
loeyae-aidlc diagram-provider run --request assets/diagram.provider-request.json \
  --evidence .aidlc/evidence/<stage>/<scope>/diagram-contract.json \
  --host-provider diagram
```

The stage must be active and the source `diagram-contract` check must have passed. Requests use `version: "1"`, `provider: "diagram.visual"` (historical `chrome-devtools` is accepted), `target_operation: "preview"` or `"render"`, and explicit `normal`, `fit`, `zoom` viewports. `--browser <absolute-installed-executable>` can select another installed browser. `--dry-run` only validates the plan. No execution implicitly downloads anything.

Preview validates browser presentation; render validates and captures browser rendering. Both require all three views and bind their operation into the invocation. Export is unsupported. Remote URLs, file URL navigation, active SVG content, external resources and output paths outside the active evidence directory are rejected. SVG data is embedded in a blank isolated page with restrictive CSP and blocked external/file requests.

The external process returns an untrusted `aidlc.visual-candidate/v1`, with request/invocation/lock/input binding and each view's viewport, DOM measurement source, capture time, PNG, accessibility snapshot and digests. Core verifies these, runs every existing expected/actual, layout, style, overflow, edge, arrow, label and structural check, and signs the complete decision with its existing local Provider signer. The orchestrator verifies the signature, current lock, source/expected/sidecar/generation closure, screenshots and snapshots again before accepting PASS. A missing view, unavailable browser, modified input or tampered artifact cannot satisfy the gate.

Reproduce the real browser regression against an immutable external package:

```sh
node node_modules/tsx/dist/cli.mjs tests/test_diagram_visual_provider.ts \
  <provider-repository-path-or-Git-URL> <full-commit> <python-executable>
```

This runs the actual production adapter against the existing eleven geometry/style scenarios. Local Git transport is labeled as such; HTTP/Figma fixtures are not production browser evidence. The adapter closes only its own browser and profile. OS-wide browser process termination is never used.
