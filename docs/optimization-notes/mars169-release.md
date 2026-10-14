# MARS-169 4.17.0 integration

The follow-up user instruction authorizes a version upgrade, merge into main,
commit and push. The earlier implementation-only restriction on merging is
superseded for this integration. No tag or package publication is requested.

Version 4.17.0 reflects the new document-slices CLI, consistency sensor and business
load-plan capabilities. Updated package/lock root, source graph version, all six
plugin/marketplace source manifests and the changelog. Regenerated all nine harness
distributions with the existing builder; generated files were not hand-edited.

Validation for the version change:

- `npm run typecheck`: passed.
- `npm run build:all`: passed; 39 stages and all nine harnesses.
- Version consistency audit: 24 package/plugin/marketplace/graph documents plus
  package-lock root agree on 4.17.0; `node bin/cli.js version` prints 4.17.0.
- `npx --no-install tsx tests/run_mars169_validation.ts distribution`: checks
  source/distribution byte parity and executes the full slice integration suite
  plus installed-tool checks for each of the nine harnesses. Results are retained
  in mars169-command-logs/distribution-results.json and the corresponding logs.

The previously captured full npm test and affected-regression baseline failures
remain disclosed in mars169-validation.md. A version-only change does not claim to
repair those historical failures or make the full pipeline green.

Existing .gitattributes, .gitignore, .kiro/settings/cli.json, untracked AGENTS.md,
.multica and attachments are excluded from commits and preserved locally.
