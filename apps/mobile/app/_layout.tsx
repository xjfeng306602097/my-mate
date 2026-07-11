import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Tabs
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: {
            backgroundColor: "#f3f6fb",
          },
          headerTitleStyle: {
            fontWeight: "700",
          },
          sceneStyle: {
            backgroundColor: "#f3f6fb",
          },
          tabBarStyle: {
            height: 62,
            paddingTop: 6,
            paddingBottom: 8,
          },
          tabBarActiveTintColor: "#2563eb",
          tabBarInactiveTintColor: "#64748b",
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="tasks/index"
          options={{
            title: "Missions",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="flag-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="home"
          options={{
            title: "Overview",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="runs/index"
          options={{
            title: "Runs",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="list-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="inbox"
          options={{
            title: "Inbox",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="mail-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="account"
          options={{
            title: "Account",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-circle-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="tasks/[sessionId]"
          options={{
            href: null,
            title: "Mission",
          }}
        />
        <Tabs.Screen
          name="runs/[runId]"
          options={{
            href: null,
            title: "Run Detail",
          }}
        />
        <Tabs.Screen
          name="runtime-evaluation-fixture"
          options={{
            href: null,
            title: "Runtime Evaluation Fixture",
          }}
        />
      </Tabs>
    </>
  );
}
