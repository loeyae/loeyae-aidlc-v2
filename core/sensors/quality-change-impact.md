# quality-change-impact

Quality v1 adopted workflows only. Use the controlled semantic producer. The
requirements `aidlc-quality` section is authoritative for the artifact graph and
before/after change records. All consumed source bytes are hashed. Empty changes
are explicit, never an exemption from recording the artifact inventory.

Changed bytes invalidate prior evidence. Product changes on an adopted code
baseline or completed code generation require the existing CR route. Conductor
updates workflow state; the checker only reports failures. Preserve UI acceptance
and targeted freshness checkpoints. Errors: CHANGE_IMPACT_UNMAPPED,
CHANGE_EVIDENCE_STALE, CHANGE_REVERIFY_MISSING, CHANGE_ROUTE_INVALID.
