import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { Image } from "expo-image";
import { Eye, EyeOff } from "lucide-react-native";
import { config } from "@/lib/config";
import { useSessionState } from "@/providers/session";
import { Button, Field } from "@/components/ui";
import { colors } from "@/theme";

/** Same accounts as the website: email + password, no public sign-up. */
export default function SignIn() {
  const { signIn, state } = useSessionState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(state.status === "signed-out" ? (state.reason ?? null) : null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  async function submit() {
    const errs: typeof fieldErrors = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = "Enter your work email";
    if (!password) errs.password = "Enter your password";
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    const message = await signIn(email, password);
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
          <View style={st.brand}>
            <Image
              source={require("../../assets/images/logo-full.png")}
              style={st.logo}
              contentFit="contain"
              accessibilityLabel="Diwakar - Powering Bharat's Future"
              accessibilityIgnoresInvertColors
            />
            <Text style={st.appName}>Diwakar Connect</Text>
          </View>
          <View style={st.card}>
            <Text style={st.title} accessibilityRole="header">
              Sign in
            </Text>
            <Text style={st.subtitle}>Use your Diwakar Solar work account.</Text>
            {error ? (
              <View style={st.alert} accessibilityRole="alert">
                <Text style={st.alertText}>{error}</Text>
              </View>
            ) : null}
            <Field
              label="Work email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
              error={fieldErrors.email}
            />
            <View>
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!show}
                autoComplete="password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
                error={fieldErrors.password}
                style={{ paddingRight: 48 }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={show ? "Hide password" : "Show password"}
                onPress={() => setShow((v) => !v)}
                style={st.eye}
                hitSlop={8}
              >
                {show ? <EyeOff size={20} color={colors.ink500} /> : <Eye size={20} color={colors.ink500} />}
              </Pressable>
            </View>
            <Button title="Sign in" onPress={() => void submit()} loading={busy} style={{ marginTop: 4 }} />
            <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(`${config.siteUrl}/forgot-password`)} style={{ alignSelf: "center", padding: 6 }}>
              <Text style={st.link}>Forgot password?</Text>
            </Pressable>
          </View>
          <Text style={st.foot}>Accounts are created by your administrator. Need access? Ask your HR or IT team for an invitation.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", padding: 20, gap: 20 },
  brand: { alignItems: "center", gap: 4 },
  logo: { width: 260, height: Math.round((260 * 193) / 1120), maxWidth: "90%" },
  appName: { fontSize: 22, fontWeight: "700", color: colors.ink900, marginTop: 6 },
  card: { backgroundColor: colors.white, borderRadius: 20, borderWidth: 1, borderColor: colors.line, padding: 20, gap: 14 },
  title: { fontSize: 20, fontWeight: "700", color: colors.ink900 },
  subtitle: { fontSize: 14, color: colors.ink500, marginTop: -8 },
  alert: { backgroundColor: colors.danger50, borderRadius: 10, padding: 12 },
  alertText: { color: colors.danger700, fontSize: 14 },
  eye: { position: "absolute", right: 12, top: 36, height: 30, justifyContent: "center" },
  link: { color: colors.brand700, fontWeight: "600", fontSize: 14 },
  foot: { fontSize: 13, color: colors.ink500, textAlign: "center", lineHeight: 19 },
});
