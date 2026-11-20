import "@/lib/livekit-globals";
import { useEffect } from "react";
import { Platform, View } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ShieldAlert } from "lucide-react-native";
import { SessionProvider, useSessionState } from "@/providers/session";
import { PeopleProvider } from "@/providers/people";
import { PresenceProvider } from "@/providers/presence";
import { ActivityProvider } from "@/providers/activity";
import { IncomingCallOverlay } from "@/components/incoming-call";
import { Button, EmptyState } from "@/components/ui";
import { colors } from "@/theme";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Gate />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function Gate() {
  const { state, signOut } = useSessionState();
  const ready = state.status === "ready";

  useEffect(() => {
    if (state.status !== "loading") void SplashScreen.hideAsync().catch(() => undefined);
  }, [state.status]);

  if (state.status === "loading") return <View style={{ flex: 1, backgroundColor: colors.white }} />;

  if (state.status === "inactive") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <EmptyState
          icon={<ShieldAlert color={colors.brand600} size={24} />}
          title="You can't use Diwakar Connect right now"
          description={state.reason}
          action={<Button title="Sign out" variant="secondary" onPress={() => void signOut()} style={{ marginTop: 12 }} />}
        />
      </SafeAreaView>
    );
  }

  const stack = (
    <Stack
      screenOptions={{
        headerTintColor: colors.ink900,
        headerTitleStyle: { fontWeight: "600" },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.white },
        contentStyle: { backgroundColor: colors.white },
      }}
    >
      <Stack.Protected guard={!ready}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={ready}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ title: "" }} />
        <Stack.Screen name="new-chat" options={{ title: "New chat", presentation: Platform.OS === "ios" ? "modal" : "card" }} />
        <Stack.Screen name="call/[conversationId]" options={{ headerShown: false, presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="meeting/[id]" options={{ title: "Meeting" }} />
        <Stack.Screen name="schedule-meeting" options={{ title: "Schedule meeting", presentation: Platform.OS === "ios" ? "modal" : "card" }} />
        <Stack.Screen name="join-meeting" options={{ title: "Join a meeting" }} />
        <Stack.Screen name="meet/[code]" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );

  if (state.status !== "ready") return stack;

  return (
    <PeopleProvider>
      <PresenceProvider userId={state.userId}>
        <ActivityProvider userId={state.userId} dnd={state.profile.availability === "do_not_disturb"}>
          {stack}
          <IncomingCallOverlay />
        </ActivityProvider>
      </PresenceProvider>
    </PeopleProvider>
  );
}
