import * as THREE from 'three';

export function createBlackHoleAnimation(
  root: THREE.Object3D,
  animations: THREE.AnimationClip[] = []
) {
  const mixer = new THREE.AnimationMixer(root);

  const clip =
    animations.find(animation => animation.name === 'Take 001') ??
    animations[0];

  let activeAction: THREE.AnimationAction | null = null;

  if (clip && clip.duration > 0) {
    activeAction = mixer.clipAction(clip);
    activeAction.reset();
    activeAction.setLoop(THREE.LoopRepeat, Infinity);
    activeAction.clampWhenFinished = false;
    activeAction.play();

    console.info(
      `Sketchfab black-hole animation playing: ${clip.name} (${clip.duration.toFixed(1)}s)`
    );
  } else {
    console.warn('Sketchfab black-hole model has no playable animation.');
  }

  root.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = false;
      object.receiveShadow = false;
    }
  });

  function update(deltaSeconds: number) {
    const dt = Math.min(Math.max(deltaSeconds || 0, 0), 0.05);
    mixer.update(dt);
  }

  function dispose() {
    activeAction?.stop();
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    activeAction = null;
  }

  return { update, dispose };
}
