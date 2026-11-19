import { Tabs } from "expo-router";
import { CircleUserRound, Contact, MessageSquare, Phone, Users } from "lucide-react-native";
import { useActivity } from "@/providers/activity";
import { colors } from "@/theme";

export default function TabsLayout() {
  const { unreadChats, unreadNotifications } = useActivity();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand600,
        tabBarInactiveTintColor: colors.ink500,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarStyle: { borderTopColor: colors.line, backgroundColor: colors.white },
        headerTitleStyle: { fontWeight: "700", fontSize: 20, color: colors.ink900 },
        headerTitleAlign: "left",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.white },
        tabBarBadgeStyle: { backgroundColor: colors.brand600, color: colors.white, fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Chat",
          tabBarIcon: ({ color, size }) => <MessageSquare color={color} size={size} />,
          tabBarBadge: unreadChats > 0 ? unreadChats : undefined,
        }}
      />
      <Tabs.Screen name="teams" options={{ title: "Teams", tabBarIcon: ({ color, size }) => <Users color={color} size={size} /> }} />
      <Tabs.Screen name="calls" options={{ title: "Calls", tabBarIcon: ({ color, size }) => <Phone color={color} size={size} /> }} />
      <Tabs.Screen name="people" options={{ title: "People", tabBarIcon: ({ color, size }) => <Contact color={color} size={size} /> }} />
      <Tabs.Screen
        name="me"
        options={{
          title: "Me",
          tabBarIcon: ({ color, size }) => <CircleUserRound color={color} size={size} />,
          tabBarBadge: unreadNotifications > 0 ? unreadNotifications : undefined,
        }}
      />
    </Tabs>
  );
}
