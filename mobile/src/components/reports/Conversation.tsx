import { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { Button, colors } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { ProblemReport } from '@/lib/types';
import { type ChosenPhoto, PhotoPicker, ReportPhoto } from './Photo';

/**
 * A problem report as a conversation: the first message, then every reply, with a box to write more.
 * `side` is who is reading: their own messages are on the right. The reporter can add a photo to a reply.
 * `photosAt` is where this reader loads the report's photos from (e.g. /passenger/reports).
 */
export function Conversation({
  report,
  side,
  photosAt,
  onSend,
  placeholder,
}: {
  report: ProblemReport;
  side: 'reporter' | 'office';
  photosAt: string;
  onSend: (message: string, photo: ChosenPhoto | null) => Promise<void>;
  placeholder?: string;
}) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<ChosenPhoto | null>(null);
  const [sending, setSending] = useState(false);
  const photoPath = (photoId?: number | null) => (photoId ? `${photosAt}/${report.id}/photos/${photoId}` : null);

  const who = (fromOffice: boolean, senderName?: string | null) =>
    side === 'reporter' ? (fromOffice ? t('SACCO office') : t('You')) : fromOffice ? (senderName ?? t('Office')) : report.reporter_name;

  const send = async () => {
    setSending(true);
    try {
      await onSend(text.trim(), photo);
      setText('');
      setPhoto(null);
    } catch (err) {
      Alert.alert(t('Could not send'), errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ marginTop: 8 }}>
      <Bubble mine={side === 'reporter'} who={who(false)} at={report.created_at} text={report.message} photo={photoPath(report.photo_id)} />
      {report.messages.map((m) => (
        <Bubble
          key={m.id}
          mine={Boolean(m.from_office) === (side === 'office')}
          who={who(Boolean(m.from_office), m.sender_name)}
          at={m.created_at}
          text={m.message}
          photo={photoPath(m.photo_id)}
        />
      ))}
      <TextInput
        placeholder={placeholder ?? t('Write a reply')}
        placeholderTextColor="#9CA3AF"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={1000}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, minHeight: 50, color: colors.text, marginTop: 4, marginBottom: 8, textAlignVertical: 'top' }}
      />
      {side === 'reporter' && <PhotoPicker photo={photo} onChange={setPhoto} />}
      <Button title={t('Send')} icon="send-outline" variant="secondary" onPress={send} loading={sending} disabled={!text.trim() && !photo} />
    </View>
  );
}

function Bubble({ mine, who, at, text, photo }: { mine: boolean; who: string; at: string; text: string; photo: string | null }) {
  return (
    <View
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        backgroundColor: mine ? colors.primarySoft : colors.bg,
        borderRadius: 12,
        padding: 10,
        marginBottom: 8,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '700', color: mine ? colors.primaryDark : colors.muted }}>
        {who} · {dateTime(at)}
      </Text>
      {!!text && <Text style={{ color: colors.text, marginTop: 2 }}>{text}</Text>}
      {photo && <ReportPhoto path={photo} />}
    </View>
  );
}
