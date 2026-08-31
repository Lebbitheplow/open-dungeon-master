"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Device } from "mediasoup-client";
import type { Transport } from "mediasoup-client/types";
import { micBlockMessage, micBlockReason } from "@/lib/secure-context";
import type { VoiceRosterEntry } from "@/lib/voice/types";
import {
  DEFAULT_PEER_VOLUME,
  effectiveVolume,
  silenced,
  type VoiceVolumePrefs,
} from "@/lib/voice/volume";
import {
  PTT_KEY,
  readMicId,
  readMicMode,
  readVolumePrefs,
  subscribeMicPrefs,
  useVoiceVolumes,
  writeMicId,
  writeMicMode,
  type MicMode,
} from "@/app/campaigns/[campaignId]/useVoicePrefs";

export type VoiceStatus = "idle" | "connecting" | "connected" | "error" | "reconnecting";

// How the microphone is gated locally, and the key held in push-to-talk. Both
// live with the rest of the per-browser preferences now; re-exported here
// because they are part of this hook's surface.
export type { MicMode };
export { PTT_KEY };

// Volume of each remote voice: the server's audibility matrix multiplied by
// this listener's own sliders. Whether a voice arrives at all is enforced
// server-side by pausing the consumer; this is only how loud the ones that do
// arrive should be. Kept outside the hook so the elements being mutated are
// plainly local to this function.
function applyVolumes(
  elements: Map<string, HTMLAudioElement>,
  gains: Record<string, number>,
  prefs: VoiceVolumePrefs,
) {
  for (const [userId, element] of elements) {
    const peer = prefs.peers[userId] ?? DEFAULT_PEER_VOLUME;
    element.volume = effectiveVolume(gains[userId] ?? 1, peer, prefs);
    // volume alone would already silence them, but muted carries the intent
    // separately, so a slider that happens to sit at zero and a deliberate
    // mute stay distinguishable to the browser's own tab-audio indicator.
    element.muted = silenced(peer, prefs.deafened);
  }
}

