import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { DoctorPrompter } from "./doctor-prompter.js";

const authProfileMocks = vi.hoisted(() => ({
  ensureAuthProfileStore: vi.fn(() => {
    throw new Error("unexpected auth profile load");
  }),
  hasAnyAuthProfileStoreSource: vi.fn(() => false),
  resolveApiKeyForProfile: vi.fn(),
  resolveProfileUnusableUntilForDisplay: vi.fn(),
}));

vi.mock("../agents/auth-profiles.js", () => ({
  ensureAuthProfileStore: authProfileMocks.ensureAuthProfileStore,
  hasAnyAuthProfileStoreSource: authProfileMocks.hasAnyAuthProfileStoreSource,
  resolveApiKeyForProfile: authProfileMocks.resolveApiKeyForProfile,
  resolveProfileUnusableUntilForDisplay: authProfileMocks.resolveProfileUnusableUntilForDisplay,
}));

vi.mock("../terminal/note.js", () => ({ note: vi.fn() }));

import { note } from "../terminal/note.js";
import { noteAuthProfileHealth } from "./doctor-auth.js";

describe("noteAuthProfileHealth", () => {
  beforeEach(() => {
    authProfileMocks.ensureAuthProfileStore.mockReset();
    authProfileMocks.ensureAuthProfileStore.mockImplementation(() => {
      throw new Error("unexpected auth profile load");
    });
    authProfileMocks.hasAnyAuthProfileStoreSource.mockReset();
    authProfileMocks.hasAnyAuthProfileStoreSource.mockReturnValue(false);
    authProfileMocks.resolveApiKeyForProfile.mockReset();
    authProfileMocks.resolveProfileUnusableUntilForDisplay.mockReset();
    vi.mocked(note).mockReset();
    delete process.env.OPENCLAW_DOCTOR_OAUTH_WARN_MS;
  });

  it("skips external auth profile resolution when no auth source exists", async () => {
    await noteAuthProfileHealth({
      cfg: { channels: { telegram: { enabled: true } } } as OpenClawConfig,
      prompter: {} as DoctorPrompter,
      allowKeychainPrompt: false,
    });

    expect(authProfileMocks.hasAnyAuthProfileStoreSource).toHaveBeenCalledOnce();
    expect(authProfileMocks.ensureAuthProfileStore).not.toHaveBeenCalled();
  });

  it("honors the managed-service OAuth warning horizon override", async () => {
    const confirmAutoFix = vi.fn();
    const expires = Date.now() + 8 * 60 * 60 * 1000;
    process.env.OPENCLAW_DOCTOR_OAUTH_WARN_MS = String(60 * 60 * 1000);
    authProfileMocks.hasAnyAuthProfileStoreSource.mockReturnValue(true);
    authProfileMocks.ensureAuthProfileStore.mockReturnValue({
      version: 1,
      profiles: {
        "anthropic:claude-cli": {
          type: "oauth",
          provider: "claude-cli",
          access: "access",
          refresh: "refresh",
          expires,
        },
      },
    });

    await noteAuthProfileHealth({
      cfg: {} as OpenClawConfig,
      prompter: { confirmAutoFix } as unknown as DoctorPrompter,
      allowKeychainPrompt: false,
    });

    expect(confirmAutoFix).not.toHaveBeenCalled();
    expect(note).not.toHaveBeenCalledWith(expect.any(String), "Model auth");
  });
});
