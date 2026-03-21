import { useState, useEffect } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useRouter, useNavigationContainerRef } from "expo-router";
import { useServerStore } from "../lib/store/server";

export default function ConnectScreen() {
  const router = useRouter();
  const { serverUrl, setServerUrl, isAuthenticated } = useServerStore();
  const [input, setInput] = useState(serverUrl || "http://localhost:8080");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (serverUrl) setInput(serverUrl);
  }, [serverUrl]);

  const rootNav = useNavigationContainerRef();

  useEffect(() => {
    if (serverUrl && isAuthenticated() && rootNav?.isReady()) {
      router.replace("/(app)/walls" as any);
    }
  }, [serverUrl, isAuthenticated, router, rootNav]);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = input.replace(/\/+$/, "");
      const res = await fetch(`${url}/healthz`);
      const data = await res.json();
      if (data.status === "ok") {
        setServerUrl(url);
        router.replace("/login" as any);
      } else {
        setError("Unexpected response from server.");
      }
    } catch {
      setError("Could not connect to server.");
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
        returnKeyType="go"
        onSubmitEditing={handleConnect}
      />
      {error && <Text style={styles.error}>{error}</Text>}
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
  error: {
    color: "#ff3b30",
    fontSize: 14,
    marginBottom: 16,
    textAlign: "center",
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
