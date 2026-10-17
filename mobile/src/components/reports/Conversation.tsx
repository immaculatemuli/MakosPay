import { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { Button, colors } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import type { ProblemReport } from '@/lib/types';

/**
 * A problem report as a conversation: the first message, then every reply, with a box to write more.
 * `side` is who is reading: their own messages are on the right.
 */
export function Conversation({
  report,
  side,
  onSend,
  placeholder = 'Write a reply',
}: {
  report: ProblemReport;
  side: 'reporter' | 'office';
  onSend: (message: string) => Promise<void>;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const who = (fromOffice: boolean, senderName?: string | null) =>
    side === 'reporter' ? (fromOffice ? 'SACCO office' : 'You') : fromOffice ? (senderName ?? 'Office') : report.reporter_name;

  const send = async () => {
    setSending(true);
    try {
      await onSend(text.trim());
      setText('');
    } catch (err) {
      Alert.alert('Could not send', errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ marginTop: 8 }}>
      <Bubble mine={side === 'reporter'} who={who(false)} at={report.created_at} text={report.message} />
      {report.messages.map((m) => (
        <Bubble key={m.id} mine={Boolean(m.from_office) === (side === 'office')} who={who(Boolean(m.from_office), m.sender_name)} at={m.created_at} text={m.message} />
      ))}
      <TextInput
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={1000}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, minHeight: 50, color: colors.text, marginTop: 4, marginBottom: 8, textAlignVertical: 'top' }}
      />
      <Button title="Send" icon="send-outline" variant="secondary" onPress={send} loading={sending} disabled={!text.trim()} />
    </View>
  );
}

function Bubble({ mine, who, at, text }: { mine: boolean; who: string; at: string; text: string }) {
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
      <Text style={{ color: colors.text, marginTop: 2 }}>{text}</Text>
    </View>
  );
}
