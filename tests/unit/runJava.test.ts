import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildJavaArgs } from "../../src/core/runner/runJava.ts";
import { setGVisorOverride } from "../../src/config/index.ts";

describe("buildJavaArgs", () => {
  afterEach(() => {
    setGVisorOverride(null);
  });

  const dir = "/tmp/javatest";
  const containerId = "runner-java-test-1";

  it("should run javac + java via a shell", () => {
    setGVisorOverride(false);
    const args = buildJavaArgs(dir, containerId);
    const shellIdx = args.indexOf("/bin/sh");
    assert.ok(shellIdx >= 0);
    assert.equal(args[shellIdx + 1], "-c");
    assert.equal(args[shellIdx + 2], "javac /app/Main.java && java -cp /app Main");
  });

  it("should use the runner-java image", () => {
    setGVisorOverride(false);
    const args = buildJavaArgs(dir, containerId);
    assert.ok(args.includes("runner-java"));
  });

  it("should set the container name so timeout cleanup can target it", () => {
    setGVisorOverride(false);
    const args = buildJavaArgs(dir, containerId);
    const nameIdx = args.indexOf("--name");
    assert.ok(nameIdx >= 0);
    assert.equal(args[nameIdx + 1], containerId);
  });

  it("should apply Java-specific resource overrides", () => {
    setGVisorOverride(false);
    const args = buildJavaArgs(dir, containerId);
    assert.ok(args.includes("--memory=128m"));
    assert.ok(args.includes("--cpus=1"));
    assert.ok(args.includes("--pids-limit=100"));
    assert.ok(args.includes("--network=none"));
  });

  it("should include the full security posture", () => {
    setGVisorOverride(false);
    const args = buildJavaArgs(dir, containerId);
    assert.ok(args.includes("--cap-drop=ALL"));
    assert.ok(args.includes("--security-opt=no-new-privileges"));
    assert.ok(args.includes("--read-only"));
    const tmpfsIdx = args.indexOf("--tmpfs");
    assert.ok(tmpfsIdx >= 0);
    assert.ok(args[tmpfsIdx + 1].includes("size=64m"));
  });

  it("should include gVisor runtime when available", () => {
    setGVisorOverride(true);
    const args = buildJavaArgs(dir, containerId);
    assert.ok(args.includes("--runtime=runsc"));
  });

  it("should NOT include gVisor runtime when unavailable", () => {
    setGVisorOverride(false);
    const args = buildJavaArgs(dir, containerId);
    assert.ok(!args.includes("--runtime=runsc"));
  });

  it("should mount the host dir read-write at /app", () => {
    setGVisorOverride(false);
    const args = buildJavaArgs(dir, containerId);
    const vIdx = args.indexOf("-v");
    assert.ok(vIdx >= 0);
    assert.equal(args[vIdx + 1], `${dir}:/app:rw`);
  });
});
