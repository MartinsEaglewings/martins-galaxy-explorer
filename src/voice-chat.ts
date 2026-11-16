export type VoiceMode = 'nearby' | 'global';

export type VoicePeer = {
  id: string;
  pilot_id: string;
  name: string;
};

type SignalMessage = {
  type: string;
  from?: string;
  peer_id?: string;
  peer?: VoicePeer;
  peers?: VoicePeer[];
  signal?: {
    type: string;
    sdp?: string;
    candidate?: RTCIceCandidateInit;
  };
};

type PeerConnection = {
  peer: VoicePeer;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  pendingCandidates: RTCIceCandidateInit[];
  analyser?: AnalyserNode;
  meterData?: Uint8Array<ArrayBuffer>;
  speaking: boolean;
};

export class VoiceChat {
  private stream: MediaStream | null = null;
  private peers = new Map<string, PeerConnection>();
  private send: ((message: unknown) => boolean) | null = null;
  private connectionId = '';
  private mode: VoiceMode = 'nearby';
  private muted = false;
  private audioContext: AudioContext | null = null;
  private meterTimer = 0;
  private statusCallback: (status: string) => void;
  private peersCallback: (peers: VoicePeer[]) => void;
  private speakingCallback: (ids: string[]) => void;
  private stopped = true;

  constructor(callbacks: {
    onStatus?: (status: string) => void;
    onPeers?: (peers: VoicePeer[]) => void;
    onSpeaking?: (ids: string[]) => void;
  } = {}) {
    this.statusCallback = callbacks.onStatus || (() => {});
    this.peersCallback = callbacks.onPeers || (() => {});
    this.speakingCallback = callbacks.onSpeaking || (() => {});
  }

  async start(
    send: (message: unknown) => boolean,
    connectionId: string
  ): Promise<boolean> {
    if (this.stream) return true;

    this.send = send;
    this.connectionId = connectionId;
    this.stopped = false;
    this.statusCallback('REQUESTING MICROPHONE');

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access requires HTTPS or localhost.');
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      if (this.stopped) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
        return false;
      }

      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;

      if (AudioContextClass) {
        this.audioContext = new AudioContextClass();
        await this.audioContext.resume().catch(() => {});
      }

      if (!this.send({ type: 'voice.join' })) {
        throw new Error('Voice server connection is not ready.');
      }

