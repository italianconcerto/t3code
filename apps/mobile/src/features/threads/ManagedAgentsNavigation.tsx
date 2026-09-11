import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { useThreadShells } from "../../state/entities";

export function ManagedAgentsNavigation(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const threads = useThreadShells();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const { parent, children } = useMemo(() => {
    const current = threads.find(
      (thread) => thread.environmentId === props.environmentId && thread.id === props.threadId,
    );
    return {
      parent: threads.find(
        (thread) =>
          thread.environmentId === props.environmentId &&
          thread.id === current?.parentThreadId &&
          thread.archivedAt === null,
      ),
      children: threads.filter(
        (thread) =>
          thread.environmentId === props.environmentId &&
          thread.parentThreadId === props.threadId &&
          thread.archivedAt === null,
      ),
    };
  }, [threads, props.environmentId, props.threadId]);
  const select = (threadId: ThreadId) => {
    setOpen(false);
    navigation.navigate("Thread", { environmentId: props.environmentId, threadId });
  };

  if (open && children.length === 0) setOpen(false);
  if (!parent && children.length === 0) return null;

  return (
    <View className="mx-4 mb-2 flex-row gap-2">
      {parent ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open parent chat"
          className="rounded-xl bg-card px-3 py-3"
          onPress={() => select(parent.id)}
        >
          <Text className="text-sm text-foreground">Parent chat</Text>
        </Pressable>
      ) : null}
      {children.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open subagents"
          accessibilityValue={{ text: `${children.length} subagents` }}
          className="rounded-xl bg-card px-3 py-3"
          onPress={() => setOpen(true)}
        >
          <Text className="text-sm text-foreground">Subagents · {children.length}</Text>
        </Pressable>
      ) : null}
      <Modal
        visible={open && children.length > 0}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View
          className="flex-1 bg-screen"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        >
          <View className="flex-row items-center justify-between px-4 py-3">
            <Text className="text-lg font-t3-bold text-foreground">Subagents</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close subagents"
              className="px-3 py-3"
              onPress={() => setOpen(false)}
            >
              <Text className="text-foreground">Done</Text>
            </Pressable>
          </View>
          <Text className="px-4 pb-3 text-sm text-foreground-muted">
            Open a child chat to follow its work, send instructions, stop it or change its model.
          </Text>
          <FlatList
            data={children}
            keyExtractor={(child) => child.id}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open subagent ${item.title}`}
                accessibilityValue={{
                  text: `${item.modelSelection.instanceId}, ${item.modelSelection.model}, ${item.session?.status ?? (item.latestUserMessageAt ? "pending" : "idle")}`,
                }}
                className="mx-4 mb-2 rounded-xl bg-card p-4"
                onPress={() => select(item.id)}
              >
                <Text className="font-t3-bold text-foreground" numberOfLines={2}>
                  {item.title}
                </Text>
                <Text className="mt-1 text-sm text-foreground-muted" numberOfLines={2}>
                  {item.modelSelection.instanceId} · {item.modelSelection.model}
                </Text>
                <Text className="mt-1 text-sm text-foreground-muted">
                  {item.session?.status ?? (item.latestUserMessageAt ? "pending" : "idle")}
                </Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}
