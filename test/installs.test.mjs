import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNoHosts,
  maskHosts,
  parseInstalls,
  redactHosts,
  slugOf,
} from "../scripts/installs.mjs";

const INSTALLS = { "EU-1": "app.example.com" };

test("INSTALLS must map labels to bare hostnames", () => {
  assert.deepEqual(parseInstalls('{"EU-1":"a.example"}'), {
    "EU-1": "a.example",
  });
  assert.throws(() => parseInstalls('{"EU-1":"https://a.example/"}'));
  assert.throws(() => parseInstalls('{"<b>":"a.example"}'));
  assert.throws(() => parseInstalls('["a.example"]'));
  assert.throws(() => parseInstalls(undefined));
});

test("a label becomes a lowercase slug", () => {
  assert.equal(slugOf("EU-1"), "eu-1");
  assert.equal(slugOf("US East 2"), "us-east-2");
});

test("every host is masked in the log", () => {
  const lines = [];
  maskHosts(INSTALLS, (line) => lines.push(line));
  assert.deepEqual(lines, ["::add-mask::app.example.com"]);
});

test("a host written by a person is replaced by its label", () => {
  assert.equal(
    redactHosts("Restarted APP.example.com twice", INSTALLS),
    "Restarted EU-1 twice",
  );
});

test("data naming a host is refused", () => {
  assert.throws(
    () => assertNoHosts('{"x":"App.Example.com"}', INSTALLS),
    /EU-1/,
  );
  assert.doesNotThrow(() => assertNoHosts('{"x":"EU-1"}', INSTALLS));
});
