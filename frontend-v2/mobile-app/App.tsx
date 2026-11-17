import 'react-native-gesture-handler';
import './global.css';
import { useEffect, useMemo } from 'react';
import { BackHandler, Platform, LogBox } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme, DefaultTheme, type Theme as NavigationTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/providers/AuthProvider';
import { ThemeProvider, useTheme } from './src/providers/ThemeProvider';
import { BrandingProvider } from './src/providers/BrandingProvider';
import { NotificationsProvider } from './src/providers/NotificationsProvider';
import { registerAppStateUpdateChecker } from './src/services/updateService';
import { AppNavigator } from './src/navigation/AppNavigator';
import { navigationRef } from './src/navigation/navigationRef';

LogBox.ignoreLogs([
  'This method is deprecated (as well as all React Native Firebase namespaced API)',
  'VirtualizedList: You have a large list that is slow to update',
  'Each child in a list should have a unique "key" prop',
]);

function ThemedAppContainer() {
  const { isDark, palette } = useTheme();

  const navigationTheme = useMemo<NavigationTheme>(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: isDark,
      colors: {
        ...base.colors,
        primary: palette.brand,
        background: palette.bgCanvas,
        card: palette.bgSurface,
        border: palette.border,
        text: palette.textPrimary,
        notification: palette.brand,
      },
    };
  }, [isDark, palette]);

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <NotificationsProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <AppNavigator />
      </NotificationsProvider>
    </NavigationContainer>
  );
}

export default function App() {
  // Observador de actualizaciones remotas OTA (en arranque y al volver de segundo plano)
  useEffect(() => {
    const unregister = registerAppStateUpdateChecker();
    return () => unregister();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigationRef.isReady() && navigationRef.canGoBack()) {
        navigationRef.goBack();
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ThemeProvider>
          <BrandingProvider>
            <ThemedAppContainer />
          </BrandingProvider>
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
