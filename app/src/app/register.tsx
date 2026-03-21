import { useState, useRef } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useRouter, Link } from "expo-router";
import { useServerStore } from "../lib/store/server";

export default function RegisterScreen() {
  const router = useRouter();
  const { serverUrl, setTokens } = useServerStore();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegister = async () => {
    if (!displayName || !email || !password) {
      setError("Please fill in all fields.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${serverUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          display_name: displayName,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Registration failed (${res.status}).`);
        return;
      }

      const data = await res.json();
      setTokens(data.access_token, data.refresh_token);
      router.replace("/(app)/walls" as any);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Spraywall</Text>
      <Text style={styles.subtitle}>Create Account</Text>
      <TextInput
        style={styles.input}
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Display Name"
        autoCorrect={false}
        textContentType="name"
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
        blurOnSubmit={false}
      />
      <TextInput
        ref={emailRef}
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        blurOnSubmit={false}
      />
      <TextInput
        ref={passwordRef}
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        secureTextEntry
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={handleRegister}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleRegister}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "Registering..." : "Register"}
        </Text>
      </Pressable>
      <Link href={"/login" as any} style={styles.link}>
        Already have an account? Log In
      </Link>
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
  link: {
    marginTop: 24,
    color: "#007AFF",
    fontSize: 14,
  },
});
