import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LegacyConfigRule } from "../../config/legacy.shared.js";

const {
  loadBundledChannelDoctorContractApiMock,
  listBootstrapChannelPluginIdsMock,
  listPluginDoctorLegacyConfigRulesMock,
} = vi.hoisted(() => ({
  loadBundledChannelDoctorContractApiMock: vi.fn(),
  listBootstrapChannelPluginIdsMock: vi.fn((): string[] => []),
  listPluginDoctorLegacyConfigRulesMock: vi.fn((): LegacyConfigRule[] => []),
}));

vi.mock("./doctor-contract-api.js", () => ({
  loadBundledChannelDoctorContractApi: loadBundledChannelDoctorContractApiMock,
}));

vi.mock("./bootstrap-registry.js", () => ({
  listBootstrapChannelPluginIds: listBootstrapChannelPluginIdsMock,
}));

vi.mock("../../plugins/doctor-contract-registry.js", () => ({
  listPluginDoctorLegacyConfigRules: listPluginDoctorLegacyConfigRulesMock,
}));

import { collectChannelLegacyConfigRules } from "./legacy-config.js";

describe("collectChannelLegacyConfigRules", () => {
  beforeEach(() => {
    loadBundledChannelDoctorContractApiMock.mockReset();
    listBootstrapChannelPluginIdsMock.mockReset();
    listBootstrapChannelPluginIdsMock.mockReturnValue([]);
    listPluginDoctorLegacyConfigRulesMock.mockReset();
    listPluginDoctorLegacyConfigRulesMock.mockReturnValue([]);
  });

  it("uses bundled doctor contract rules before falling back to registry scans", () => {
    loadBundledChannelDoctorContractApiMock.mockImplementation((channelId: string) =>
      channelId === "discord"
        ? {
            legacyConfigRules: [
              {
                path: ["channels", "discord", "voice", "tts"],
                message: "legacy discord rule",
              },
            ],
          }
        : undefined,
    );

    const rules = collectChannelLegacyConfigRules({
      channels: {
        discord: {},
      },
    });

    expect(rules).toEqual([
      {
        path: ["channels", "discord", "voice", "tts"],
        message: "legacy discord rule",
      },
    ]);
    expect(listBootstrapChannelPluginIdsMock).toHaveBeenCalled();
    expect(listPluginDoctorLegacyConfigRulesMock).not.toHaveBeenCalled();
  });

  it("falls back to registry scans only for unresolved non-bundled channels", () => {
    loadBundledChannelDoctorContractApiMock.mockImplementation((channelId: string) =>
      channelId === "slack"
        ? {
            legacyConfigRules: [
              {
                path: ["channels", "slack", "legacy"],
                message: "legacy slack rule",
              },
            ],
          }
        : undefined,
    );
    listBootstrapChannelPluginIdsMock.mockReturnValue(["slack"]);
    listPluginDoctorLegacyConfigRulesMock.mockReturnValue([
      {
        path: ["channels", "custom-chat", "legacy"],
        message: "legacy custom rule",
      },
    ]);

    const rules = collectChannelLegacyConfigRules({
      channels: {
        slack: {},
        "custom-chat": {},
      },
    });

    expect(rules).toEqual([
      {
        path: ["channels", "slack", "legacy"],
        message: "legacy slack rule",
      },
      {
        path: ["channels", "custom-chat", "legacy"],
        message: "legacy custom rule",
      },
    ]);
    expect(listPluginDoctorLegacyConfigRulesMock).toHaveBeenCalledWith({
      pluginIds: ["custom-chat"],
    });
  });

  it("does not rescan registry when a bundled channel has no explicit doctor rules", () => {
    listBootstrapChannelPluginIdsMock.mockReturnValue(["imessage"]);

    const rules = collectChannelLegacyConfigRules({
      channels: {
        imessage: {},
      },
    });

    expect(rules).toEqual([]);
    expect(listPluginDoctorLegacyConfigRulesMock).not.toHaveBeenCalled();
  });

  it("treats empty doctor-contract legacy rules as authoritative", () => {
    loadBundledChannelDoctorContractApiMock.mockImplementation((channelId: string) =>
      channelId === "imessage" ? { legacyConfigRules: [] } : undefined,
    );

    const rules = collectChannelLegacyConfigRules({
      channels: {
        imessage: {},
      },
    });

    expect(rules).toEqual([]);
    expect(listPluginDoctorLegacyConfigRulesMock).not.toHaveBeenCalled();
  });

  it("scopes channel legacy scans to touched channels during dry-run validation", () => {
    loadBundledChannelDoctorContractApiMock.mockImplementation((channelId: string) => ({
      legacyConfigRules: [
        {
          path: ["channels", channelId],
          message: `legacy ${channelId} rule`,
        },
      ],
    }));

    const rules = collectChannelLegacyConfigRules(
      {
        channels: {
          discord: {},
          telegram: {},
        },
      },
      [["channels", "discord", "token"]],
    );

    expect(rules).toEqual([
      {
        path: ["channels", "discord"],
        message: "legacy discord rule",
      },
    ]);
    expect(loadBundledChannelDoctorContractApiMock).toHaveBeenCalledTimes(1);
    expect(loadBundledChannelDoctorContractApiMock).toHaveBeenCalledWith("discord");
  });

  it("skips channel ids already covered by explicit legacy rules", () => {
    loadBundledChannelDoctorContractApiMock.mockImplementation((channelId: string) => ({
      legacyConfigRules: [
        {
          path: ["channels", channelId],
          message: `legacy ${channelId} rule`,
        },
      ],
    }));

    const rules = collectChannelLegacyConfigRules(
      {
        channels: {
          discord: {},
          telegram: {},
        },
      },
      undefined,
      new Set(["telegram"]),
    );

    expect(rules).toEqual([
      {
        path: ["channels", "discord"],
        message: "legacy discord rule",
      },
    ]);
    expect(loadBundledChannelDoctorContractApiMock).toHaveBeenCalledTimes(1);
    expect(loadBundledChannelDoctorContractApiMock).toHaveBeenCalledWith("discord");
  });
});
