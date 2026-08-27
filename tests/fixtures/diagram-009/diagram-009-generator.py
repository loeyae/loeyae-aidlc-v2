import json
import os
from pathlib import Path

if os.environ.get("AIDLC_DIAGRAM_ID") != "diagram-009":
    raise SystemExit("unexpected diagram id")
route_config = json.loads(os.environ["AIDLC_ROUTE_CONFIG_JSON"])
expected_edges = {"edge-005", "edge-048", "edge-008", "edge-041", "edge-015"}
if set(route_config.get("affected_edge_ids", [])) != expected_edges:
    raise SystemExit("route config did not contain the independent affected edges")
expected_path = Path(os.environ["AIDLC_EXPECTED_CONTRACT_PATH"])
if not expected_path.is_file():
    raise SystemExit("expected contract path is not readable")
manifest_path = Path("diagram-009.diagram.json")
manifest = json.loads(manifest_path.read_text())
manifest["diagrams"][0]["generation"]["route_config"] = route_config
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False))
print("diagram-009 route config accepted")
