import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants';
import { useApp } from '@/context/AppContext';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

export default function TabsLayout() {
  const { unreadDMs } = useApp();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.bg2,
          borderTopColor:  Colors.border,
          borderTopWidth:  1,
          height:          64,
          paddingBottom:   8,
          paddingTop:      8,
        },
        tabBarActiveTintColor:   Colors.accent,
        tabBarInactiveTintColor: Colors.muted,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="hot"
        options={{
          title: 'Hot',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'flame' : 'flame-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cities"
        options={{
          title: 'Cities',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'earth' : 'earth-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="here"
        options={{
          title: 'Here',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'people' : 'people-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarBadge: unreadDMs > 0 ? unreadDMs : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.accent, fontSize: 10 },
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'chatbubble' : 'chatbubble-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: 'Me',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
