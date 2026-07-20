declare module "@3d-dice/dice-box-threejs" {
  export default class DiceBox {
    constructor(selector: string, config?: Record<string, unknown>);
    initialize(): Promise<void>;
    roll(notation: string): Promise<unknown>;
    clearDice(): void;
    updateConfig(config: Record<string, unknown>): void;
    // The underlying three.js renderer; exposed so the overlay can tear the
    // WebGL context down on unmount (the lib has no dispose method).
    renderer?: {
      dispose(): void;
      forceContextLoss(): void;
      domElement: HTMLCanvasElement;
    };
  }
}
