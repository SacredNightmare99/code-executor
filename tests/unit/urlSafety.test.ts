import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isBlockedUrl, isPrivateAddress } from "../../src/utils/urlSafety.ts";

describe("isPrivateAddress", () => {
  it("should flag IPv4 loopback", () => {
    assert.equal(isPrivateAddress("127.0.0.1"), true);
    assert.equal(isPrivateAddress("127.255.255.255"), true);
  });

  it("should flag RFC1918 private ranges", () => {
    assert.equal(isPrivateAddress("10.0.0.1"), true);
    assert.equal(isPrivateAddress("10.255.255.255"), true);
    assert.equal(isPrivateAddress("172.16.0.1"), true);
    assert.equal(isPrivateAddress("172.31.255.255"), true);
    assert.equal(isPrivateAddress("192.168.1.1"), true);
    assert.equal(isPrivateAddress("192.168.255.255"), true);
  });

  it("should flag link-local + cloud metadata", () => {
    assert.equal(isPrivateAddress("169.254.169.254"), true); // cloud metadata
    assert.equal(isPrivateAddress("169.254.0.1"), true);
  });

  it("should flag unspecified + CGNAT", () => {
    assert.equal(isPrivateAddress("0.0.0.0"), true);
    assert.equal(isPrivateAddress("100.64.0.1"), true);
  });

  it("should allow public addresses", () => {
    assert.equal(isPrivateAddress("8.8.8.8"), false);
    assert.equal(isPrivateAddress("93.184.216.34"), false);
    assert.equal(isPrivateAddress("1.1.1.1"), false);
  });

  it("should flag IPv6 loopback and local", () => {
    assert.equal(isPrivateAddress("::1"), true);
    assert.equal(isPrivateAddress("::"), true);
    assert.equal(isPrivateAddress("fc00::1"), true);
    assert.equal(isPrivateAddress("fd00::1"), true);
    assert.equal(isPrivateAddress("fe80::1"), true);
    assert.equal(isPrivateAddress("febf::1"), true);
    assert.equal(isPrivateAddress("fec0::1"), true);
    assert.equal(isPrivateAddress("2001:db8::1"), true);
  });

  it("should flag IPv4-mapped IPv6 private addresses", () => {
    assert.equal(isPrivateAddress("::ffff:127.0.0.1"), true);
    assert.equal(isPrivateAddress("::ffff:192.168.1.1"), true);
    assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
  });

  it("should treat malformed input as blocked", () => {
    assert.equal(isPrivateAddress("not-an-ip"), true);
  });
});

describe("isBlockedUrl", () => {
  it("should reject malformed URLs", async () => {
    assert.ok(await isBlockedUrl("not a url"));
    assert.ok(await isBlockedUrl(""));
  });

  it("should reject non-http(s) schemes", async () => {
    assert.equal(await isBlockedUrl("file:///etc/passwd"), "Only http/https URLs are allowed");
    assert.equal(await isBlockedUrl("ftp://example.com/file"), "Only http/https URLs are allowed");
    assert.equal(await isBlockedUrl("gopher://example.com/x"), "Only http/https URLs are allowed");
  });

  it("should reject local hostnames", async () => {
    assert.ok(await isBlockedUrl("http://localhost:8080/cb"));
    assert.ok(await isBlockedUrl("http://foo.localhost/cb"));
    assert.ok(await isBlockedUrl("http://foo.local/cb"));
    assert.ok(await isBlockedUrl("http://foo.internal/cb"));
    assert.ok(await isBlockedUrl("http://0.0.0.0:4000/cb"));
  });

  it("should reject private/loopback IP literals without DNS", async () => {
    assert.ok(await isBlockedUrl("http://127.0.0.1/cb"));
    assert.ok(await isBlockedUrl("http://10.0.0.5/cb"));
    assert.ok(await isBlockedUrl("http://192.168.1.10/cb"));
    assert.ok(await isBlockedUrl("http://169.254.169.254/latest/meta-data/"));
    assert.ok(await isBlockedUrl("http://[::1]:3000/cb"));
    assert.ok(await isBlockedUrl("http://[fec0::1]/cb"));
  });

  it("should allow public IP literals without DNS", async () => {
    assert.equal(await isBlockedUrl("http://8.8.8.8/cb"), null);
    assert.equal(await isBlockedUrl("https://1.1.1.1/cb"), null);
    assert.equal(await isBlockedUrl("http://[2606:4700:4700::1111]/cb"), null);
  });

  it("should block a hostname that resolves to a private address", async () => {
    const lookup = async () => [{ address: "10.1.2.3" }];
    assert.ok(await isBlockedUrl("http://example.com/cb", { lookup }));
  });

  it("should allow a hostname that resolves only to public addresses", async () => {
    const lookup = async () => [{ address: "93.184.216.34" }];
    assert.equal(await isBlockedUrl("http://example.com/cb", { lookup }), null);
  });

  it("should block when any resolved address is private", async () => {
    const lookup = async () => [
      { address: "93.184.216.34" },
      { address: "127.0.0.1" },
    ];
    assert.ok(await isBlockedUrl("http://example.com/cb", { lookup }));
  });

  it("should block when DNS resolution fails", async () => {
    const lookup = async () => {
      throw new Error("ENOTFOUND");
    };
    assert.equal(await isBlockedUrl("http://example.com/cb", { lookup }), "Failed to resolve hostname");
  });
});
