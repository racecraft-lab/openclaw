import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentsListCommand } from "./agents.commands.list.js";

const mocks = vi.hoisted(() => ({
  requireValidConfig: vi.fn(),
  buildAgentSummaries: vi.fn(),
  listRouteBindings: vi.fn(),
  normalizeAgentId: vi.fn((value: string) => value.trim().toLowerCase()),
  describeBinding: vi.fn((binding: { agentId: string }) => `binding:${binding.agentId}`),
  ensureCliPluginRegistryLoaded: vi.fn(async () => {}),
  buildProviderStatusIndex: vi.fn(),
  buildProviderSummaryMetadataIndex: vi.fn(),
  listProvidersForAgent: vi.fn(),
  summarizeBindings: vi.fn(),
  writeRuntimeJson: vi.fn(),
}));

vi.mock("./agents.command-shared.js", () => ({
  requireValidConfig: (...args: Parameters<typeof mocks.requireValidConfig>) =>
    mocks.requireValidConfig(...args),
}));

vi.mock("./agents.config.js", () => ({
  buildAgentSummaries: (...args: Parameters<typeof mocks.buildAgentSummaries>) =>
    mocks.buildAgentSummaries(...args),
}));

vi.mock("../config/bindings.js", () => ({
  listRouteBindings: (...args: Parameters<typeof mocks.listRouteBindings>) =>
    mocks.listRouteBindings(...args),
}));

vi.mock("../routing/session-key.js", () => ({
  normalizeAgentId: (...args: Parameters<typeof mocks.normalizeAgentId>) =>
    mocks.normalizeAgentId(...args),
}));

vi.mock("./agents.bindings.js", () => ({
  describeBinding: (...args: Parameters<typeof mocks.describeBinding>) =>
    mocks.describeBinding(...args),
}));

vi.mock("../cli/plugin-registry-loader.js", () => ({
  ensureCliPluginRegistryLoaded: (
    ...args: Parameters<typeof mocks.ensureCliPluginRegistryLoaded>
  ) => mocks.ensureCliPluginRegistryLoaded(...args),
}));

vi.mock("./agents.providers.js", () => ({
  buildProviderStatusIndex: (...args: Parameters<typeof mocks.buildProviderStatusIndex>) =>
    mocks.buildProviderStatusIndex(...args),
  buildProviderSummaryMetadataIndex: (
    ...args: Parameters<typeof mocks.buildProviderSummaryMetadataIndex>
  ) => mocks.buildProviderSummaryMetadataIndex(...args),
  listProvidersForAgent: (...args: Parameters<typeof mocks.listProvidersForAgent>) =>
    mocks.listProvidersForAgent(...args),
  summarizeBindings: (...args: Parameters<typeof mocks.summarizeBindings>) =>
    mocks.summarizeBindings(...args),
}));

vi.mock("../runtime.js", () => ({
  defaultRuntime: {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  },
  writeRuntimeJson: (...args: Parameters<typeof mocks.writeRuntimeJson>) =>
    mocks.writeRuntimeJson(...args),
}));

function createRuntime() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

describe("agentsListCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireValidConfig.mockResolvedValue({});
    mocks.buildAgentSummaries.mockReturnValue([
      {
        id: "main",
        workspace: "/tmp/main",
        agentDir: "/tmp/main/agent",
        bindings: 0,
        isDefault: true,
        model: "openai/gpt-5.4",
      },
    ]);
    mocks.listRouteBindings.mockReturnValue([]);
    mocks.summarizeBindings.mockReturnValue([]);
    mocks.ensureCliPluginRegistryLoaded.mockResolvedValue(undefined);
    mocks.buildProviderStatusIndex.mockResolvedValue(new Map());
    mocks.buildProviderSummaryMetadataIndex.mockReturnValue(new Map());
    mocks.listProvidersForAgent.mockReturnValue([]);
  });

  it("skips provider probing by default", async () => {
    const runtime = createRuntime();

    await agentsListCommand({}, runtime as never);

    expect(mocks.ensureCliPluginRegistryLoaded).not.toHaveBeenCalled();
    expect(mocks.buildProviderStatusIndex).not.toHaveBeenCalled();
    expect(mocks.listProvidersForAgent).not.toHaveBeenCalled();
    expect(runtime.log).toHaveBeenCalledTimes(1);
    const output = String(runtime.log.mock.calls[0]?.[0]);
    expect(output).toContain(
      "Use --providers to include provider/account status when you need it.",
    );
    expect(output).not.toContain("Providers:");
  });

  it("probes providers only when requested", async () => {
    const runtime = createRuntime();
    mocks.buildProviderStatusIndex.mockResolvedValue(
      new Map([
        [
          "signal:default",
          {
            provider: "signal",
            accountId: "default",
            state: "configured",
          },
        ],
      ]),
    );
    mocks.summarizeBindings.mockReturnValue(["Signal default"]);
    mocks.listProvidersForAgent.mockReturnValue(["Signal default: configured"]);

    await agentsListCommand({ providers: true }, runtime as never);

    expect(mocks.ensureCliPluginRegistryLoaded).toHaveBeenCalledWith({ scope: "all" });
    expect(mocks.buildProviderStatusIndex).toHaveBeenCalledWith({});
    expect(mocks.listProvidersForAgent).toHaveBeenCalledTimes(1);
    const output = String(runtime.log.mock.calls[0]?.[0]);
    expect(output).toContain("Providers:");
    expect(output).toContain("Signal default: configured");
  });

  it("keeps json output on the fast path unless providers are requested", async () => {
    const runtime = createRuntime();

    await agentsListCommand({ json: true }, runtime as never);

    expect(mocks.ensureCliPluginRegistryLoaded).not.toHaveBeenCalled();
    expect(mocks.buildProviderStatusIndex).not.toHaveBeenCalled();
    expect(mocks.writeRuntimeJson).toHaveBeenCalledTimes(1);
    const payload = mocks.writeRuntimeJson.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(payload[0]?.routes).toEqual(["default (no explicit rules)"]);
    expect(payload[0]).not.toHaveProperty("providers");
  });

  it("still loads plugins for json provider output when requested", async () => {
    const runtime = createRuntime();

    await agentsListCommand({ json: true, providers: true }, runtime as never);

    expect(mocks.ensureCliPluginRegistryLoaded).toHaveBeenCalledWith({ scope: "all" });
    expect(mocks.buildProviderStatusIndex).toHaveBeenCalledTimes(1);
    expect(mocks.writeRuntimeJson).toHaveBeenCalledTimes(1);
  });
});
