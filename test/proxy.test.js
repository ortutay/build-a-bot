import { afterEach, expect, test, vi } from "vitest";

vi.mock("../src/env.js", () => ({}));

const keys = [
  "PROXY_DATACENTER_SERVER",
  "PROXY_DATACENTER_USERNAME",
  "PROXY_DATACENTER_PASSWORD",
  "PROXY_RESIDENTIAL_SERVER",
  "PROXY_RESIDENTIAL_USERNAME",
  "PROXY_RESIDENTIAL_PASSWORD",
  "PROXY_RESIDENTIAL_CDP_URL",
  "PROXY_UNBLOCK_API_URL",
  "PROXY_UNBLOCK_TOKEN",
  "PROXY_UNBLOCK_ZONE",
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
  expect(getProxySpec("none")).toEqual({});
});

test("resolves an explicitly configured datacenter proxy", async () => {
  const { getProxySpec } = await loadProxy({
    PROXY_DATACENTER_SERVER: "proxy.example:8080",
    PROXY_DATACENTER_USERNAME: "user",
    PROXY_DATACENTER_PASSWORD: "password",
  });

  expect(getProxySpec("datacenter")).toEqual({
    server: "proxy.example:8080",
    username: "user",
    password: "password",
  });
});

test("rejects unexpected proxy tiers", async () => {
  const { getProxySpec } = await loadProxy();
  expect(() => getProxySpec("unexpected")).toThrow(
    "Unexpected proxy tier: unexpected",
  );
});

test("configures unblock fetch from environment values", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
  vi.stubGlobal("fetch", fetchMock);
  const { getProxySpec } = await loadProxy({
    PROXY_UNBLOCK_API_URL: "https://unblock.example/request",
    PROXY_UNBLOCK_TOKEN: "token",
    PROXY_UNBLOCK_ZONE: "zone",
  });

  await getProxySpec("unblock").fetch({ url: "https://example.com" });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://unblock.example/request",
    expect.objectContaining({ method: "POST" }),
  );
});
