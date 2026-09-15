import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

export function EditMessageModal(props: {
  text: string;
  hasAttachments: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(props.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!busy) props.onCancel();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View className="flex-1 gap-4 bg-adaptive-neutral-50-950 p-6 pt-12">
          <Text className="text-xl text-adaptive-neutral-950-50">Edit and restart</Text>
          <Text className="text-adaptive-neutral-600-400">
            Continues from this message. Previous versions remain available. Workspace files are not
            restored.
          </Text>
          <TextInput
            accessibilityLabel="Edit message"
            multiline
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            editable={!busy}
            value={text}
            onChangeText={setText}
            className="min-h-40 flex-1 rounded-xl border border-adaptive-neutral-300-700 p-3 text-adaptive-neutral-950-50"
            textAlignVertical="top"
          />
          {error && (
            <Text accessibilityRole="alert" className="text-red-500">
              {error}
            </Text>
          )}
          <View className="flex-row justify-end gap-6 pb-6">
            <Pressable accessibilityRole="button" disabled={busy} onPress={props.onCancel}>
              <Text className="text-adaptive-neutral-950-50">Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy || (!text.trim() && !props.hasAttachments)}
              onPress={async () => {
                if (busy) return;
                setBusy(true);
                setError(null);
                try {
                  await props.onSubmit(text);
                } catch (cause) {
                  setError(
                    cause instanceof Error ? cause.message : "Could not restart from this message.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Text className="text-blue-500">{busy ? "Starting…" : "Save and restart"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
