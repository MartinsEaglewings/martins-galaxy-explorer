MARTINS GALAXY EXPLORER — PLANET LANDSCAPE ASSETS
=================================================

Nine compact glTF 2.0 binary (.glb) landscape models are included.
Each model contains:
- A real indexed 3D terrain mesh (129 x 129 vertices; 16,641 vertices).
- Mesh relief with broad landforms, mid-scale features and fine surface variation.
- Per-vertex normals for lighting.
- UV coordinates and an embedded 512 x 512 detailed albedo texture.
- PBR material settings.

Worlds:
- Mercury: impact craters and highlands
- Venus: volcanic ridges and lava plains
- Earth: mountains, valleys, rolling plains and river-basin-like surface detail
- Mars: canyon, dunes and mesas
- Jupiter: atmospheric cloud-deck relief (not solid ground)
- Saturn: icy moon-like exploration terrain (Saturn itself is a gas giant)
- Uranus: frozen moon-like glacial terrain (Uranus itself is an ice giant)
- Neptune: dark icy moon-like terrain (Neptune itself is an ice giant)
- Pluto: frozen basin and rugged ice mountains

IMPORTANT:
These are newly generated procedural game assets, not NASA/USGS source scans or
photogrammetry. They are actual GLB mesh assets with embedded textures, but their
topography is designed for gameplay and visual variety rather than scientific
cartographic accuracy.

Recommended integration:
Use THREE.GLTFLoader from three/examples/jsm/loaders/GLTFLoader.js.
Load each GLB once, clone the scene for each surface instance, and position it
at the existing surface origin. Keep the existing collision system and Earth
city generator until their terrain-height sampling is updated to match the mesh.
Do not remove existing game code during initial integration.
