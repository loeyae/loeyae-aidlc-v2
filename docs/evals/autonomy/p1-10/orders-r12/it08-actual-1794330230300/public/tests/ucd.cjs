// REQ-001 / AC-001: Native tests for UC-D-001, UC-D-002 and UC-D-003.
const assert = require('node:assert/strict');
const { exportOrders } = require('../src/orders.cjs');

async function actualUpstream() {
  const origin = process.env.PILOT_ORIGIN;
  assert.ok(origin, 'The real pilot upstream origin is required');
  const response = await fetch(origin + '/version');
  assert.equal(response.status, 200);
  const version = await response.json();
  assert.equal(version.ready, true);
  assert.equal(version.version_digest, 'p110-upstream-v1');
  assert.equal(version.owner, 'internal-pilot');
  assert.match(version.candidate_commit, /^[0-9a-f]{40}$/);
  return origin;
}

function retrieval(origin, count) {
  const state = { calls: 0, expected: undefined, failure: undefined };
  state.upstream = async () => {
    state.calls++;
    try {
      const response = await fetch(origin + '/upstream?count=' + count);
      assert.equal(response.status, 200);
      const rows = await response.json();
      state.expected = structuredClone(rows);
      return rows;
    } catch (error) {
      state.failure = error;
      throw error;
    }
  };
  return state;
}

async function successfulExport(state) {
  let pages;
  let failure;
  let rejected = false;
  try {
    pages = await exportOrders(state.upstream);
  } catch (error) {
    rejected = true;
    failure = error;
  }
  // An actual transport/setup failure must not masquerade as a product RED.
  if (state.failure) throw state.failure;
  assert.equal(rejected, false, 'Export must fulfill for a successful upstream: ' + String(failure));
  assert.equal(state.calls, 1, 'Fetch the complete list exactly once');
  assert.ok(Array.isArray(pages), 'Export returns an array of pages');
  for (const page of pages) assert.ok(Array.isArray(page), 'Each page is an array');
  assert.deepEqual(pages.flat(), state.expected, 'Preserve every upstream row and value in order');
  return pages;
}

// UC-D-001: all prescribed boundary counts; expected rows come from the same retrieval.
exports['UC-D-001'] = async function orderedPagination() {
  const origin = await actualUpstream();
  const boundaries = [
    [0, []], [1, [1]], [49, [49]], [50, [50]],
    [51, [50, 1]], [100, [50, 50]],
    [101, [50, 50, 1]], [120, [50, 50, 20]]
  ];
  for (const [count, sizes] of boundaries) {
    const state = retrieval(origin, count);
    const pages = await successfulExport(state);
    assert.deepEqual(pages.map(page => page.length), sizes, 'Page sizes for count=' + count);
    assert.equal(state.expected.length, count, 'Actual upstream returned the requested cardinality');
    for (let index = 0; index < pages.length; index++) {
      assert.ok(pages[index].length > 0 && pages[index].length <= 50);
      if (index < pages.length - 1) assert.equal(pages[index].length, 50);
    }
  }
};

// UC-D-002: separate real retrievals, no result or pagination state shared across calls.
exports['UC-D-002'] = async function independentCalls() {
  const origin = await actualUpstream();
  const firstState = retrieval(origin, 120);
  const first = await successfulExport(firstState);
  assert.deepEqual(first.map(page => page.length), [50, 50, 20]);
  const firstSnapshot = structuredClone(first);
  const secondState = retrieval(origin, 1);
  const second = await successfulExport(secondState);
  assert.deepEqual(second.map(page => page.length), [1]);
  assert.deepEqual(first, firstSnapshot, 'The second call cannot mutate the first result');
  const thirdState = retrieval(origin, 0);
  const third = await successfulExport(thirdState);
  assert.deepEqual(third, []);
  assert.deepEqual(first, firstSnapshot, 'The empty call cannot mutate the first result');
  assert.deepEqual(second.flat(), secondState.expected);
  assert.deepEqual([firstState.calls, secondState.calls, thirdState.calls], [1, 1, 1]);
};

// UC-D-003: real timeout, real HTTP error, focused object identity and independent recovery.
exports['UC-D-003'] = async function failurePropagation() {
  const origin = await actualUpstream();
  let timeoutCalls = 0;
  let timeout;
  await assert.rejects(exportOrders(async () => {
    timeoutCalls++;
    try {
      await fetch(origin + '/slow', { signal: AbortSignal.timeout(20) });
      return [];
    } catch (error) {
      timeout = error;
      throw error;
    }
  }), error => {
    assert.equal(timeoutCalls, 1, 'Invoke the actual timeout callback exactly once');
    assert.ok(timeout, 'The real HTTP request must produce a timeout');
    assert.equal(timeout.name, 'TimeoutError');
    assert.strictEqual(error, timeout, 'Propagate the exact original network timeout');
    return true;
  });
  assert.equal(timeoutCalls, 1);

  let errorCalls = 0;
  let upstreamError;
  await assert.rejects(exportOrders(async () => {
    errorCalls++;
    const response = await fetch(origin + '/ucd-003-missing-upstream');
    assert.equal(response.status, 404);
    upstreamError = Object.assign(new Error('Actual upstream HTTP 404'), {
      status: response.status, body: await response.json()
    });
    throw upstreamError;
  }), error => {
    assert.equal(errorCalls, 1);
    assert.ok(upstreamError, 'The real upstream must supply the HTTP error response');
    assert.strictEqual(error, upstreamError, 'Propagate the original HTTP boundary error');
    assert.deepEqual(error.body, { error: 'not-found' });
    return true;
  });
  assert.equal(errorCalls, 1);

  const original = Object.assign(new Error('Distinct upstream failure'), { code: 'EUPSTREAM' });
  let focusedCalls = 0;
  await assert.rejects(exportOrders(async () => {
    focusedCalls++;
    throw original;
  }), error => {
    assert.strictEqual(error, original);
    assert.equal(error.code, 'EUPSTREAM');
    return true;
  });
  assert.equal(focusedCalls, 1);

  const recoveryState = retrieval(origin, 51);
  const recovered = await successfulExport(recoveryState);
  assert.deepEqual(recovered.map(page => page.length), [50, 1]);
};
