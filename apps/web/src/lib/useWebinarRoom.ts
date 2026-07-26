import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  PollDto,
  PollsResponse,
  RtServerMessage,
  WebinarMessageDto,
  WebinarMessagesResponse,
} from '@code-nexus/types';
import { api } from './api.ts';
import { webinarKeys } from './webinars.ts';
import { RtClient, type RtStatus } from './rtclient.ts';

/**
 * Shared real-time room state for both the student room and the host console.
 * Seeds chat history + current polls from the api, connects to the ws-gateway
 * while the webinar is live, and folds inbound frames into local state. Returns a
 * `send` for chat + vote and the current connection status.
 */
export interface WebinarRoomState {
  messages: WebinarMessageDto[];
  polls: PollDto[];
  presence: number;
  ended: boolean;
  status: RtStatus;
  sendChat: (body: string) => void;
  vote: (pollPublicId: string, optionPublicId: string) => void;
  markPollClosedLocally: (pollPublicId: string) => void;
  addPollLocally: (poll: PollDto) => void;
}

export function useWebinarRoom(
  publicId: string,
  live: boolean,
  alreadyEnded: boolean,
): WebinarRoomState {
  const [messages, setMessages] = useState<WebinarMessageDto[]>([]);
  const [polls, setPolls] = useState<PollDto[]>([]);
  const [presence, setPresence] = useState(0);
  const [status, setStatus] = useState<RtStatus>('connecting');
  const [ended, setEnded] = useState(alreadyEnded);
  const clientRef = useRef<RtClient | null>(null);

  const history = useQuery({
    queryKey: webinarKeys.messages(publicId),
    queryFn: () => api.get<WebinarMessagesResponse>(`/webinars/${publicId}/messages?limit=50`),
    enabled: live,
  });
  const pollList = useQuery({
    queryKey: webinarKeys.polls(publicId),
    queryFn: () => api.get<PollsResponse>(`/webinars/${publicId}/polls`),
    enabled: live,
  });
  useEffect(() => {
    if (history.data) setMessages(history.data.messages);
  }, [history.data]);
  useEffect(() => {
    if (pollList.data) setPolls(pollList.data.polls);
  }, [pollList.data]);

  useEffect(() => {
    if (!live) return;
    const onMessage = (msg: RtServerMessage): void => {
      switch (msg.t) {
        case 'ready':
          setPresence(msg.presence);
          break;
        case 'presence:count':
          setPresence(msg.count);
          break;
        case 'chat:new':
          setMessages((cur) =>
            cur.some((m) => m.publicId === msg.message.publicId) ? cur : [...cur, msg.message],
          );
          break;
        case 'poll:opened':
          setPolls((cur) =>
            cur.some((p) => p.publicId === msg.poll.publicId) ? cur : [...cur, msg.poll],
          );
          break;
        case 'poll:results':
          setPolls((cur) =>
            cur.map((p) =>
              p.publicId === msg.pollId
                ? {
                    ...p,
                    options: p.options.map((o) => ({
                      ...o,
                      count:
                        msg.counts.find((c) => c.optionPublicId === o.publicId)?.count ?? o.count,
                    })),
                  }
                : p,
            ),
          );
          break;
        case 'poll:closed':
          setPolls((cur) =>
            cur.map((p) => (p.publicId === msg.pollId ? { ...p, status: 'CLOSED' } : p)),
          );
          break;
        case 'webinar:ended':
          setEnded(true);
          break;
        default:
          break;
      }
    };
    const client = new RtClient({ webinarPublicId: publicId, onMessage, onStatus: setStatus });
    clientRef.current = client;
    client.connect();
    return () => client.close();
  }, [live, publicId]);

  return {
    messages,
    polls,
    presence,
    ended,
    status,
    sendChat: (body) => clientRef.current?.send({ t: 'chat:send', body }),
    vote: (pollPublicId, optionPublicId) => {
      clientRef.current?.send({ t: 'poll:vote', pollId: pollPublicId, optionId: optionPublicId });
      setPolls((cur) =>
        cur.map((p) =>
          p.publicId === pollPublicId ? { ...p, myVoteOptionPublicId: optionPublicId } : p,
        ),
      );
    },
    markPollClosedLocally: (pollPublicId) =>
      setPolls((cur) =>
        cur.map((p) => (p.publicId === pollPublicId ? { ...p, status: 'CLOSED' } : p)),
      ),
    addPollLocally: (poll) =>
      setPolls((cur) => (cur.some((p) => p.publicId === poll.publicId) ? cur : [...cur, poll])),
  };
}