// Signaling rides plain POST routes and the campaign SSE stream, so there is
// no WebSocket here. mediasoup's signaling is request/response by nature and
// the only server-push need (the roster changed) is already a thing this app
// does well (src/lib/events.ts).
export function useVoiceRoom(
  campaignId: string,
  rosterFromStream: VoiceRosterEntry[] | null,
  mePeerId = "",
  // Bumped by the contentless voice_audibility_changed event.
  audibilityVersion = 0,
) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  // The roster from this client's own first probe, used only until the stream
  // delivers one. `peers` below prefers the stream, so this is never a second
  // source of truth that could drift.
  const [probedPeers, setProbedPeers] = useState<VoiceRosterEntry[]>([]);
  const [available, setAvailable] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState("");
  const [micDevices, setMicDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const micId = useSyncExternalStore(subscribeMicPrefs, readMicId, () => "");
  const micMode = useSyncExternalStore(
    subscribeMicPrefs,
    readMicMode,
    () => "open" as MicMode,
  );
  // True only while the talk control is actually held, in push-to-talk mode.
  const [talking, setTalking] = useState(false);

  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const recvTransportRef = useRef<Transport | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  // Remote audio is attached to detached <audio> elements rather than rendered,
  // because the elements only need to exist for the browser to play them and
  // tying them to React's tree would risk a re-render tearing one down
  // mid-sentence.
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const joinedRef = useRef(false);
  // How loudly this client should play each other person, from the server's
  // audibility matrix. Whether a voice arrives at all is enforced server-side
  // by pausing the consumer; this is only the volume of what does arrive.
  const gainsRef = useRef<Record<string, number>>({});
  // Kept so the microphone can be swapped without rebuilding the transport:
  // replaceTrack keeps the same producer, so nobody else renegotiates.
  const producerRef = useRef<Awaited<ReturnType<Transport["produce"]>> | null>(null);

  const post = useCallback(
    async (path: string, body?: unknown) => {
      const response = await fetch(`/api/campaigns/${campaignId}/voice/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Voice request failed.");
      }
      return data;
    },
    [campaignId],
  );

  // Pulls in everyone this client is not already hearing. Idempotent on the
  // server, so it is safe to call on every roster change.
  const syncConsumers = useCallback(async () => {
    const device = deviceRef.current;
    const recvTransport = recvTransportRef.current;
    if (!device || !recvTransport || !joinedRef.current) {
      return;
    }
    const { consumers } = await post("consume", {
      rtpCapabilities: device.rtpCapabilities,
    });
    const resumed: string[] = [];
    for (const params of consumers ?? []) {
      const consumer = await recvTransport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });
      const element = new Audio();
      element.autoplay = true;
      // Distance and walls arrive as a gain; 1 when no proximity rule is on.
      // This listener's own slider for them multiplies in here rather than in
      // a later pass, so somebody turned down before they joined is already
      // quiet on their first word.
      const prefs = readVolumePrefs();
      const peer = prefs.peers[params.producerUserId] ?? DEFAULT_PEER_VOLUME;
      element.volume = effectiveVolume(
        gainsRef.current[params.producerUserId] ?? 1,
        peer,
        prefs,
      );
      element.muted = silenced(peer, prefs.deafened);
      element.srcObject = new MediaStream([consumer.track]);
      // A rejected autoplay would otherwise surface as an unhandled rejection;
      // the user gesture that opened the call normally satisfies the policy.
      void element.play().catch(() => {});
      audioElementsRef.current.get(params.producerUserId)?.pause();
      audioElementsRef.current.set(params.producerUserId, element);
      resumed.push(params.id);
    }
    if (resumed.length) {
      // Server-side consumers start paused so no speech is lost in the window
      // before this client had them built.
      await post("resume", { consumerIds: resumed });
    }
  }, [post]);

  // Pulls this client's own row of the audibility matrix and applies it to the
  // audio elements already playing.
  const refreshGains = useCallback(async () => {
    if (!joinedRef.current) {
      return;
    }
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/voice/audibility`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const gains: Record<string, number> = data.gains ?? {};
      gainsRef.current = gains;
      applyVolumes(audioElementsRef.current, gains, readVolumePrefs());
    } catch {
      // transient; the next audibility event retries
    }
  }, [campaignId]);

  const teardown = useCallback(() => {
    joinedRef.current = false;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    producerRef.current = null;
    sendTransportRef.current?.close();
    recvTransportRef.current?.close();
    sendTransportRef.current = null;
    recvTransportRef.current = null;
    deviceRef.current = null;
    for (const element of audioElementsRef.current.values()) {
      element.pause();
      element.srcObject = null;
    }
    audioElementsRef.current.clear();
  }, []);

  const join = useCallback(async () => {
    if (joinedRef.current || status === "connecting") {
      return;
    }
    const blocked = micBlockReason();
    if (blocked) {
      setError(micBlockMessage(blocked));
      setStatus("error");
      return;
    }
    setStatus("connecting");
    setError("");
    try {
      // Ask for the mic before building any transports: if the player denies
      // it there is nothing worth setting up, and the prompt is the slowest
      // part of joining anyway.
      const savedMic = readMicId();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // A saved device that has since been unplugged would make this throw
          // outright, so it is a preference rather than a requirement.
          ...(savedMic ? { deviceId: { ideal: savedMic } } : {}),
        },
      });
      micStreamRef.current = stream;

      const { Device } = await import("mediasoup-client");
      const data = await post("join");
      const device = new Device();
      await device.load({ routerRtpCapabilities: data.routerRtpCapabilities });
      deviceRef.current = device;
      joinedRef.current = true;

      const sendTransport = device.createSendTransport(data.sendTransport);
      const recvTransport = device.createRecvTransport(data.recvTransport);
      sendTransportRef.current = sendTransport;
      recvTransportRef.current = recvTransport;

      for (const transport of [sendTransport, recvTransport]) {
        transport.on("connect", ({ dtlsParameters }, callback, errback) => {
          post("connect", { transportId: transport.id, dtlsParameters })
            .then(() => callback())
            .catch((cause) => errback(cause as Error));
        });
        // A laptop waking from sleep, or a phone moving between networks,
        // breaks the candidate pair without ending the session. Restarting
        // ICE keeps the producer, the consumers and the seat in the room;
        // rejoining would drop the call for a hiccup lasting a second.
        transport.on("connectionstatechange", (state) => {
          if (state !== "failed" && state !== "disconnected") {
            if (state === "connected" && joinedRef.current) {
              setStatus("connected");
            }
            return;
          }
          if (!joinedRef.current) {
            return;
          }
          setStatus("reconnecting");
          post("ice-restart", { transportId: transport.id })
            .then((data) => transport.restartIce({ iceParameters: data.iceParameters }))
            .catch(() => {
              // The next state change tries again; a peer whose transport
              // never recovers is reaped server-side by the ICE timeout.
            });
        });
      }
      sendTransport.on("produce", ({ rtpParameters }, callback, errback) => {
        post("produce", { transportId: sendTransport.id, rtpParameters })
          .then((result) => callback({ id: result.producerId }))
          .catch((cause) => errback(cause as Error));
      });

      producerRef.current = await sendTransport.produce({ track: stream.getAudioTracks()[0] });
      // Gains before consumers, so the first audio plays at the right volume
      // rather than blaring at full and being corrected a moment later.
      await refreshGains();
      await syncConsumers();
      setStatus("connected");
      setMuted(false);
      setHandRaised(false);
    } catch (cause) {
      teardown();
      setError(cause instanceof Error ? cause.message : "Could not join voice chat.");
      setStatus("error");
    }
  }, [post, refreshGains, status, syncConsumers, teardown]);

  const leave = useCallback(async () => {
    teardown();
    setStatus("idle");
    // The roster is not cleared here: the server publishes the departure and
    // the stream carries it back, which is also what every other client sees.
    try {
      await post("leave");
    } catch {
      // Already gone, or the server reaped the peer first. Either way the
      // local side is down, which is what the button promised.
    }
  }, [post, teardown]);

  const toggleMute = useCallback(async () => {
    const next = !muted;
    setMuted(next);
    // The local track is stopped too, so the mute is visible in the browser's
    // own recording indicator rather than being a server-side promise the
    // player has to take on trust.
    for (const track of micStreamRef.current?.getAudioTracks() ?? []) {
      track.enabled = !next;
    }
    try {
      await post("state", { muted: next });
    } catch {
      setMuted(!next);
    }
  }, [muted, post]);

  // How far this player's voice carries, when the say-range rule is on.
  const setSayRange = useCallback(
    async (sayRange: "whisper" | "normal" | "shout") => {
      try {
        await post("state", { sayRange });
      } catch {
        // the roster keeps the previous value
      }
    },
    [post],
  );

  // Swaps the microphone without touching the transport: replaceTrack keeps
  // the same producer, so nobody else on the call renegotiates or hears a gap.
  const selectMic = useCallback(
    async (deviceId: string) => {
      writeMicId(deviceId);
      const producer = producerRef.current;
      if (!producer || !joinedRef.current) {
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          },
        });
        const track = stream.getAudioTracks()[0];
        await producer.replaceTrack({ track });
        // Only stop the old capture once the new one is live, so there is no
        // moment where this player is transmitting nothing.
        micStreamRef.current?.getTracks().forEach((old) => old.stop());
        micStreamRef.current = stream;
      } catch {
        setError("Could not switch microphone.");
      }
    },
    [],
  );

  // Push-to-talk. The local track flips instantly so the player hears no lag
  // on their own control, and the server mute follows to make it real for
  // everyone else (a local-only gate would still transmit).
  const setTalking_ = useCallback(
    (held: boolean) => {
      setTalking(held);
      for (const track of micStreamRef.current?.getAudioTracks() ?? []) {
        track.enabled = held;
      }
      void post("state", { muted: !held }).catch(() => {});
    },
    [post],
  );

  const selectMicMode = useCallback(
    (mode: MicMode) => {
      writeMicMode(mode);
      // Leaving push-to-talk opens the microphone again; entering it closes
      // the microphone until the control is held.
      const open = mode === "open";
      setTalking(false);
      for (const track of micStreamRef.current?.getAudioTracks() ?? []) {
        track.enabled = open;
      }
      if (joinedRef.current) {
        void post("state", { muted: !open }).catch(() => {});
      }
    },
    [post],
  );

  // Asking for the floor. Never moves the floor by itself: the DM grants it
  // through the controls they already have, so there is one way the floor
  // changes rather than two.
  const toggleHand = useCallback(async () => {
    const next = !handRaised;
    setHandRaised(next);
    try {
      await post("hand", { raised: next });
    } catch {
      setHandRaised(!next);
    }
  }, [handRaised, post]);

  // Device labels are only readable once microphone permission has been
  // granted, so the list is enumerated after joining rather than before, when
  // every entry would be a blank string.
  useEffect(() => {
    if (status !== "connected" || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (cancelled) {
          return;
        }
        setMicDevices(
          devices
            .filter((device) => device.kind === "audioinput")
            .map((device, index) => ({
              deviceId: device.deviceId,
              label: device.label || `Microphone ${index + 1}`,
            })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status]);

  // The push-to-talk key. Ignored while typing, so holding it in the composer
  // writes a character instead of opening the microphone.
  useEffect(() => {
    if (micMode !== "ptt" || status !== "connected") {
      return;
    }
    const typing = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      const tag = element?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || element?.isContentEditable === true;
    };
    const down = (event: KeyboardEvent) => {
      if (event.code === PTT_KEY && !event.repeat && !typing(event.target)) {
        event.preventDefault();
        setTalking_(true);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === PTT_KEY) {
        setTalking_(false);
      }
    };
    // Releasing the key after tabbing away would otherwise leave the mic open.
    const blur = () => setTalking_(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [micMode, setTalking_, status]);

  // Initial availability probe. Runs whether or not anyone is on the call, so
  // the UI can explain a disabled feature instead of hiding it.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/voice`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) {
          return;
        }
        setAvailable(Boolean(data.available));
        setUnavailableReason(String(data.unavailableReason ?? ""));
        setProbedPeers(data.peers ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  // A token moved, a fight started, or the DM moved somebody between rooms.
  useEffect(() => {
    if (audibilityVersion > 0) {
      void refreshGains();
    }
  }, [audibilityVersion, refreshGains]);

  // The roster arrives on the campaign SSE stream. A new producer means there
  // is someone new to hear, so this is also what drives subscription.
  // Only the subscribe is an effect: the list itself is derived above rather
  // than copied into state, so there is nothing to keep in sync.
  useEffect(() => {
    if (rosterFromStream && joinedRef.current) {
      void syncConsumers();
    }
  }, [rosterFromStream, syncConsumers]);

  // Fast-path cleanup. The reliable path is the server's ICE timeout, because
  // a crashed tab sends nothing; this just spares everyone the ~30s wait in
  // the normal case. keepalive rather than sendBeacon so the session cookie
  // and the JSON content type both ride along.
  useEffect(() => {
    const onUnload = () => {
      if (!joinedRef.current) {
        return;
      }
      void fetch(`/api/campaigns/${campaignId}/voice/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      onUnload();
      teardown();
    };
  }, [campaignId, teardown]);

  // The stream is authoritative once it has spoken; the probe only covers the
  // gap before the first event.
  const peers = rosterFromStream ?? probedPeers;

  // The server lowers a hand by itself once its owner is given the floor, so
  // the roster is authoritative and the local flag only covers the moment
  // between clicking and the event coming back.
  const myEntry = peers.find((peer) => peer.userId === mePeerId);

  // What this listener wants to hear, which is a property of this browser
  // rather than of the call, so it comes from localStorage and not the roster.
  // The ids are handed over only so the stored map knows who to keep if it
  // ever has to be trimmed.
  const presentUserIds = useMemo(() => peers.map((peer) => peer.userId), [peers]);
  const volumes = useVoiceVolumes(presentUserIds);

  // Moving a slider has to reach audio that is already playing, not just the
  // next element built.
  useEffect(() => {
    applyVolumes(audioElementsRef.current, gainsRef.current, volumes.prefs);
  }, [volumes.prefs]);

  return {
    status,
    error,
    muted,
    handRaised: myEntry ? Boolean(myEntry.handRaisedAt) : handRaised,
    toggleHand,
    sayRange: myEntry?.sayRange ?? "normal",
    setSayRange,
    micDevices,
    micId,
    selectMic,
    micMode,
    selectMicMode,
    talking,
    setTalking: setTalking_,
    reconnecting: status === "reconnecting",
    peers,
    available,
    unavailableReason,
    join,
    leave,
    toggleMute,
    connected: status === "connected",
    // Output side: how loud everyone else is, in this browser only. Deafen
    // deliberately does not touch the microphone. Coupling the two (as chat
    // apps often do) would fight push-to-talk and the floor rules in
    // turn-logic.ts, and would turn a private listening choice into something
    // every other client sees on the roster.
    peerVolume: volumes.peerVolume,
    setPeerVolume: volumes.setPeerVolume,
    togglePeerMute: volumes.togglePeerMute,
    resetPeerVolume: volumes.resetPeer,
    masterVolume: volumes.prefs.master,
    setMasterVolume: volumes.setMaster,
    deafened: volumes.prefs.deafened,
    toggleDeafen: volumes.toggleDeafen,
  };
}
