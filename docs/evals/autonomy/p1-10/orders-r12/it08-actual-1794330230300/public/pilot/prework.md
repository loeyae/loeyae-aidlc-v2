# H1-H3 preparation boundary

Read pilot/spec.md as the already selected internal trial scope. Existing architecture is a single local Node service with the frozen transport in pilot/server.cjs and empty public interfaces in src/. Keep that architecture; no new public API, module, service or data model is needed. Use one cohesive project/default unit: API/UI share one service owner and are verified together, so splitting this tiny pilot would add a delivery boundary without independent ownership. This explicitly refines P0's illustrative publish-api/publish-page split. No cross-project dependency is invented.

The scope is express: a bounded implementation of an existing public interface with no UI. Use project/default, matching express routing.

The preparatory Agent may author and validate design/reception documents through normal Core next/report/producers. It must stop at a real approval block or before implementation. It must never seed completed state, approve stages, fabricate operator messages or change src/, tests/, pilot/ or design/. After H3, freeze scope/policy/matrix/preflight and obtain the exact real operator H5 grant; only then run the actual native implementation adapter.
