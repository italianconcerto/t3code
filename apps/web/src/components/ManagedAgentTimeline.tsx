import { useMemo, useRef, useState } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThread } from "@t3tools/client-runtime/state/shell";
import { managedConversationMessages } from "./managedConversationMessages";
import { useTheme } from "~/hooks/useTheme";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { deriveTimelineEntries, deriveWorkLogEntries } from "~/session-logic";
import { MessagesTimeline } from "./chat/MessagesTimeline";
import { useEnvironmentThread } from "~/state/threads";
import {
  threadHasOlderTurns,
  requestOlderThreadTurns,
} from "@t3tools/client-runtime/state/threads";

export function ManagedAgentTimeline({
  detail,
  sideDiscussion,
  openFullChat,
}: {
  detail: EnvironmentThread;
  sideDiscussion: boolean;
  openFullChat: () => void;
}) {
  const listRef = useRef<LegendListRef | null>(null);
  const [following, setFollowing] = useState(true);
  const { resolvedTheme } = useTheme();
  const timestampFormat = useEnvironmentSettings(
    detail.environmentId,
    (settings) => settings.timestampFormat,
  );
  const state = useEnvironmentThread(detail.environmentId, detail.id);
  const loadEarlier = threadHasOlderTurns(state)
    ? {
        loading: state.page._tag === "Some" && state.page.value.loadingOlder,
        cursor: state.page._tag === "Some" ? state.page.value.beforeCursor : null,
        onLoadEarlier: () => requestOlderThreadTurns(detail.environmentId, detail.id),
      }
    : null;
  const entries = useMemo(
    () =>
      deriveTimelineEntries(
        managedConversationMessages({ id: detail.id, messages: detail.messages }, sideDiscussion),
        detail.proposedPlans,
        deriveWorkLogEntries(detail.activities),
      ),
    [detail.messages, detail.proposedPlans, detail.activities, detail.id, sideDiscussion],
  );
  const working = detail.session?.status === "running" || detail.session?.status === "starting";
  return (
    <MessagesTimeline
      listRef={listRef}
      timelineEntries={entries}
      isWorking={working}
      activeTurnStartedAt={detail.latestTurn?.startedAt ?? null}
      latestTurn={detail.latestTurn}
      runningTurnId={working ? (detail.latestTurn?.turnId ?? null) : null}
      turnDiffSummaries={detail.checkpoints}
      routeThreadKey={scopedThreadKey({ environmentId: detail.environmentId, threadId: detail.id })}
      activeThreadEnvironmentId={detail.environmentId}
      onOpenTurnDiff={openFullChat}
      supportsConversationRollback={false}
      onRevertToTurnCount={openFullChat}
      isRevertingCheckpoint={false}
      onImageExpand={openFullChat}
      onFileOpen={openFullChat}
      onFileDownload={openFullChat}
      markdownCwd={detail.worktreePath ?? undefined}
      workspaceRoot={detail.worktreePath ?? undefined}
      resolvedTheme={resolvedTheme}
      timestampFormat={timestampFormat}
      anchorMessageId={null}
      onAnchorReady={() => {}}
      contentInsetEndAdjustment={0}
      liveFollowEnabled={following}
      onIsAtEndChange={setFollowing}
      onManualNavigation={() => setFollowing(false)}
      loadEarlier={loadEarlier}
    />
  );
}
