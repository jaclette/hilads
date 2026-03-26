import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface TabConfig {
  name:   string;
  title:  string;
  icon:   IoniconsName;
  iconActive: IoniconsName;
}

const TABS: TabConfig[] = [
  { name: 'hot',      title: 'Hot',      icon: 'flame-outline',    iconActive: 'flame' },
  { name: 'cities',   title: 'Cities',   icon: 'earth-outline',    iconActive: 'earth' },
  { name: 'here',     title: 'Here',     icon: 'people-outline',   iconActive: 'people' },
  { name: 'messages', title: 'Messages', icon: 'chatbubble-outline',iconActive: 'chatbubble' },
  { name: 'me',       title: 'Me',       icon: 'person-outline',   iconActive: 'person' },
];

export default function TabsLayout() {
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
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? tab.iconActive : tab.icon}
                size={size}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
