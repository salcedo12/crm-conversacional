import 'react-native-gesture-handler';
import './global.css';
import { useEffect } from 'react';
import { BackHandler, Platform, LogBox } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/providers/AuthProvider';
import { NotificationsProvider } from './src/providers/NotificationsProvider';
import { AppNavigator } from './src/navigation/AppNavigator';
import { navigationRef } from './src/navigation/navigationRef';
import { colors } from './src/theme/colors';

LogBox.ignoreLogs([
  'This method is deprecated (as well as all React Native Firebase namespaced API)',
  'VirtualizedList: You have a large list that is slow to update'
]);

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.emerald,
    background: colors.background,
    card: colors.surface,
    border: colors.border,
    text: colors.text,
  },
};

export default function App() {
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    const loadUpdate = async () => {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) await Updates.fetchUpdateAsync();
      } catch (error) {
        console.warn('No se pudo comprobar una actualizacion OTA.', error);
      }
    };

    void loadUpdate();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigationRef.isReady() && navigationRef.canGoBack()) {
        navigationRef.goBack();
      }

      return true;
    });

    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer ref={navigationRef} theme={navigationTheme}>
          <NotificationsProvider>
            <StatusBar style="light" />
            <AppNavigator />
          </NotificationsProvider>
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
