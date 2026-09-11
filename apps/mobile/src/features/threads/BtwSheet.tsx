import { useState } from "react";
import { Modal, View, ScrollView, TextInput, Pressable } from "react-native";
import * as Option from "effect/Option";
import { MessageId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { AppText as Text } from "../../components/AppText";
import { threadEnvironment, useEnvironmentThread } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { makeQueuedMessageMetadata } from "../../lib/commandMetadata";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useNavigation } from "@react-navigation/native";

export function BtwSheet({
  environmentId,
  threadId,
  onClose,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  onClose: (discarded?: boolean) => void;
}) {
  const state = useEnvironmentThread(environmentId, threadId);
  const thread = Option.getOrNull(state.data);
  const send = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const stop = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const remove = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigation = useNavigation();
  const act = async (action: "send" | "stop" | "close") => {
    if (busy || (action === "send" && (!thread || !text.trim()))) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        action === "close"
          ? await remove({ environmentId, input: { threadId } })
          : action === "stop"
            ? await stop({ environmentId, input: { threadId } })
            : await send({
                environmentId,
                input: {
                  threadId,
                  runtimeMode: "approval-required",
                  interactionMode: "plan",
                  message: {
                    messageId: MessageId.make(makeQueuedMessageMetadata().messageId),
                    role: "user",
                    text: text.trim(),
                    attachments: [],
                  },
                },
              });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      if (action === "close") onClose(true);
      if (action === "send") setText((current) => (current === text ? "" : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "BTW request failed. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => void act("close")}
    >
      <View className="flex-1 bg-background px-4 pb-8 pt-6">
        <Text className="text-xl font-t3-bold">BTW · Side discussion</Text>
        <Text className="my-2 text-foreground-muted">
          Independent from the main agent. Close discards this conversation.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open full BTW chat"
          onPress={() => {
            onClose();
            navigation.navigate("Thread", { environmentId, threadId });
          }}
        >
          <Text>Open full chat for approvals or questions</Text>
        </Pressable>
        <View className="flex-row justify-between py-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop BTW"
            disabled={busy}
            onPress={() => void act("stop")}
          >
            <Text>Stop BTW</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close and discard BTW"
            disabled={busy}
            onPress={() => void act("close")}
          >
            <Text>Close and discard</Text>
          </Pressable>
        </View>
        {error && <Text accessibilityRole="alert">{error}</Text>}
        <ScrollView className="flex-1">
          {!thread ? (
            <Text>Loading BTW…</Text>
          ) : (
            thread.messages
              .filter((message) => !message.id.startsWith(`${threadId}:fork:`))
              .slice(-30)
              .map((message) => (
                <View key={message.id} className="my-2">
                  <Text className="font-t3-bold">{message.role === "user" ? "You" : "Agent"}</Text>
                  <Text selectable>{message.text.slice(-6000)}</Text>
                </View>
              ))
          )}
        </ScrollView>
        <TextInput
          accessibilityLabel="BTW follow-up"
          value={text}
          onChangeText={setText}
          placeholder="Ask a follow-up…"
          multiline
          className="min-h-20 rounded-xl border border-border p-3 text-foreground"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send BTW"
          disabled={busy || !thread || !text.trim()}
          onPress={() => void act("send")}
          className="py-4"
        >
          <Text>{busy ? "Please wait…" : "Send"}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