      this.muted = false;
      this.statusCallback('VOICE CONNECTED');
      this.startMeter();
      return true;
    } catch (error) {
      this.stop(false);
      this.statusCallback(
        error instanceof Error ? error.message : 'MICROPHONE FAILED'
      );
      return false;
    }
  }

  // Preserve the microphone when the signalling WebSocket is interrupted.
  handleTransportLost() {
    if (this.stopped || !this.stream) return;

    for (const id of [...this.peers.keys()]) {
      this.removePeer(id);
    }

    this.send = null;
    this.connectionId = '';
    this.speakingCallback([]);
    this.statusCallback('VOICE RECONNECTING');
  }

  // Rejoin voice using a new WebSocket connection without asking for the mic again.
  reconnect(
    send: (message: unknown) => boolean,
    connectionId: string
  ): boolean {
    if (this.stopped || !this.stream || !connectionId) return false;

    this.send = send;
    this.connectionId = connectionId;

    if (!this.send({ type: 'voice.join' })) {
      this.statusCallback('VOICE RECONNECTING');
      return false;
    }

    this.statusCallback(
      this.muted ? 'MICROPHONE MUTED' : 'VOICE CONNECTED'
    );
    return true;
  }

  handleMessage(message: SignalMessage) {
    if (this.stopped || !this.stream) return;

    if (message.type === 'voice.peers') {
      (message.peers || []).forEach(peer => {
        if (peer?.id) this.preparePeer(peer);
      });
      return;
    }

    if (message.type === 'voice.peer-joined' && message.peer?.id) {
      this.preparePeer(message.peer);
      return;
    }

    if (message.type === 'voice.peer-left' && message.peer_id) {
      this.removePeer(message.peer_id);
      return;
    }

    if (message.type === 'voice.signal' && message.from && message.signal) {
      void this.handleSignal(message.from, message.signal);
    }
  }

  private preparePeer(peer: VoicePeer, initiateOffer = true) {
    if (!peer.id || peer.id === this.connectionId) return;

    const existing = this.peers.get(peer.id);
    if (existing) {
      existing.peer = peer;
      this.publishPeers();
      return;
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ],
    });

    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.setAttribute('aria-hidden', 'true');
    audio.style.display = 'none';
    document.body.appendChild(audio);

    const entry: PeerConnection = {
      peer,
      pc,
      audio,
      pendingCandidates: [],
      speaking: false,
    };

    this.peers.set(peer.id, entry);

    this.stream?.getAudioTracks().forEach(track => {
      pc.addTrack(track, this.stream!);
    });

    pc.onicecandidate = event => {
      if (event.candidate) {
        this.sendSignal(peer.id, {
          type: 'candidate',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = event => {
      const remoteStream = event.streams[0];
      if (!remoteStream) return;

      audio.srcObject = remoteStream;
      void audio.play().catch(() => {
        this.statusCallback('TAP TO ENABLE REMOTE AUDIO');
      });

      this.attachAnalyser(entry, remoteStream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.removePeer(peer.id);
        this.statusCallback('VOICE CONNECTION FAILED');
      }
    };

    this.publishPeers();

    // Only one participant creates an offer for each pair.
    if (initiateOffer && this.connectionId.localeCompare(peer.id) < 0) {
      void this.createOffer(peer.id, entry);
    }
  }

  private async createOffer(id: string, entry: PeerConnection) {
    try {
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);

      if (offer.sdp) {
        this.sendSignal(id, {
          type: 'offer',
          sdp: offer.sdp,
        });
      }
    } catch {
      this.statusCallback('COULD NOT START VOICE CONNECTION');
    }
  }

  private async handleSignal(
    from: string,
    signal: NonNullable<SignalMessage['signal']>
  ) {
    if (signal.type === 'hangup') {
      this.removePeer(from);
      return;
    }

    let entry = this.peers.get(from);

    if (!entry) {
      const peer: VoicePeer = {
        id: from,
        pilot_id: '',
        name: 'PILOT',
      };
      this.preparePeer(peer, false);
      entry = this.peers.get(from);
    }

    if (!entry) return;

    try {
      if (signal.type === 'offer' && signal.sdp) {
        await entry.pc.setRemoteDescription({
          type: 'offer',
          sdp: signal.sdp,
        });

        for (const candidate of entry.pendingCandidates.splice(0)) {
          await entry.pc.addIceCandidate(candidate);
        }

        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);

        if (answer.sdp) {
          this.sendSignal(from, {
            type: 'answer',
            sdp: answer.sdp,
          });
        }
      } else if (signal.type === 'answer' && signal.sdp) {
        await entry.pc.setRemoteDescription({
          type: 'answer',
          sdp: signal.sdp,
        });

        for (const candidate of entry.pendingCandidates.splice(0)) {
          await entry.pc.addIceCandidate(candidate);
        }
      } else if (signal.type === 'candidate' && signal.candidate) {
        if (entry.pc.remoteDescription) {
          await entry.pc.addIceCandidate(signal.candidate);
        } else {
          entry.pendingCandidates.push(signal.candidate);
        }
      }
    } catch {
      this.statusCallback('VOICE SIGNAL ERROR');
    }
  }

  private sendSignal(id: string, signal: unknown) {
    this.send?.({
      type: 'voice.signal',
      target: id,
      signal,
    });
  }

  private attachAnalyser(
    entry: PeerConnection,
    stream: MediaStream
  ) {
    if (!this.audioContext) return;

    try {
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      entry.analyser = analyser;
      entry.meterData = new Uint8Array(
        new ArrayBuffer(analyser.fftSize)
      );
    } catch {
      // Audio playback can still work without speaking detection.
    }
  }

  private startMeter() {
    window.clearInterval(this.meterTimer);

    this.meterTimer = window.setInterval(() => {
      const speaking: string[] = [];

      for (const [id, entry] of this.peers) {
        let active = false;

        if (entry.analyser && entry.meterData) {
          entry.analyser.getByteTimeDomainData(entry.meterData);
          let total = 0;

          for (const value of entry.meterData) {
            const sample = (value - 128) / 128;
            total += sample * sample;
          }

          active = Math.sqrt(total / entry.meterData.length) > 0.035;
        }

        if (active) speaking.push(id);
        entry.speaking = active;
      }

      this.speakingCallback(speaking);
    }, 150);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach(track => {
      track.enabled = !muted;
    });
    this.statusCallback(muted ? 'MICROPHONE MUTED' : 'VOICE CONNECTED');
  }

  isMuted() {
    return this.muted;
  }

  setMode(mode: VoiceMode) {
    this.mode = mode;
  }

  setPositions(
    local: [number, number, number],
    remote: Record<string, [number, number, number]>
  ) {
    for (const entry of this.peers.values()) {
      if (this.mode === 'global') {
        entry.audio.volume = 1;
        continue;
      }

      const position = remote[entry.peer.pilot_id];

      if (!position || !local) {
        entry.audio.volume = 0;
        continue;
      }

      const dx = local[0] - position[0];
      const dy = local[1] - position[1];
      const dz = local[2] - position[2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Voice fades smoothly and becomes silent beyond 600 game units.
      entry.audio.volume = Math.max(0, Math.min(1, 1 - distance / 600));
    }
  }

  private publishPeers() {
    this.peersCallback(
      [...this.peers.values()].map(entry => entry.peer)
    );
  }

  private removePeer(id: string) {
    const entry = this.peers.get(id);
    if (!entry) return;

    entry.pc.ontrack = null;
    entry.pc.onicecandidate = null;
    entry.pc.close();
    entry.audio.pause();
    entry.audio.srcObject = null;
    entry.audio.remove();

    this.peers.delete(id);
    this.publishPeers();
  }

  stop(notifyServer = true) {
    if (this.stopped && !this.stream) return;

    this.stopped = true;

    if (notifyServer) {
      for (const id of this.peers.keys()) {
        this.sendSignal(id, { type: 'hangup' });
      }
      this.send?.({ type: 'voice.leave' });
    }

    for (const id of [...this.peers.keys()]) {
      this.removePeer(id);
    }

    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;

    window.clearInterval(this.meterTimer);
    this.meterTimer = 0;

    if (this.audioContext) {
      void this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.send = null;
    this.connectionId = '';
    this.muted = false;
    this.speakingCallback([]);
    this.statusCallback('VOICE OFF');
  }
}
