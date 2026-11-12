// @ReqId REQ-001 / AC-001: complete ordered export with unchanged upstream failures.
// UC-D-001 pagination; UC-D-002 independent calls; UC-D-003 failure propagation.
// GAP-001: retain the single exported async function and existing public interface.
exports.exportOrders = async upstream => {
  const rows = await upstream();
  const pages = [];
  for (let offset = 0; offset < rows.length; offset += 50) {
    pages.push(rows.slice(offset, offset + 50));
  }
  return pages;
};
