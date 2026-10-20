import type { SceneLoss } from "@/lib/worldforge/scenes";

// What each storyboard card loses as a WorldForge scene, or each scene as a
// card (audit WF-19), one card at a time, so the author can see which part
// of the adventure a file would not carry before it is written or applied.
export function SceneLosses({ scenes, label }: { scenes: SceneLoss[]; label: string }) {
  if (!scenes.length) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="scene-losses">
      <span className="font-medium text-amber-200">{label}</span>
      <ul className="flex flex-col gap-1 pl-1" aria-label={label}>
        {scenes.map((scene, index) => (
          <li key={`${index}-${scene.scene}`} data-testid="scene-loss">
            <span className="text-stone-100">“{scene.scene}”</span> loses
            <ul className="list-disc pl-5 text-amber-100/90">
              {scene.lost.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
