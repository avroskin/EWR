'use strict';

const assert = require('assert/strict');
const config = require('../server/storage/sqliteStore').readConfig({});
const fixtures = require('../server/domain/routeFixtures');
const { calculateRouteSuggestions, applyRouteSuggestions } = require('../server/domain/routeRules');

function pickSuggestionFields(suggestion) {
  return {
    windowKey: suggestion.windowKey,
    status: suggestion.status,
    entry: suggestion.entry,
    exit: suggestion.exit
  };
}

function assertSuggestions(fixture, actual) {
  assert.deepEqual(
    actual.suggestions.map(pickSuggestionFields),
    fixture.expect.suggestions,
    fixture.name
  );
}

function assertPreservedPort(fixture) {
  if (!fixture.expect.preservedPort) return;
  const expected = fixture.expect.preservedPort;
  const actual = fixture.voyage.portCalls.find(portCall => portCall.port === expected.port);
  assert.ok(actual, `${fixture.name}: expected preserved port ${expected.port}`);
  assert.equal(actual.eta, expected.eta, `${fixture.name}: omitted port ETA should be preserved`);
  assert.equal(actual.ets, expected.ets, `${fixture.name}: omitted port ETS should be preserved`);
  assert.equal(actual.omit, expected.omit, `${fixture.name}: omitted port flag should be preserved`);
}

function assertAppliedFields(fixture, suggestions) {
  if (!fixture.expect.applied) return;
  const applied = applyRouteSuggestions(fixture.voyage, suggestions);
  for (const [field, expected] of Object.entries(fixture.expect.applied)) {
    assert.equal(applied[field], expected, `${fixture.name}: ${field}`);
  }
}

function main() {
  for (const fixture of fixtures) {
    const result = calculateRouteSuggestions(fixture.voyage, config);
    assertSuggestions(fixture, result);
    assertPreservedPort(fixture);
    assertAppliedFields(fixture, result.suggestions);
  }

  console.log(`Route rule fixtures OK: ${fixtures.length} cases.`);
}

main();
