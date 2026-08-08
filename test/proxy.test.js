import { afterEach, expect, test, vi } from "vitest";

vi.mock("dotenv/config", () => ({}));

const keys = [
  "BUILDER_PROXY_DATACENTER_SERVER",
  "BUILDER_PROXY_DATACENTER_USERNAME",
  "BUILDER_PROXY_DATACENTER_PASSWORD",
  "BUILDER_PROXY_RESIDENTIAL_SERVER",
  "BUILDER_PROXY_RESIDENTIAL_USERNAME",
  "BUILDER_PROXY_RESIDENTIAL_PASSWORD",
  "BUILDER_PROXY_RESIDENTIAL_CDP_URL",
  "BUILDER_PROXY_UNBLOCK_API_URL",
  "BUILDER_PROXY_UNBLOCK_TOKEN",
  "BUILDER_PROXY_UNBLOCK_ZONE",
];

const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

const loadProxy = async (values = {}) => {
  vi.resetModules();
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);
  return import("../src/proxy.js");
};

afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

test("resolves the none tier without configuration", async () => {
  const { getProxySpec } = await loadProxy();
  expect(getProxySpec("none")).toEqual({ name: "none" });
});

test("resolves an explicitly configured datacenter proxy", async () => {
  const { getProxySpec } = await loadProxy({
    BUILDER_PROXY_DATACENTER_SERVER: "proxy.example:8080",
    BUILDER_PROXY_DATACENTER_USERNAME: "user",
    BUILDER_PROXY_DATACENTER_PASSWORD: "password",
  });

  expect(getProxySpec("datacenter")).toEqual({
    name: "datacenter",
    server: "proxy.example:8080",
    username: "user",
    password: "password",
  });
});

test("rejects unconfigured tiers without exposing configuration", async () => {
  const { getProxySpec } = await loadProxy();
  expect(() => getProxySpec("residential")).toThrow("not configured");
  expect(() => getProxySpec("unexpected")).toThrow(
    "Unexpected proxy tier: unexpected",
  );
});

test("configures unblock fetch from environment values", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
  vi.stubGlobal("fetch", fetchMock);
  const { getProxySpec } = await loadProxy({
    BUILDER_PROXY_UNBLOCK_API_URL: "https://unblock.example/request",
    BUILDER_PROXY_UNBLOCK_TOKEN: "token",
    BUILDER_PROXY_UNBLOCK_ZONE: "zone",
  });

  await getProxySpec("unblock").fetch({ url: "https://example.com" });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://unblock.example/request",
    expect.objectContaining({ method: "POST" }),
  );
});
