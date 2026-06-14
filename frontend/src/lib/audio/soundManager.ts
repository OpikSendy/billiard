class SoundManager {
  private sounds: Record<string, HTMLAudioElement> = {};
  private isMuted: boolean = false;

  constructor() {
    if (typeof window !== "undefined") {
      // Load standard MP3 assets located in public/sounds
      this.sounds.collision = new Audio("/sounds/ball-single-bounce.mp3");
      this.sounds.pocket = new Audio("/sounds/ball-single-bounce.mp3");   // placeholder
      this.sounds.cushion = new Audio("/sounds/ball-single-bounce.mp3");  // placeholder
      this.sounds.shoot = new Audio("/sounds/ball-single-bounce.mp3");    // placeholder
    }
  }

  /**
   * Plays a preloaded sound effect.
   * Clones the node to support simultaneous playbacks (e.g. multiple quick collisions).
   * @param name The identifier of the sound
   * @param volume Volume level from 0.0 to 1.0
   */
  public play(name: "collision" | "pocket" | "cushion" | "shoot", volume = 1.0) {
    if (this.isMuted || typeof window === "undefined") return;
    const sound = this.sounds[name];
    if (sound) {
      try {
        const cloned = sound.cloneNode(true) as HTMLAudioElement;
        cloned.volume = Math.max(0, Math.min(1, volume));
        cloned.play().catch((err) => {
          // Ignore play deferral warnings on browsers requiring initial click
          // (will auto-enable as soon as user clicks the canvas)
        });
      } catch (e) {
        console.error("Audio error:", e);
      }
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
  }
}

export const soundManager = new SoundManager();
