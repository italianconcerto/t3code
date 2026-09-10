import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as ManagedGoals from "../../../persistence/ManagedGoals.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export class GoalToolError extends Schema.TaggedError<GoalToolError>()("GoalToolError", {
  message: Schema.String,
}) {}

export const GoalToolResult = Schema.Struct({
  objective: Schema.String,
  status: ManagedGoals.ManagedGoalStatus,
  tokensUsed: Schema.Finite,
  tokenBudget: Schema.NullOr(Schema.Finite),
  timeUsedSeconds: Schema.Finite,
  message: Schema.String,
});

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ManagedGoals.ManagedGoalRepository,
];
const NoParameters = Schema.Record(Schema.String, Schema.Never);

const GetGoalTool = Tool.make("t3_get_goal", {
  description:
    "Get the T3-managed persistent goal for this thread, including status, token use, budget, and elapsed time.",
  parameters: NoParameters,
  success: GoalToolResult,
  failure: GoalToolError,
  dependencies,
})
  .annotate(Tool.Title, "Get persistent goal")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const UpdateGoalTool = Tool.make("t3_update_goal", {
  description:
    "Finish the T3-managed persistent goal or report a genuine blocker. Use complete only after the objective is achieved and verified. Use blocked only when the same blocker prevents further progress; T3 requires three consecutive blocked reports before stopping. Do not call this merely because one turn is ending: omit it and T3 will continue automatically.",
  parameters: Schema.Struct({
    status: Schema.Literals(["complete", "blocked"]),
    reason: Schema.optional(Schema.String),
  }),
  success: GoalToolResult,
  failure: GoalToolError,
  dependencies,
}).annotate(Tool.Title, "Update persistent goal");

export const GoalToolkit = Toolkit.make(GetGoalTool, UpdateGoalTool);
