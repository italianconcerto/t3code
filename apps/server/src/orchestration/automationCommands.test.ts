import { describe, expect, it } from "vite-plus/test";
import {
  claimLoopRun,
  LOOP_LIFETIME_MS,
  parseAutomationCommand,
  type ScheduledLoop,
} from "./automationCommands.ts";

describe("automation commands", () => {
  it("preserves objectives and accepts an explicit budget", () => {
    expect(parseAutomationCommand("/goal --budget 50000 Finish migration\nand run tests")).toEqual({
      kind: "goal",
      command: { action: "set", objective: "Finish migration\nand run tests", tokenBudget: 50000 },
    });
    expect(parseAutomationCommand("/goal fix it")).toEqual({
      kind: "goal",
      command: { action: "set", objective: "fix it" },
    });
  });
  it.each(["status", "pause", "resume", "clear"])("parses goal %s", (action) => {
    expect(parseAutomationCommand(`/goal ${action}`)).toEqual({
      kind: "goal",
      command: { action },
    });
  });
  it.each([
    "/goal --budget 0 fix",
    "/goal --budget nope fix",
    `/goal ${"x".repeat(4001)}`,
    "/loop 0s run",
    "/loop 4d run",
    "/loop 999999999999999999h run",
    "/loop 5x run",
    "/loop 5m /goal keep working",
    "/loop 5m /loop 1m test",
  ])("rejects %s", (text) => {
    expect(parseAutomationCommand(text)?.kind).toBe("invalid");
  });
  it("leaves ordinary prompts alone", () => {
    expect(parseAutomationCommand("explain /goal")).toBeUndefined();
    expect(parseAutomationCommand("/goalkeeper")).toBeUndefined();
  });
  it("schedules with explicit or default interval and exposes status/stop", () => {
    expect(parseAutomationCommand("/loop 5m check CI")).toEqual({
      kind: "loop",
      action: "start",
      intervalMs: 300000,
      prompt: "check CI",
    });
    expect(parseAutomationCommand("/loop check CI")).toEqual({
      kind: "loop",
      action: "start",
      intervalMs: 600000,
      prompt: "check CI",
    });
    expect(parseAutomationCommand("/loop")).toEqual({ kind: "loop", action: "status" });
    expect(parseAutomationCommand("/loop stop")).toEqual({ kind: "loop", action: "stop" });
  });
  it("coalesces missed runs, defers busy threads, and expires", () => {
    const loop: ScheduledLoop = {
      prompt: "check",
      intervalMs: 5000,
      nextRunAt: 5000,
      expiresAt: LOOP_LIFETIME_MS,
      runs: 0,
    };
    expect(claimLoopRun(loop, 4999, false)).toBe(false);
    expect(claimLoopRun(loop, 20000, true)).toBe(false);
    expect(loop.runs).toBe(0);
    expect(claimLoopRun(loop, 20000, false)).toBe(true);
    expect(claimLoopRun(loop, 20000, false)).toBe(false);
    expect(loop.nextRunAt).toBe(25000);
    expect(loop.runs).toBe(1);
    expect(claimLoopRun(loop, LOOP_LIFETIME_MS, false)).toBe(false);
  });
});
