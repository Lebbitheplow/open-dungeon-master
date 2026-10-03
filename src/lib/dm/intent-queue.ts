// The DM console's "waiting on you" queue, read from the transcript.
//
// Live, the queue is fed by dm_intent_queued events and cleared by the DM's
// next narration. Those events are never replayed: a reload, a second
// device or a reconnect resumes the stream at the latest seq, and the queue
// came back empty while players still waited. The same rule read off the
// loaded messages rebuilds it: every player action (table talk excepted)
// after the last DM passage that answered the party. A beat is a DM passage
// that records play rather than answering it, so it answers nothing.
//
// Pure, for scripts/test-intent-queue.mjs.

export type QueuedIntent = { messageId: string; userId: string; characterId: string; seq: number };

type MessageLike = {
  id: string;
  seq: number;
  authorType: string;
  userId: string | null;
  characterId: string | null;
  content: string;
};

export function queuedIntents(messages: MessageLike[], beatMessageIds: Iterable<string>): QueuedIntent[] {
  const beats = new Set(beatMessageIds);
  const answered = messages.reduce(
    (latest, message) =>
      message.authorType === "dm" && !beats.has(message.id) && message.seq > latest ? message.seq : latest,
    0,
  );
  return messages
    .filter(
      (message) =>
        message.authorType === "player" &&
        message.seq > answered &&
        !message.content.startsWith("(ooc) "),
    )
    .sort((a, b) => a.seq - b.seq)
    .map((message) => ({
      messageId: message.id,
      userId: message.userId ?? "",
      characterId: message.characterId ?? "",
      seq: message.seq,
    }));
}
