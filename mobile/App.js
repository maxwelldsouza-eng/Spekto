import 'react-native-url-polyfill/auto'
import React, { useState, useEffect } from 'react'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter'
import { DMSans_700Bold, DMSans_800ExtraBold } from '@expo-google-fonts/dm-sans'
import { MaterialCommunityIcons } from '@expo/vector-icons'

import { supabase } from './src/config/supabase'
import { COLORS } from './src/theme'

import LoginScreen from './src/screens/LoginScreen'
import RegisterScreen from './src/screens/RegisterScreen'
import DashboardScreen from './src/screens/DashboardScreen'
import InspectionDetailScreen from './src/screens/InspectionDetailScreen'
import RecordingScreen from './src/screens/RecordingScreen'
import EarningsScreen from './src/screens/EarningsScreen'
import DisputesScreen from './src/screens/DisputesScreen'
import SettingsScreen from './src/screens/SettingsScreen'

const Stack = createNativeStackNavigator()
const Tab = createBottomTabNavigator()

function ScoutTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: COLORS.white },
        headerTintColor: COLORS.dark,
        headerTitleStyle: { fontFamily: 'DMSans_800ExtraBold', fontSize: 18 },
        tabBarActiveTintColor: COLORS.purple,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: {
          backgroundColor: COLORS.white,
          borderTopColor: COLORS.border,
          paddingBottom: 4,
        },
        tabBarLabelStyle: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
        tabBarIcon: ({ focused, color, size }) => {
          const icons = {
            Dashboard: focused ? 'view-dashboard' : 'view-dashboard-outline',
            Earnings: focused ? 'wallet' : 'wallet-outline',
            Disputes: focused ? 'alert-octagon' : 'alert-octagon-outline',
            Settings: focused ? 'cog' : 'cog-outline',
          }
          return <MaterialCommunityIcons name={icons[route.name] || 'circle'} size={size} color={color} />
        },
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ title: 'Jobs' }}
      />
      <Tab.Screen
        name="Earnings"
        component={EarningsScreen}
        options={{ title: 'Earnings' }}
      />
      <Tab.Screen
        name="Disputes"
        component={DisputesScreen}
        options={{ title: 'Disputes' }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
    </Tab.Navigator>
  )
}

function ScoutStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.white },
        headerTintColor: COLORS.purple,
        headerTitleStyle: { fontFamily: 'DMSans_800ExtraBold', fontSize: 17, color: COLORS.dark },
        headerBackTitleVisible: false,
      }}
    >
      <Stack.Screen
        name="ScoutTabs"
        component={ScoutTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="InspectionDetail"
        component={InspectionDetailScreen}
        options={{ title: 'Inspection' }}
      />
      <Stack.Screen
        name="Recording"
        component={RecordingScreen}
        options={{ title: 'Record', headerBackTitle: 'Back' }}
      />
    </Stack.Navigator>
  )
}

function AuthStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.bg },
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
    </Stack.Navigator>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    DMSans_700Bold,
    DMSans_800ExtraBold,
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (!fontsLoaded || session === undefined) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={COLORS.purple} />
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="dark" />
        {session ? <ScoutStack /> : <AuthStack />}
      </NavigationContainer>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
  },
})
