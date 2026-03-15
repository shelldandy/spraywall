import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { useServerStore } from "../../lib/store/server";

export default function SettingsScreen() {
  const router = useRouter();
  const { serverUrl, setServerUrl, clearTokens } = useServerStore();
  const [editing, setEditing] = useState(false);
  const [newUrl, setNewUrl] = useState(serverUrl);

  const appVersion = Constants.expoConfig?.version ?? "1.0.0";

  const handleChangeUrl = () => {
    Alert.alert(
      "Change Server",
      "Changing the server URL will sign you out. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => setEditing(true),
        },
      ]
    );
  };

  const handleSaveUrl = () => {
    const url = newUrl.replace(/\/+$/, "");
    if (!url) {
      Alert.alert("Error", "Server URL cannot be empty.");
      return;
    }
    clearTokens();
    setServerUrl(url);
    setEditing(false);
    router.replace("/" as any);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.label}>Server URL</Text>
        {editing ? (
          <>
            <TextInput
              style={styles.input}
              value={newUrl}
              onChangeText={setNewUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="http://localhost:8080"
            />
            <View style={styles.row}>
              <Pressable
                style={[styles.button, styles.cancelButton]}
                onPress={() => {
                  setEditing(false);
                  setNewUrl(serverUrl);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={handleSaveUrl}>
                <Text style={styles.buttonText}>Save</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.value}>{serverUrl}</Text>
            <Pressable style={styles.button} onPress={handleChangeUrl}>
              <Text style={styles.buttonText}>Change Server URL</Text>
            </Pressable>
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>App Version</Text>
        <Text style={styles.value}>{appVersion}</Text>
      </View>

      <Pressable
        style={[styles.button, styles.backButton]}
        onPress={() => router.back()}
      >
        <Text style={styles.buttonText}>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    paddingTop: 64,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 32,
  },
  section: {
    marginBottom: 32,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 16,
    color: "#333",
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  cancelButton: {
    backgroundColor: "#999",
  },
  backButton: {
    marginTop: "auto",
    alignSelf: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  cancelButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
