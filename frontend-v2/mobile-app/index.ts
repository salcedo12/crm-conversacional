import { registerRootComponent } from 'expo';
import messaging from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';
import App from './App';
import { displayRemoteNotification } from './src/services/notifications';

messaging().setBackgroundMessageHandler(async (message) => {
  if (!message.notification) await displayRemoteNotification(message);
});

notifee.onBackgroundEvent(async () => {});
registerRootComponent(App);
