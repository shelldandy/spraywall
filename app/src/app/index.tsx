import { useState, useEffect } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from "react-native";
import { useServerStore } from "../lib/store/server";

export default function ConnectScreen() {
  const { serverUrl, setServerUrl } = useServerStore();
  const [input, setInput] = useState(serverUrl || "http://localhost:8080");

  useEffect(() => {
    if (serverUrl) setInput(serverUrl);
  }, [serverUrl]);
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const url = input.replace(/\/+$/, "");
      const res = await fetch(`${url}/healthz`);
      const data = await res.json();
      if (data.status === "ok") {
        setServerUrl(url);
        Alert.alert("Connected", `Server at ${url} is healthy.`);
      } else {
        Alert.alert("Error", "Unexpected response from server.");
      }
    } catch {
      Alert.alert("Error", "Could not connect to server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Spraywall</Text>
      <Text style={styles.subtitle}>Connect to Server</Text>
      <TextInput
        style={styles.input}
        value={input}
        onChangeText={setInput}
        placeholder="http://localhost:8080"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleConnect}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "Connecting..." : "Connect"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: "#666",
    marginBottom: 32,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
