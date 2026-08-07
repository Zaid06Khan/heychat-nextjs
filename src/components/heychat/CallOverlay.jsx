import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { getSession } from '@/lib/heychatAuth';
import { Mic, MicOff, Video, VideoOff, PhoneOff } from 'lucide-react';
import Avatar from './Avatar';

export default function CallOverlay() {
  const { conversationId } = useParams();
  const [conversation, setConversation] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const videoRef = useRef(null);
  const timerRef = useRef(null);
  const streamRef = useRef(null);
  const session = getSession();
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const conv = await base44.entities.Conversation.get(conversationId);
        setConversation(conv);
        const accs = await Promise.all(
          conv.participant_ids.map((id) => base44.entities.Account.get(id).catch(() => null))
        );
        setParticipants(accs.filter(Boolean));

        await base44.entities.Call.create({
          conversation_id: conversationId,
          initiated_by: session.id,
          participant_ids: conv.participant_ids,
          status: 'active',
          started_at: new Date().toISOString(),
        });

        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamRef.current = stream;
        setLocalStream(stream);
        if (videoRef.current) videoRef.current.srcObject = stream;
        timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleMute = () => {
    if (streamRef.current) {
      const track = streamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setMuted(!track.enabled);
      }
    }
  };

  const toggleCamera = () => {
    if (streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setCameraOff(!track.enabled);
      }
    }
  };

  const endCall = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    navigate(`/chat/${conversationId}`);
  };

  const formatDuration = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const title = conversation?.type === 'group' ? conversation.name : participants.find((p) => p.id !== session.id)?.display_name || 'Call';
  const others = participants.filter((p) => p.id !== session.id);

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      <div className="flex-1 relative overflow-hidden">
        {others.length > 1 ? (
          <div className="grid grid-cols-2 gap-1 h-full p-1">
            {others.map((p) => (
              <div key={p.id} className="relative bg-card rounded-2xl flex flex-col items-center justify-center">
                <Avatar src={p.avatar} name={p.display_name || p.username} size={80} />
                <p className="text-foreground mt-3 font-medium text-sm">{p.display_name || p.username}</p>
                <p className="text-muted-foreground text-xs">Connecting...</p>
              </div>
            ))}
          </div>
        ) : others.length === 1 ? (
          <div className="h-full flex flex-col items-center justify-center bg-gradient-to-b from-primary/10 to-background">
            <Avatar src={others[0].avatar} name={others[0].display_name || others[0].username} size={120} />
            <p className="text-foreground mt-4 text-lg font-medium">{others[0].display_name || others[0].username}</p>
            <p className="text-muted-foreground text-sm mt-1">{formatDuration(callDuration)}</p>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-muted-foreground">No participants</p>
          </div>
        )}

        <div className="absolute bottom-4 right-4 w-28 h-40 md:w-36 md:h-52 bg-card rounded-2xl overflow-hidden border border-border shadow-xl">
          {cameraOff ? (
            <div className="w-full h-full flex items-center justify-center bg-secondary">
              <Avatar name={session?.username} size={48} />
            </div>
          ) : (
            <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          )}
        </div>
      </div>

      <div className="px-4 py-3 text-center">
        <p className="text-foreground font-medium">{title}</p>
        <p className="text-accent text-sm mt-0.5">{formatDuration(callDuration)}</p>
      </div>

      <div className="flex items-center justify-center gap-4 pb-8 pt-2">
        <button onClick={toggleMute} className={`w-14 h-14 rounded-full flex items-center justify-center transition ${muted ? 'bg-white text-black' : 'bg-secondary text-foreground'}`}>
          {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>
        <button onClick={toggleCamera} className={`w-14 h-14 rounded-full flex items-center justify-center transition ${cameraOff ? 'bg-white text-black' : 'bg-secondary text-foreground'}`}>
          {cameraOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
        </button>
        <button onClick={endCall} className="w-16 h-16 rounded-full bg-destructive flex items-center justify-center text-white hover:opacity-90 transition">
          <PhoneOff className="w-7 h-7" />
        </button>
      </div>
    </div>
  );
}