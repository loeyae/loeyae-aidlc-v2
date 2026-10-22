# MARS-35 infrastructure sensor maintenance

Authorization: loeye selected A in Multica comment
`01a15f03-7457-78b1-aa5e-99b613d70349` (2026-10-21).

The business unit manifest and dependency document were checked before editing:
`m19-u02` owns merchant store selection and member history; its implementation
depends on u01/u03. This change belongs to the AI-DLC tool, not merchant runtime
code. It does not change business UC-Ds, contract ownership, deployment authority,
or any workflow stage. Business UC-D coverage and execution counts remain unchanged.

| UC-D / tool contract | Test method | Unit |
|---|---|---|
| No business UC-D; INF-01 truthful design inventory | designPreservesUnprovisioned | AI-DLC infrastructure sensor |
| No business UC-D; INF-02 explicit inventory only | proseCannotConfirmProvisioning | AI-DLC infrastructure sensor |
| No business UC-D; INF-03 deploy responsibility | missingPlanFails | AI-DLC infrastructure sensor |
| No business UC-D; INF-04 environment evidence | provisionedNeedsEvidence | AI-DLC infrastructure sensor |
| No business UC-D; INF-05 deployment remains strict | deploymentRejectsDesignEvidence | AI-DLC infrastructure gate |
| No business UC-D; INF-06 completeness and scope | invalidInventoryFails / cliScopeAndProducer | AI-DLC infrastructure sensor |
| No business UC-D; INF-07 compatibility | legacyProvisionedGate / checkerScopeRegression | AI-DLC infrastructure gate |

Design success is not provisioning or runtime readiness. The source change must
be reviewed through a PR. The global installed package must not be patched.
