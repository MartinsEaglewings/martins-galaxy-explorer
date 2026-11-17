export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineOscillator: OscillatorNode | null = null;
  private engineHarmonic: OscillatorNode | null = null;
  private disposed = false;

  start() {
    if (this.disposed || this.context) return;

    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as Window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;

      if (!AudioContextClass) return;

      const context = new AudioContextClass();
      this.context = context;

      const master = context.createGain();
      master.gain.value = 0.62;
      master.connect(context.destination);
      this.master = master;

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.Q.value = 0.7;
      filter.connect(master);
      this.engineFilter = filter;

      const engineGain = context.createGain();
      engineGain.gain.value = 0.0001;
      engineGain.connect(filter);
      this.engineGain = engineGain;

      const engine = context.createOscillator();
      engine.type = 'sawtooth';
      engine.frequency.value = 58;
      engine.connect(engineGain);
      engine.start();
      this.engineOscillator = engine;

      const harmonicGain = context.createGain();
      harmonicGain.gain.value = 0.24;
      harmonicGain.connect(filter);

      const harmonic = context.createOscillator();
      harmonic.type = 'triangle';
      harmonic.frequency.value = 116;
      harmonic.connect(harmonicGain);
      harmonic.start();
      this.engineHarmonic = harmonic;

      // Resume directly from the pilot-entry interaction.
      void context.resume().catch(() => {});
    } catch (error) {
      console.warn('Game audio could not start.', error);
    }
  }

  updateEngine(active: boolean, boosting: boolean, speed: number) {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.engineGain) return;

    const intensity = Math.min(1, Math.abs(speed) / 78);
    const targetVolume = active
      ? 0.018 + intensity * 0.027 + (boosting ? 0.025 : 0)
      : 0.0001;

    const baseFrequency = 48 + intensity * 30 + (boosting ? 35 : 0);

    this.engineGain.gain.setTargetAtTime(
      targetVolume,
      context.currentTime,
      0.16
    );

    if (this.engineOscillator) {
      this.engineOscillator.frequency.setTargetAtTime(
        baseFrequency,
        context.currentTime,
        0.12
      );
    }

    if (this.engineHarmonic) {
      this.engineHarmonic.frequency.setTargetAtTime(
        baseFrequency * 2,
        context.currentTime,
        0.12
      );
    }

    if (this.engineFilter) {
      this.engineFilter.frequency.setTargetAtTime(
        boosting ? 1050 : 420 + intensity * 260,
        context.currentTime,
        0.18
      );
    }
  }

  playSolarExplosion() {
    this.playExplosion('solar');
  }

  playBlackHoleExplosion() {
    this.playExplosion('black-hole');
  }

  private playExplosion(kind: 'solar' | 'black-hole') {
    const context = this.context;
    const master = this.master;

    if (!context || !master || context.state !== 'running') return;

    try {
      const now = context.currentTime;
      const duration = kind === 'solar' ? 1.25 : 1.65;
      const buffer = context.createBuffer(
        1,
        Math.floor(context.sampleRate * duration),
        context.sampleRate
      );
      const channel = buffer.getChannelData(0);

      for (let i = 0; i < channel.length; i++) {
        const fade = 1 - i / channel.length;
        channel[i] = (Math.random() * 2 - 1) * fade * fade;
      }

      const noise = context.createBufferSource();
      noise.buffer = buffer;

      const noiseFilter = context.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.setValueAtTime(
        kind === 'solar' ? 2200 : 650,
        now
      );
      noiseFilter.frequency.exponentialRampToValueAtTime(
        kind === 'solar' ? 180 : 75,
        now + duration
      );

      const noiseGain = context.createGain();
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(
        kind === 'solar' ? 0.48 : 0.62,
        now + 0.035
      );
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(master);
      noise.start(now);
      noise.stop(now + duration);

      const impact = context.createOscillator();
      impact.type = kind === 'solar' ? 'triangle' : 'sine';
      impact.frequency.setValueAtTime(
        kind === 'solar' ? 125 : 72,
        now
      );
      impact.frequency.exponentialRampToValueAtTime(
        kind === 'solar' ? 32 : 19,
        now + (kind === 'solar' ? 0.72 : 1.25)
      );

      const impactGain = context.createGain();
      impactGain.gain.setValueAtTime(0.0001, now);
      impactGain.gain.exponentialRampToValueAtTime(
        kind === 'solar' ? 0.48 : 0.72,
        now + 0.025
      );
      impactGain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + (kind === 'solar' ? 0.85 : 1.4)
      );

      impact.connect(impactGain);
      impactGain.connect(master);
      impact.start(now);
      impact.stop(now + (kind === 'solar' ? 0.9 : 1.45));

      if (kind === 'black-hole') {
        const sweep = context.createOscillator();
        sweep.type = 'sawtooth';
        sweep.frequency.setValueAtTime(420, now);
        sweep.frequency.exponentialRampToValueAtTime(38, now + 1.1);

        const sweepGain = context.createGain();
        sweepGain.gain.setValueAtTime(0.0001, now);
        sweepGain.gain.exponentialRampToValueAtTime(0.13, now + 0.08);
        sweepGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);

        sweep.connect(sweepGain);
        sweepGain.connect(master);
        sweep.start(now);
        sweep.stop(now + 1.2);
      }
    } catch (error) {
      console.warn('Explosion sound could not play.', error);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    const context = this.context;
    this.context = null;

    try {
      this.engineOscillator?.stop();
      this.engineHarmonic?.stop();
    } catch {
      // Oscillators may already have stopped.
    }

    this.engineOscillator = null;
    this.engineHarmonic = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.master = null;

    if (context && context.state !== 'closed') {
      void context.close().catch(() => {});
    }
  }
}
