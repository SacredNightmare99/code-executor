import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildSandboxArgs,
  buildCompileArgs,
  generateContainerId,
} from "../../src/core/runner/sandbox.ts";
import { setGVisorOverride } from "../../src/config/index.ts";

describe("Sandbox Builder", () => {
  afterEach(() => {
    // Reset gVisor override after each test
    setGVisorOverride(null);
  });

  describe("generateContainerId", () => {
    it("should start with runner-", () => {
      const id = generateContainerId();
      assert.ok(id.startsWith("runner-"));
    });

    it("should generate unique IDs", () => {
      const id1 = generateContainerId();
      const id2 = generateContainerId();
      assert.notEqual(id1, id2);
    });
  });

  describe("buildSandboxArgs", () => {
    it("should start with 'run --rm'", () => {
      setGVisorOverride(false);
      const args = buildSandboxArgs({
        containerId: "test-1",
        image: "runner-py",
        hostDir: "/tmp/test",
        cmd: ["main.py"],
      });
      assert.equal(args[0], "run");
      assert.equal(args[1], "--rm");
    });

    it("should include -i when interactive", () => {
      setGVisorOverride(false);
      const args = buildSandboxArgs({
        containerId: "test-1",
        image: "runner-py",
        interactive: true,
        hostDir: "/tmp/test",
        cmd: ["main.py"],
      });
      assert.ok(args.includes("-i"));
    });

    it("should not include -i when not interactive", () => {
      setGVisorOverride(false);
      const args = buildSandboxArgs({
        containerId: "test-1",
        image: "runner-py",
        interactive: false,
        hostDir: "/tmp/test",
        cmd: ["main.py"],
      });
      assert.ok(!args.includes("-i"));
    });

    it("should include container name", () => {
      setGVisorOverride(false);
      const args = buildSandboxArgs({
        containerId: "my-container",
        image: "runner-py",
        hostDir: "/tmp/test",
        cmd: ["main.py"],
      });
      const nameIdx = args.indexOf("--name");
      assert.ok(nameIdx >= 0);
      assert.equal(args[nameIdx + 1], "my-container");
    });

    it("should include resource constraints", () => {
      setGVisorOverride(false);
      const args = buildSandboxArgs({
        containerId: "test-1",
        image: "runner-py",
        hostDir: "/tmp/test",
        cmd: ["main.py"],
      });
      assert.ok(args.some((a) => a.startsWith("--memory=")));
      assert.ok(args.some((a) => a.startsWith("--cpus=")));
      assert.ok(args.some((a) => a.startsWith("--pids-limit=")));
      assert.ok(args.some((a) => a.startsWith("--network=")));
    });

    it("should include security hardening", () => {
      setGVisorOverride(false);
      const args = buildSandboxArgs({
        containerId: "test-1",
        image: "runner-py",
        hostDir: "/tmp/test",
        cmd: ["main.py"],
      });
      assert.ok(args.includes("--cap-drop=ALL"));
      assert.ok(args.includes("--security-opt=no-new-privileges"));
    });

    it("should include --read-only by default", () => {
      setGVisorOverride(false);
      const args = buildSandboxArgs({
        containerId: "test-1",
        image: "runner-py",
        hostDir: "/tmp/test",
        cmd: ["main.py"],
      });
      assert.ok(args.includes("--read-only"));
    });

    it("should include --runtime=runsc when gVisor is available", () => {
      setGVisorOverride(true);
      const args = buildSandboxArgs({
        containerId: "test-1",
        image: "runner-py",
        hostDir: "/tmp/test",
        cmd: ["main.py"],
      });
      assert.ok(args.includes("--runtime=runsc"));
    });

    it("should NOT include --runtime=runsc when gVisor is disabled", () => {
      setGVisorOverride(false);
      const args = buildSandboxArgs({
        containerId: "test-1",
        image: "runner-py",
        hostDir: "/tmp/test",
        cmd: ["main.py"],
      });
      assert.ok(!args.includes("--runtime=runsc"));
    });

    it("should mount host directory at /app", () => {
      setGVisorOverride(false);
      const args = buildSandboxArgs({
        containerId: "test-1",
        image: "runner-py",
        hostDir: "/my/host/dir",
        cmd: ["main.py"],
      });
      const vIdx = args.indexOf("-v");
      assert.ok(vIdx >= 0);
      assert.equal(args[vIdx + 1], "/my/host/dir:/app:rw");
    });

    it("should end with image and command", () => {
      setGVisorOverride(false);
      const args = buildSandboxArgs({
        containerId: "test-1",
        image: "runner-py",
        hostDir: "/tmp/test",
        cmd: ["main.py"],
      });
      assert.equal(args[args.length - 2], "runner-py");
      assert.equal(args[args.length - 1], "main.py");
    });
  });

  describe("buildCompileArgs", () => {
    it("should start with 'run --rm'", () => {
      setGVisorOverride(false);
      const args = buildCompileArgs({
        hostDir: "/tmp/test",
        image: "runner-c",
        cmd: ["/bin/sh", "-c", "gcc main.c -o a.out"],
      });
      assert.equal(args[0], "run");
      assert.equal(args[1], "--rm");
    });

    it("should include network=none", () => {
      setGVisorOverride(false);
      const args = buildCompileArgs({
        hostDir: "/tmp/test",
        image: "runner-c",
        cmd: ["/bin/sh", "-c", "gcc main.c"],
      });
      assert.ok(args.includes("--network=none"));
    });

    it("should NOT include --read-only (compilation needs write)", () => {
      setGVisorOverride(false);
      const args = buildCompileArgs({
        hostDir: "/tmp/test",
        image: "runner-c",
        cmd: ["/bin/sh", "-c", "gcc main.c"],
      });
      assert.ok(!args.includes("--read-only"));
    });

    it("should include resource limits for compilation", () => {
      setGVisorOverride(false);
      const args = buildCompileArgs({
        hostDir: "/tmp/test",
        image: "runner-cpp",
        cmd: ["/bin/sh", "-c", "g++ main.cpp"],
        memory: "256m",
      });
      assert.ok(args.includes("--memory=256m"));
      assert.ok(args.some((a) => a.startsWith("--cpus=")));
      assert.ok(args.some((a) => a.startsWith("--pids-limit=")));
    });

    it("should include security hardening for compilation", () => {
      setGVisorOverride(false);
      const args = buildCompileArgs({
        hostDir: "/tmp/test",
        image: "runner-cpp",
        cmd: ["/bin/sh", "-c", "g++ main.cpp"],
      });
      assert.ok(args.includes("--cap-drop=ALL"));
    });
  });
});
