# Satellite 3D Viewer

A 3D web viewer for satellite models built with Three.js. Features interactive controls for panning, tilting, and scaling, with click-to-reveal part information.

## Features

- **3D Satellite Display**: View satellite models in a 3D space with space background
- **Interactive Controls**:
  - Left Click + Drag: Rotate the view
  - Right Click + Drag: Pan the camera
  - Scroll: Zoom in/out
- **Part Information**: Click on satellite parts to view detailed information
- **Modern UI**: Clean interface with indicator overlays

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Open your browser and navigate to the URL shown in the terminal (usually `http://localhost:5173`)

## Project Structure

- `index.html` - Main HTML file
- `main.js` - Three.js scene setup and interaction logic
- `styles.css` - Styling for the viewer and UI elements
- `package.json` - Project dependencies

## Adding Your Satellite Model

To replace the placeholder satellite with your actual model:

1. Place your 3D model file (GLTF/GLB recommended) in a `models/` directory
2. Import a GLTF loader in `main.js`:
```javascript
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
```

3. Replace the `createPlaceholderSatellite()` method with model loading:
```javascript
const loader = new GLTFLoader();
loader.load('models/your-satellite.glb', (gltf) => {
    this.satellite = gltf.scene;
    // Add part info to each mesh
    this.satellite.traverse((child) => {
        if (child.isMesh) {
            // Add userData.partInfo to each part
        }
    });
    this.scene.add(this.satellite);
});
```

## Customization

- **Background**: Modify the `addStarField()` method or change `scene.background`
- **Lighting**: Adjust lights in the `setupLights()` method
- **Controls**: Modify `OrbitControls` settings in the `init()` method
- **Part Information**: Update `userData.partInfo` on each mesh with name and description

## Build for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

