import { describe, expect } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Cause from "effect/Cause";
import { stableStringify } from "@t3tools/shared/relaySigning";
import { openCodeRuntimeErrorDetail, runOpenCodeSdk } from "./opencodeRuntime.ts";
import { isOpenCodeNotFound } from "./Layers/OpenCodeAdapter.ts";

describe("OpenCode diagnostics", () => {
  it.effect("preserves recovery classification through sanitized Error causes", () =>
    Effect.gen(function* () {
      for (const status of [404, 401, 500]) {
        const raw = new Error("Session failed", {
          cause: {
            status,
            body: { name: "NotFoundError" },
            request: { headers: { Authorization: "Bearer nested-request-secret" } },
          },
        });
        const result = yield* Effect.exit(
          runOpenCodeSdk("session.get", async () => {
            throw raw;
          }),
        );
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const failure = Cause.squash(result.cause);
          expect(isOpenCodeNotFound(failure)).toBe(status === 404);
          expect(stableStringify(failure)).not.toContain("nested-request-secret");
        }
      }
    }),
  );

  it("preserves status and error details without request or nested secrets", () => {
    const detail = openCodeRuntimeErrorDetail({
      response: { status: 401 },
      request: { url: "https://user:request-secret@example.test" },
      error: {
        code: "invalid_auth",
        message: "Authentication failed",
        nested: [
          {
            Authorization: "Bearer nested-secret",
            apiKey: "key-secret",
            password: "password-secret",
            headers: [["X-Custom", "header-secret"]],
          },
        ],
      },
    });
    expect(detail).toContain("status=401");
    expect(detail).toContain("invalid_auth");
    expect(detail).toContain("Authentication failed");
    for (const secret of [
      "request-secret",
      "nested-secret",
      "key-secret",
      "password-secret",
      "header-secret",
    ])
      expect(detail).not.toContain(secret);
  });

  it("redacts request fallback, circular structures and string authorization", () => {
    const circular: Record<string, unknown> = {
      response: { status: 503 },
      request: { headers: { authorization: "Bearer fallback-secret" } },
    };
    circular.self = circular;
    const detail = openCodeRuntimeErrorDetail(circular);
    expect(detail).toContain("status=503");
    expect(detail).not.toContain("fallback-secret");
    expect(openCodeRuntimeErrorDetail(new Error("Rejected Bearer message-secret"))).toBe(
      "Rejected Bearer [redacted]",
    );
    expect(openCodeRuntimeErrorDetail("Basic dXNlcjpwYXNz")).toBe("Basic [redacted]");
  });

  it("redacts credentials in serialized error bodies and messages", () => {
    for (const body of [
      "x-api-key: header-secret",
      '{"apiKey":"json-secret","message":"Denied"}',
      "https://example.test?token=query-secret&other=kept",
      "https://user:url-secret@example.test/path",
      "password='secret with spaces'",
    ]) {
      expect(openCodeRuntimeErrorDetail({ response: { status: 401 }, error: body })).not.toContain(
        "secret",
      );
      expect(openCodeRuntimeErrorDetail(new Error(body))).not.toContain("secret");
    }
  });

  it.effect("does not retain the raw authenticated SDK request as the propagated cause", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        runOpenCodeSdk("session.prompt", async () => {
          throw {
            request: { headers: { Authorization: "Bearer propagated-secret" } },
            response: { status: 500 },
            error: { message: "Server failed" },
          };
        }),
      );
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failure = Cause.squash(result.cause);
        expect(stableStringify(failure)).not.toContain("propagated-secret");
        expect(openCodeRuntimeErrorDetail(failure)).toContain("Server failed");
      }
    }),
  );
});
