import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Image, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors } from '@/components/ui';
import { authHeaders, getApiUrl } from '@/lib/api';

// The server takes photos up to 2 MB (sent as base64 text, a third bigger).
const MAX_BASE64 = Math.floor((2 * 1024 * 1024 * 4) / 3);

/** A photo chosen to send: base64 for the server, uri to show it before sending. */
export type ChosenPhoto = { base64: string; uri: string };

/** Lets the person choose one picture from the phone (e.g. a screenshot of an M-Pesa message), made smaller to send. */
export async function choosePhoto(): Promise<ChosenPhoto | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.5, base64: true });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset?.base64) return null;
  if (asset.base64.length > MAX_BASE64) {
    Alert.alert('Photo too big', 'Choose a smaller picture, or a screenshot of just the message (at most 2 MB).');
    return null;
  }
  return { base64: asset.base64, uri: asset.uri };
}

/** "Add a photo" before sending, or the chosen photo with a way to remove it. */
export function PhotoPicker({ photo, onChange }: { photo: ChosenPhoto | null; onChange: (photo: ChosenPhoto | null) => void }) {
  if (!photo) {
    return <Button title="Add a photo" icon="image-outline" variant="secondary" onPress={async () => onChange((await choosePhoto()) ?? null)} />;
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      <Image source={{ uri: photo.uri }} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: colors.bg }} />
      <Pressable onPress={() => onChange(null)} accessibilityRole="button" style={{ padding: 8 }}>
        <Text style={{ color: colors.danger, fontWeight: '600' }}>Remove photo</Text>
      </Pressable>
    </View>
  );
}

/** A photo on a report (loaded from the server with the sign-in); tap to see it full screen. */
export function ReportPhoto({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const source = { uri: `${getApiUrl()}${path}`, headers: authHeaders() };
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel="Photo, tap to enlarge">
        <Image source={source} resizeMode="cover" style={{ width: 180, height: 180, borderRadius: 8, marginTop: 6, backgroundColor: colors.border }} />
      </Pressable>
      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close photo" style={{ alignSelf: 'flex-end', padding: 16 }}>
            <Ionicons name="close" size={30} color="#fff" />
          </Pressable>
          <Image source={source} resizeMode="contain" style={{ flex: 1 }} />
        </SafeAreaView>
      </Modal>
    </>
  );
}
