# Submission form copy

Use the English copy for the international review form. Counts exclude the labels.

## Tripo contribution — 496 / 500 characters

Tripo v3.1 generated the textured megalodon base mesh, giving the game its predator. Codex translated the brief into a prompt, submitted it through a Node.js client, polled generation, and downloaded the GLB. Blender's headless Python pipeline aligned and scaled the mesh, added a Body/Head/Jaw/Tail rig and mouth anchor, created Swim/JawOpen animations, and exported the game-ready model. Codex integrated it through Three.js GLTFLoader and checked orientation, animation, and fallback behavior.

## Third-party material disclosure — 790 / 1,000 characters

Tripo AI (model v3.1-20260211) generated the megalodon mesh and textures. Project-authored Blender Python scripts aligned and scaled the model, added its rig, mouth anchor, and Swim/JawOpen animations, then exported public/models/megalodon.glb. Three.js/GLTFLoader (MIT License) loads and animates it in-game. The cover and visual board use captured gameplay; no stock images, third-party music, or purchased fonts are included. The walkthrough voice-over was synthesized locally with Microsoft Zira Desktop (Windows SAPI). OpenAI Codex and Anthropic Claude assisted with planning and iteration; the documented Codex workflow submits the Tripo request, polls generation, runs the Blender pipeline, and integrates/tests the GLB. An experimental rider prompt/model is unused and not included.

## Evidence note

The repository documents Tripo generation and the Codex-to-Tripo-to-Blender workflow in `tools/tripo/`, `tools/blender/`, `progress.md`, and the GLB asset. It does not contain a Claude conversation export, so no Claude-specific implementation work is attributed here.
