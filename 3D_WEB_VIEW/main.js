import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

class SatelliteViewer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.container = null;
        this.satellite = null;
        this.raycaster = null;
        this.mouse = new THREE.Vector2();
        this.selectedPart = null;
        this.partData = new Map(); // Store part information
        this.isRotationPaused = false; // Flag to pause rotation
        this.lastIntersectionPoint = null; // Store the 3D intersection point
        this.connectionLine = null; // Line connecting object to popup
        this.connectionMarker = null; // Filled circle marker at the start of the line
        this.selectedObject = null; // Store the selected object for real-time updates
        this.selectedIntersectionPoint = null; // Store intersection point in local coordinates
        this.defaultCameraPosition = new THREE.Vector3(0, 0, -5);
        this.defaultControlsTarget = new THREE.Vector3(0, 0, 0);
        this.cameraDebugContent = null;
        this.indicatorLineReady = true;
        this.assetBasePath = new URL('.', import.meta.url);
        
        // Available model files in the directory
        this.availableModels = [
            this.resolveAssetPath('assets/models/Artemis2_Orion01.gltf'),
            this.resolveAssetPath('assets/models/Artemis2_Orion02.glb')
        ];
        this.defaultModel = this.resolveAssetPath('assets/models/Artemis2_Orion01.gltf'); // Default model to load
        
        // Lighting references
        this.ambientLight = null;
        this.directionalLight = null;
        this.fillLight = null;
        this.pointLight = null;
        this.starField = null;
        this.environmentMap = null;
        this.pmremGenerator = null;
        this.currentEnvIntensity = 1.0;
        
        // Rotation animation state
        this.rotationTime = 0;
        this.lastFrameTime = performance.now();
        this.initialLightPositions = {
            directional: null,
            fill: null,
            point: null
        };
        
        // Background intensity
        this.backgroundIntensity = 1.0;
        
        // Part preset state
        this.originalOpacities = new Map(); // Store original opacity values
        this.currentPreset = null; // Track current preset
        
        this.init();
        this.setupEventListeners();
        this.animate();
    }

    resolveAssetPath(relativePath) {
        return new URL(relativePath, this.assetBasePath).toString();
    }

    init() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        // Add stars background
        this.addStarField();
        
        // Create camera
        this.container = document.getElementById('canvas-container');
        const containerWidth = this.container ? this.container.clientWidth : window.innerWidth;
        const containerHeight = this.container ? this.container.clientHeight : window.innerHeight;
        const aspect = containerWidth / containerHeight;
        this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
        // Position camera on the opposite side to fix viewing angle
        this.camera.position.set(0, 0, -5);
        
        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(containerWidth, containerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        
        // Create PMREM generator for environment maps
        this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        this.pmremGenerator.compileEquirectangularShader();
        
        this.container.appendChild(this.renderer.domElement);

        this.cameraDebugContent = document.getElementById('camera-debug-content');
        
        // Add lights
        this.setupLights();
        
        // Add controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 0.5; // Allow closer zoom
        this.controls.maxDistance = 50; // Increased max distance for larger scale
        this.controls.enablePan = true;
        
        // Create raycaster for click detection
        this.raycaster = new THREE.Raycaster();
        
        // Load 3D model
        this.loadModel();
        
        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());
    }

    addStarField() {
        // Remove existing star field if it exists
        if (this.starField) {
            this.scene.remove(this.starField);
            this.starField.geometry.dispose();
            this.starField.material.dispose();
        }
        
        const starsGeometry = new THREE.BufferGeometry();
        const starsMaterial = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.1,
            sizeAttenuation: true
        });

        const starsVertices = [];
        for (let i = 0; i < 10000; i++) {
            const x = (Math.random() - 0.5) * 2000;
            const y = (Math.random() - 0.5) * 2000;
            const z = (Math.random() - 0.5) * 2000;
            starsVertices.push(x, y, z);
        }

        starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starsVertices, 3));
        this.starField = new THREE.Points(starsGeometry, starsMaterial);
        this.scene.add(this.starField);
        
        // Apply initial intensity
        this.updateStarFieldIntensity();
    }
    
    updateStarFieldIntensity() {
        if (this.starField && this.starField.material) {
            // Adjust star size and opacity based on intensity
            this.starField.material.size = 0.1 * this.backgroundIntensity;
            this.starField.material.opacity = Math.min(1.0, this.backgroundIntensity);
            this.starField.material.transparent = this.backgroundIntensity < 1.0;
            this.starField.material.needsUpdate = true;
        }
    }
    
    updateBackgroundColor() {
        const backgroundColor = document.getElementById('background-color');
        if (!backgroundColor) return;
        
        const color = new THREE.Color(backgroundColor.value);
        
        // Apply intensity by adjusting brightness
        if (this.backgroundIntensity !== 1.0) {
            color.multiplyScalar(this.backgroundIntensity);
            // Clamp values to valid range
            color.r = Math.min(1.0, color.r);
            color.g = Math.min(1.0, color.g);
            color.b = Math.min(1.0, color.b);
        }
        
        this.scene.background = color;
    }

    setupLights() {
        // Ambient light
        this.ambientLight = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(this.ambientLight);
        
        // Main directional light
        this.directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        this.directionalLight.position.set(-5, 5, -5);
        this.directionalLight.castShadow = true;
        this.scene.add(this.directionalLight);
        
        // Additional fill light
        this.fillLight = new THREE.DirectionalLight(0x4a9eff, 0.3);
        this.fillLight.position.set(5, -3, 5);
        this.scene.add(this.fillLight);
        
        // Point light for accent
        this.pointLight = new THREE.PointLight(0x4a9eff, 0.5, 100);
        this.pointLight.position.set(0, 0, -10);
        this.scene.add(this.pointLight);
        
        // Store initial light positions for oscillation
        if (this.directionalLight) {
            this.initialLightPositions.directional = this.directionalLight.position.clone();
        }
        if (this.fillLight) {
            this.initialLightPositions.fill = this.fillLight.position.clone();
        }
        if (this.pointLight) {
            this.initialLightPositions.point = this.pointLight.position.clone();
        }
    }

    convertMaterials(object) {
        object.traverse((child) => {
            if (child.isMesh && child.material) {
                // Handle both single materials and material arrays
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                const convertedMaterials = materials.map((material) => {
                    // If already a MeshStandardMaterial or MeshPhysicalMaterial, optimize it
                    if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
                        return this.optimizeMaterial(material);
                    }
                    // Convert other material types to MeshStandardMaterial
                    return this.convertToStandardMaterial(material);
                });
                
                // Assign converted material(s)
                child.material = convertedMaterials.length === 1 ? convertedMaterials[0] : convertedMaterials;
            }
        });
    }
    
    applySolarPanelTexture() {
        if (!this.satellite) return;
        
        // List of panel material names that should get the solar panel texture
        const panelMaterialNames = [
            'Panel_01-Solar_Panel_Cell_Material_UV',
            'Panel_02-Solar_Panel_Cell_Material_UV',
            'Panel_03-Solar_Panel_Cell_Material_UV',
            'Panel_04-Solar_Panel_Cell_Material_UV'
        ];
        
        const texturePath = this.resolveAssetPath('assets/images/Solar_Panel_Mask_Texture.png');
        const textureLoader = new THREE.TextureLoader();
        
        // Traverse the model to find materials with matching names
        this.satellite.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                
                materials.forEach((material) => {
                    // Check if material name matches any of the panel material names
                    if (material.name && panelMaterialNames.includes(material.name)) {
                        // Load and apply the texture
                        textureLoader.load(
                            texturePath,
                            (texture) => {
                                // Dispose old texture if it exists
                                if (material.map) {
                                    material.map.dispose();
                                }
                                
                                // Configure and apply texture
                                this.configureTexture(texture, true);
                                if (texture.image && texture.image.width) {
                                    texture.generateMipmaps = true;
                                }
                                
                                material.map = texture;
                                material.needsUpdate = true;
                                
                                console.log(`Applied solar panel texture to material: ${material.name}`);
                            },
                            undefined,
                            (error) => {
                                console.warn(`Failed to load solar panel texture for ${material.name}:`, error);
                            }
                        );
                    }
                });
            }
        });
    }

    optimizeMaterial(material) {
        // Ensure material properties are properly set
        material.needsUpdate = true;
        
        // Set proper side rendering
        if (material.side === undefined) {
            material.side = THREE.FrontSide;
        }
        
        // Ensure transparency is handled correctly
        if (material.transparent && material.opacity < 1) {
            material.transparent = true;
            material.depthWrite = material.opacity === 1.0;
        }
        
        // Configure all texture maps
        this.configureTexture(material.map, true);
        this.configureTexture(material.normalMap, false);
        this.configureTexture(material.roughnessMap, false);
        this.configureTexture(material.metalnessMap, false);
        this.configureTexture(material.aoMap, false);
        this.configureTexture(material.emissiveMap, true);
        
        return material;
    }

    configureTexture(texture, isColorTexture) {
        if (!texture) return;
        
        // Set color space (sRGB for color textures, linear for data textures)
        if (isColorTexture) {
            texture.colorSpace = THREE.SRGBColorSpace;
        } else {
            texture.colorSpace = THREE.NoColorSpace;
        }
        
        // Set proper texture filtering
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        
        // Enable texture updates
        texture.needsUpdate = true;
    }

    convertToStandardMaterial(sourceMaterial) {
        // Create a new MeshStandardMaterial
        const newMaterial = new THREE.MeshStandardMaterial({
            color: sourceMaterial.color || 0xffffff,
            map: sourceMaterial.map || null,
            normalMap: sourceMaterial.normalMap || null,
            roughnessMap: sourceMaterial.roughnessMap || null,
            metalnessMap: sourceMaterial.metalnessMap || null,
            aoMap: sourceMaterial.aoMap || null,
            emissive: sourceMaterial.emissive || 0x000000,
            emissiveMap: sourceMaterial.emissiveMap || null,
            emissiveIntensity: sourceMaterial.emissiveIntensity || 1.0,
            roughness: sourceMaterial.roughness !== undefined ? sourceMaterial.roughness : 0.5,
            metalness: sourceMaterial.metalness !== undefined ? sourceMaterial.metalness : 0.0,
            transparent: sourceMaterial.transparent || false,
            opacity: sourceMaterial.opacity !== undefined ? sourceMaterial.opacity : 1.0,
            side: sourceMaterial.side || THREE.FrontSide,
            alphaTest: sourceMaterial.alphaTest || 0,
            depthTest: sourceMaterial.depthTest !== undefined ? sourceMaterial.depthTest : true,
            depthWrite: sourceMaterial.depthWrite !== undefined ? sourceMaterial.depthWrite : true,
        });
        
        // Configure textures
        this.configureTexture(newMaterial.map, true);
        this.configureTexture(newMaterial.normalMap, false);
        this.configureTexture(newMaterial.roughnessMap, false);
        this.configureTexture(newMaterial.metalnessMap, false);
        this.configureTexture(newMaterial.aoMap, false);
        this.configureTexture(newMaterial.emissiveMap, true);
        
        // Copy texture transforms if they exist
        if (sourceMaterial.map && newMaterial.map) {
            if (sourceMaterial.map.offset) newMaterial.map.offset.copy(sourceMaterial.map.offset);
            if (sourceMaterial.map.repeat) newMaterial.map.repeat.copy(sourceMaterial.map.repeat);
            if (sourceMaterial.map.rotation !== undefined) newMaterial.map.rotation = sourceMaterial.map.rotation;
        }
        
        if (sourceMaterial.normalMap && newMaterial.normalMap) {
            if (sourceMaterial.normalMap.offset) newMaterial.normalMap.offset.copy(sourceMaterial.normalMap.offset);
            if (sourceMaterial.normalMap.repeat) newMaterial.normalMap.repeat.copy(sourceMaterial.normalMap.repeat);
            if (sourceMaterial.normalMap.rotation !== undefined) newMaterial.normalMap.rotation = sourceMaterial.normalMap.rotation;
            newMaterial.normalScale = sourceMaterial.normalScale || new THREE.Vector2(1, 1);
        }
        
        // Handle other texture maps
        ['roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach((mapName) => {
            if (sourceMaterial[mapName] && newMaterial[mapName]) {
                const sourceMap = sourceMaterial[mapName];
                if (sourceMap.offset) newMaterial[mapName].offset.copy(sourceMap.offset);
                if (sourceMap.repeat) newMaterial[mapName].repeat.copy(sourceMap.repeat);
                if (sourceMap.rotation !== undefined) newMaterial[mapName].rotation = sourceMap.rotation;
            }
        });
        
        newMaterial.needsUpdate = true;
        return newMaterial;
    }

    setupTextureLoader() {
        // Create a custom texture loader with proper configuration
        const textureLoader = new THREE.TextureLoader();
        
        // Set default texture loading options
        textureLoader.setCrossOrigin('anonymous');
        
        return textureLoader;
    }

    showLoadingIndicator() {
        const overlay = document.getElementById('loading-overlay');
        const progressBar = document.getElementById('loading-progress');
        const percentText = document.getElementById('loading-percent');
        overlay.classList.remove('hidden');
        progressBar.style.width = '0%';
        percentText.textContent = '0%';
    }

    hideLoadingIndicator() {
        const overlay = document.getElementById('loading-overlay');
        overlay.classList.add('hidden');
    }

    updateLoadingProgress(percent) {
        const progressBar = document.getElementById('loading-progress');
        const percentText = document.getElementById('loading-percent');
        progressBar.style.width = percent + '%';
        percentText.textContent = percent.toFixed(0) + '%';
    }

    createGLTFLoader() {
        const loader = new GLTFLoader();
        
        // Set up a loading manager to track texture loading
        const manager = new THREE.LoadingManager();
        
        manager.onLoad = () => {
            console.log('All resources loaded successfully');
        };
        
        manager.onProgress = (url, itemsLoaded, itemsTotal) => {
            const percent = (itemsLoaded / itemsTotal) * 100;
            this.updateLoadingProgress(percent);
            console.log(`Loading: ${itemsLoaded}/${itemsTotal} (${percent.toFixed(1)}%) - ${url}`);
        };
        
        manager.onError = (url) => {
            console.warn('Error loading resource:', url);
        };
        
        // GLTFLoader uses its own internal texture loading, but we can set a manager
        // The textures will be configured after loading in processGLTFTextures
        
        return loader;
    }

    configureLoadedTexture(texture) {
        if (!texture) return;
        
        // Set proper color space based on texture type
        // Color textures (diffuse, emissive) should use sRGB
        // Data textures (normal, roughness, metalness, ao) should use linear
        const isColorTexture = texture.userData?.isColorTexture !== false;
        
        if (isColorTexture) {
            texture.colorSpace = THREE.SRGBColorSpace;
        } else {
            texture.colorSpace = THREE.NoColorSpace;
        }
        
        // Set proper texture filtering
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        
        // Set proper wrapping
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        
        // Enable texture updates
        texture.needsUpdate = true;
        
        // Generate mipmaps if not already done
        if (texture.image && texture.image.width) {
            texture.generateMipmaps = true;
        }
    }

    populateModelDropdown(menuElement) {
        // Clear existing options
        menuElement.innerHTML = '';
        
        // Add options for each available model
        this.availableModels.forEach(modelPath => {
            const button = document.createElement('button');
            button.className = 'replace-model-option';
            button.setAttribute('data-model', modelPath);
            // Extract filename from path for display
            const filename = modelPath.split('/').pop();
            button.textContent = filename;
            menuElement.appendChild(button);
        });
    }

    loadModel() {
        const loader = this.createGLTFLoader();
        
        // Show loading indicator
        this.showLoadingIndicator();
        
        loader.load(
            this.defaultModel,
            (gltf) => {
                this.satellite = gltf.scene;
                
                // Process all textures in the loaded model
                this.processGLTFTextures(gltf);
                
                // Calculate bounding box to center and scale the model
                const box = new THREE.Box3().setFromObject(this.satellite);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                
                // Center the model
                this.satellite.position.x = -center.x;
                this.satellite.position.y = -center.y;
                this.satellite.position.z = -center.z;
                
                // Scale model larger
                this.satellite.scale.set(40, 40, 40);
                
                // Convert materials to proper format for Three.js
                this.convertMaterials(this.satellite);
                
                // Apply solar panel texture to specific materials
                this.applySolarPanelTexture();
                
                // Add part info to meshes that have names
                this.satellite.traverse((child) => {
                    if (child.isMesh) {
                        // If the mesh has a name, create default part info
                        if (child.name && child.name.trim() !== '') {
                            const formattedName = this.formatPartName(child.name);
                            child.userData.partInfo = {
                                name: formattedName,
                                description: `Part of the ${formattedName} component.`
                            };
                            this.partData.set(child.uuid, child.userData.partInfo);
                        }
                    }
                });
                
                this.setEnvironmentIntensity(this.currentEnvIntensity);
                
                // Add satellite to scene
                this.scene.add(this.satellite);
                
                // Build outliner
                this.buildOutliner();
                
                // Adjust camera position based on model size (closer zoom)
                const newSize = new THREE.Box3().setFromObject(this.satellite).getSize(new THREE.Vector3());
                const maxSize = Math.max(newSize.x, newSize.y, newSize.z);
                this.camera.position.set(0, 0, -maxSize * 0.8);
                this.controls.update();
        this.setDefaultViewFromCamera();
                
                // Hide loading indicator after model is fully loaded
                this.updateLoadingProgress(100);
                setTimeout(() => {
                    this.hideLoadingIndicator();
                }, 300);
                
                console.log('Model loaded successfully');
            },
            (progress) => {
                // Loading progress
                if (progress.lengthComputable) {
                    const percentComplete = (progress.loaded / progress.total) * 100;
                    this.updateLoadingProgress(percentComplete);
                    console.log('Loading progress:', percentComplete.toFixed(2) + '%');
                } else {
                    console.log('Loading...', progress.loaded, 'bytes');
                }
            },
            (error) => {
                console.error('Error loading GLTF model:', error);
                this.hideLoadingIndicator();
                alert('Failed to load 3D model. Please check the console for details.');
            }
        );
    }

    loadModelByPath(modelPath) {
        // Remove existing model if any
        if (this.satellite) {
            this.scene.remove(this.satellite);
            // Dispose of materials and geometries
            this.satellite.traverse((child) => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => {
                                if (mat.map) mat.map.dispose();
                                if (mat.normalMap) mat.normalMap.dispose();
                                if (mat.roughnessMap) mat.roughnessMap.dispose();
                                if (mat.metalnessMap) mat.metalnessMap.dispose();
                                if (mat.aoMap) mat.aoMap.dispose();
                                if (mat.emissiveMap) mat.emissiveMap.dispose();
                                mat.dispose();
                            });
                        } else {
                            if (child.material.map) child.material.map.dispose();
                            if (child.material.normalMap) child.material.normalMap.dispose();
                            if (child.material.roughnessMap) child.material.roughnessMap.dispose();
                            if (child.material.metalnessMap) child.material.metalnessMap.dispose();
                            if (child.material.aoMap) child.material.aoMap.dispose();
                            if (child.material.emissiveMap) child.material.emissiveMap.dispose();
                            child.material.dispose();
                        }
                    }
                }
            });
            this.satellite = null;
        }
        
        // Clear part data
        this.partData.clear();
        
        // Close any open indicators
        this.closeIndicator();
        
        // Clear outliner
        this.buildOutliner();
        
        // Show loading indicator
        this.showLoadingIndicator();
        
        // Load new model
        const loader = this.createGLTFLoader();
        
        loader.load(
            modelPath,
            (gltf) => {
                this.satellite = gltf.scene;
                
                // Process all textures in the loaded model
                this.processGLTFTextures(gltf);
                
                // Calculate bounding box to center and scale the model
                const box = new THREE.Box3().setFromObject(this.satellite);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                
                // Center the model
                this.satellite.position.x = -center.x;
                this.satellite.position.y = -center.y;
                this.satellite.position.z = -center.z;
                
                // Scale model larger
                this.satellite.scale.set(40, 40, 40);
                
                // Convert materials to proper format for Three.js
                this.convertMaterials(this.satellite);
                
                // Apply solar panel texture to specific materials
                this.applySolarPanelTexture();
                
                // Add part info to meshes that have names
                this.satellite.traverse((child) => {
                    if (child.isMesh) {
                        // If the mesh has a name, create default part info
                        if (child.name && child.name.trim() !== '') {
                            const formattedName = this.formatPartName(child.name);
                            child.userData.partInfo = {
                                name: formattedName,
                                description: `Part of the ${formattedName} component.`
                            };
                            this.partData.set(child.uuid, child.userData.partInfo);
                        }
                    }
                });
                
                this.setEnvironmentIntensity(this.currentEnvIntensity);
                
                // Add satellite to scene
                this.scene.add(this.satellite);
                
                // Build outliner
                this.buildOutliner();
                
                // Adjust camera position based on model size (closer zoom)
                const newSize = new THREE.Box3().setFromObject(this.satellite).getSize(new THREE.Vector3());
                const maxSize = Math.max(newSize.x, newSize.y, newSize.z);
                this.camera.position.set(0, 0, -maxSize * 0.8);
                this.controls.update();
        this.setDefaultViewFromCamera();
                
                // Hide loading indicator after model is fully loaded
                this.updateLoadingProgress(100);
                setTimeout(() => {
                    this.hideLoadingIndicator();
                }, 300);
                
                console.log('Model loaded successfully from path:', modelPath);
            },
            (progress) => {
                // Loading progress
                if (progress.lengthComputable) {
                    const percentComplete = (progress.loaded / progress.total) * 100;
                    this.updateLoadingProgress(percentComplete);
                    console.log('Loading progress:', percentComplete.toFixed(2) + '%');
                } else {
                    console.log('Loading...', progress.loaded, 'bytes');
                }
            },
            (error) => {
                console.error('Error loading GLTF model:', error);
                this.hideLoadingIndicator();
                alert('Failed to load 3D model. Please check the console for details.');
            }
        );
    }

    processGLTFTextures(gltf) {
        // Traverse the scene to find all materials and their textures
        gltf.scene.traverse((object) => {
            if (object.isMesh && object.material) {
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                
                materials.forEach((material) => {
                    // Process all texture maps in the material
                    if (material.map) {
                        material.map.userData = material.map.userData || {};
                        material.map.userData.isColorTexture = true;
                        this.configureLoadedTexture(material.map);
                    }
                    
                    if (material.normalMap) {
                        material.normalMap.userData = material.normalMap.userData || {};
                        material.normalMap.userData.isColorTexture = false;
                        this.configureLoadedTexture(material.normalMap);
                    }
                    
                    if (material.roughnessMap) {
                        material.roughnessMap.userData = material.roughnessMap.userData || {};
                        material.roughnessMap.userData.isColorTexture = false;
                        this.configureLoadedTexture(material.roughnessMap);
                    }
                    
                    if (material.metalnessMap) {
                        material.metalnessMap.userData = material.metalnessMap.userData || {};
                        material.metalnessMap.userData.isColorTexture = false;
                        this.configureLoadedTexture(material.metalnessMap);
                    }
                    
                    if (material.aoMap) {
                        material.aoMap.userData = material.aoMap.userData || {};
                        material.aoMap.userData.isColorTexture = false;
                        this.configureLoadedTexture(material.aoMap);
                    }
                    
                    if (material.emissiveMap) {
                        material.emissiveMap.userData = material.emissiveMap.userData || {};
                        material.emissiveMap.userData.isColorTexture = true;
                        this.configureLoadedTexture(material.emissiveMap);
                    }
                    
                    // Handle PBR textures that might be combined
                    if (material.roughnessMap && material.metalnessMap) {
                        // If they're the same texture (combined metallic-roughness)
                        if (material.roughnessMap === material.metalnessMap) {
                            material.roughnessMap.userData.isColorTexture = false;
                        }
                    }
                });
            }
        });
        
        // Also process textures from the GLTF parser's texture array if available
        if (gltf.parser && gltf.parser.json && gltf.parser.json.textures) {
            gltf.parser.json.textures.forEach((textureDef, index) => {
                // Access the actual Three.js texture if available
                const texture = gltf.parser.getDependency('texture', index);
                if (texture) {
                    // Determine if it's a color texture based on usage
                    const isColorTexture = textureDef.name ? (
                        textureDef.name.toLowerCase().includes('diffuse') ||
                        textureDef.name.toLowerCase().includes('albedo') ||
                        textureDef.name.toLowerCase().includes('basecolor') ||
                        textureDef.name.toLowerCase().includes('color')
                    ) : true; // Default to color texture if unknown
                    
                    texture.userData = texture.userData || {};
                    texture.userData.isColorTexture = isColorTexture;
                    this.configureLoadedTexture(texture);
                }
            });
        }
    }

    setupEventListeners() {
        // Mouse click event for debugging
        this.renderer.domElement.addEventListener('click', (event) => {
            const rect = this.renderer.domElement.getBoundingClientRect();
            const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const mouseY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
            console.log('=== SINGLE CLICK DEBUG ===');
            console.log('Mouse Screen Position:', { x: event.clientX, y: event.clientY });
            console.log('Mouse NDC:', { x: mouseX.toFixed(3), y: mouseY.toFixed(3) });
            console.log('Camera Position:', {
                x: this.camera.position.x.toFixed(3),
                y: this.camera.position.y.toFixed(3),
                z: this.camera.position.z.toFixed(3)
            });
            console.log('Camera Target:', {
                x: this.controls.target.x.toFixed(3),
                y: this.controls.target.y.toFixed(3),
                z: this.controls.target.z.toFixed(3)
            });
        });
        
        // Mouse double-click event
        this.renderer.domElement.addEventListener('dblclick', (event) => this.onMouseDoubleClick(event));
        
        // Close indicator button
        const closeButton = document.getElementById('close-indicator');
        closeButton.addEventListener('click', () => this.closeIndicator());
        
        // Close indicator when clicking outside (optional)
        document.getElementById('indicator-overlay').addEventListener('click', (event) => {
            if (event.target.id === 'indicator-overlay') {
                this.closeIndicator();
            }
        });
        
        // Load model button (disabled and hidden)
        const loadModelButton = document.getElementById('load-model-button');
        const modelFileInput = document.getElementById('model-file-input');
        
        // Disable load model button functionality (button is hidden in HTML)
        // loadModelButton.addEventListener('click', () => {
        //     modelFileInput.click();
        // });
        
        // modelFileInput.addEventListener('change', (event) => {
        //     const file = event.target.files[0];
        //     if (file) {
        //         this.loadModelFromFile(file);
        //     }
        // });
        
        
        // Replace model dropdown - populate dynamically
        const replaceModelButton = document.getElementById('replace-model-button');
        const replaceModelMenu = document.getElementById('replace-model-menu');
        
        // Populate dropdown with available models
        this.populateModelDropdown(replaceModelMenu);
        
        // Toggle dropdown menu
        replaceModelButton.addEventListener('click', (e) => {
            e.stopPropagation();
            replaceModelMenu.classList.toggle('hidden');
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.replace-model-dropdown')) {
                replaceModelMenu.classList.add('hidden');
            }
        });
        
        // Handle model selection (using event delegation for dynamically added buttons)
        replaceModelMenu.addEventListener('click', (e) => {
            if (e.target.classList.contains('replace-model-option')) {
                e.stopPropagation();
                const modelPath = e.target.getAttribute('data-model');
                this.loadModelByPath(modelPath);
                replaceModelMenu.classList.add('hidden');
            }
        });
        
        // Right panel toggle
        const rightPanelToggle = document.getElementById('right-panel-toggle');
        const rightPanel = document.getElementById('right-panel');
        
        if (!rightPanelToggle) {
            console.error('Right panel toggle button not found!');
        }
        if (!rightPanel) {
            console.error('Right panel not found!');
        }
        
        // Preset buttons
        const presetButtons = document.getElementById('preset-buttons');
        const presetButtonElements = document.querySelectorAll('.preset-button');
        const homePresetButton = document.querySelector('.preset-button[data-action="home"]');
        
        // Hide panel on initial load
        if (rightPanel) {
            rightPanel.classList.add('collapsed');
            if (rightPanelToggle) {
                rightPanelToggle.textContent = '◄';
                rightPanelToggle.classList.add('panel-collapsed');
            }
            // Show preset buttons when panel is collapsed
            if (presetButtons) presetButtons.classList.remove('hidden');
            if (homePresetButton) homePresetButton.classList.add('active');
        }
        
        // Function to toggle panel
        const toggleRightPanel = () => {
            const isCollapsed = rightPanel.classList.toggle('collapsed');
            // Arrow indicates direction panel will move: ► when open (will close/slide right), ◄ when closed (will open/slide left)
            rightPanelToggle.textContent = isCollapsed ? '◄' : '►';
            // Update button class and position
            if (isCollapsed) {
                rightPanelToggle.classList.add('panel-collapsed');
                // Show preset buttons when panel is collapsed
                if (presetButtons) presetButtons.classList.remove('hidden');
                if (homePresetButton) {
                    presetButtonElements.forEach(btn => btn.classList.remove('active'));
                    homePresetButton.classList.add('active');
                }
            } else {
                rightPanelToggle.classList.remove('panel-collapsed');
                // Hide preset buttons when panel is open
                if (presetButtons) presetButtons.classList.add('hidden');
                // Reset preset when opening panel
                this.resetPartPreset();
                presetButtonElements.forEach(btn => btn.classList.remove('active'));
            }
        };
        
        // Initialize button state
        if (rightPanel && rightPanelToggle) {
            if (rightPanel.classList.contains('collapsed')) {
                rightPanelToggle.classList.add('panel-collapsed');
                rightPanelToggle.textContent = '◄';
                if (presetButtons) presetButtons.classList.remove('hidden');
            } else {
                rightPanelToggle.classList.remove('panel-collapsed');
                rightPanelToggle.textContent = '►';
                if (presetButtons) presetButtons.classList.add('hidden');
            }
        }
        
        rightPanelToggle.addEventListener('click', toggleRightPanel);
        
        // Handle preset button clicks
        presetButtonElements.forEach(button => {
            button.addEventListener('click', (e) => {
                const action = button.getAttribute('data-action');
                if (action === 'home') {
                    this.resetToDefaultView();
                    this.resetPartPreset();
                    presetButtonElements.forEach(btn => btn.classList.remove('active'));
                    button.classList.add('active');
                    return;
                }

                const partName = button.getAttribute('data-part');
                if (!partName) return;
                
                // Toggle: if already active, reset; otherwise show preset
                if (button.classList.contains('active') && this.currentPreset === partName) {
                    this.resetPartPreset();
                    button.classList.remove('active');
                } else {
                    const didFade = this.fadeOutIndicator();
                    const triggerPreset = () => {
                        this.showPartPreset(partName);
                        presetButtonElements.forEach(btn => btn.classList.remove('active'));
                        button.classList.add('active');
                    };
                    if (didFade) {
                        setTimeout(triggerPreset, 300);
                    } else {
                        triggerPreset();
                    }
                }
            });
        });
        
        // Keyboard shortcut: 'P' key to toggle panel
        document.addEventListener('keydown', (e) => {
            // Only trigger if not typing in an input field
            if (e.key.toLowerCase() === 'p' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                toggleRightPanel();
            }
        });
        
        // Load panel toggle (header and button)
        const loadPanel = document.getElementById('load-panel');
        const loadPanelHeader = loadPanel.querySelector('.panel-header');
        const loadPanelToggle = document.getElementById('load-panel-toggle');
        loadPanelHeader.addEventListener('click', (e) => {
            if (e.target !== loadPanelToggle) {
                loadPanel.classList.toggle('collapsed');
            }
        });
        loadPanelToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            loadPanel.classList.toggle('collapsed');
        });
        
        // Lighting panel toggle (header and button)
        const lightingPanel = document.getElementById('lighting-panel');
        const lightingPanelHeader = lightingPanel.querySelector('.panel-header');
        const lightingToggle = document.getElementById('lighting-toggle');
        lightingPanelHeader.addEventListener('click', (e) => {
            if (e.target !== lightingToggle) {
                lightingPanel.classList.toggle('collapsed');
            }
        });
        lightingToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            lightingPanel.classList.toggle('collapsed');
        });
        
        // Outliner panel toggle (header and button)
        const outlinerPanel = document.getElementById('outliner-panel');
        const outlinerPanelHeader = outlinerPanel.querySelector('.panel-header');
        const outlinerToggle = document.getElementById('outliner-toggle');
        outlinerPanelHeader.addEventListener('click', (e) => {
            if (e.target !== outlinerToggle) {
                outlinerPanel.classList.toggle('collapsed');
            }
        });
        outlinerToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            outlinerPanel.classList.toggle('collapsed');
        });
        
        // Settings panel toggle
        const settingsPanel = document.getElementById('settings-panel');
        const settingsPanelHeader = settingsPanel.querySelector('.panel-header');
        const settingsPanelToggle = document.getElementById('settings-panel-toggle');
        settingsPanelHeader.addEventListener('click', (e) => {
            if (e.target !== settingsPanelToggle) {
                settingsPanel.classList.toggle('collapsed');
            }
        });
        settingsPanelToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsPanel.classList.toggle('collapsed');
        });
        
        // Settings buttons
        const saveSettingsButton = document.getElementById('save-settings-button');
        const loadSettingsButton = document.getElementById('load-settings-button');
        const resetSettingsButton = document.getElementById('reset-settings-button');
        const settingsFileInput = document.getElementById('settings-file-input');
        
        saveSettingsButton.addEventListener('click', () => this.saveSettings());
        loadSettingsButton.addEventListener('click', () => {
            settingsFileInput.click();
        });
        settingsFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.loadSettingsFromFile(file);
            }
            // Reset input so same file can be selected again
            e.target.value = '';
        });
        resetSettingsButton.addEventListener('click', () => this.resetSettings());
        
        // Setup lighting controls
        this.setupLightingControls();
        
        // Settings are now loaded from files, not localStorage
    }
    
    saveSettings() {
        const settings = {
            // Background settings
            backgroundType: document.getElementById('background-type').value,
            backgroundColor: document.getElementById('background-color').value,
            backgroundIntensity: document.getElementById('background-intensity').value,
            
            // Ambient light
            ambientIntensity: document.getElementById('ambient-intensity').value,
            ambientColor: document.getElementById('ambient-color').value,
            
            // Directional light
            directionalIntensity: document.getElementById('directional-intensity').value,
            directionalColor: document.getElementById('directional-color').value,
            directionalX: document.getElementById('directional-x').value,
            directionalY: document.getElementById('directional-y').value,
            directionalZ: document.getElementById('directional-z').value,
            
            // Fill light
            fillIntensity: document.getElementById('fill-intensity').value,
            fillColor: document.getElementById('fill-color').value,
            
            // Point light
            pointIntensity: document.getElementById('point-intensity').value,
            pointColor: document.getElementById('point-color').value,
            
            // Environment
            environmentType: document.getElementById('environment-type').value,
            envIntensity: document.getElementById('env-intensity').value,
            
            // Scene and object attributes
            sceneData: this.serializeSceneData(),
            
            // Panel states
            loadPanelCollapsed: document.getElementById('load-panel').classList.contains('collapsed'),
            lightingPanelCollapsed: document.getElementById('lighting-panel').classList.contains('collapsed'),
            outlinerPanelCollapsed: document.getElementById('outliner-panel').classList.contains('collapsed'),
            settingsPanelCollapsed: document.getElementById('settings-panel').classList.contains('collapsed'),
            rightPanelCollapsed: document.getElementById('right-panel').classList.contains('collapsed')
        };
        
        try {
            // Create JSON string with pretty formatting
            const jsonString = JSON.stringify(settings, null, 2);
            
            // Create a blob with the JSON data
            const blob = new Blob([jsonString], { type: 'application/json' });
            
            // Create download link
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            
            // Generate filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            link.download = `satellite-viewer-settings-${timestamp}.json`;
            
            // Trigger download
            document.body.appendChild(link);
            link.click();
            
            // Clean up
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            
            alert('Settings saved to file! Check your Downloads folder.');
            console.log('Settings saved to file:', settings);
        } catch (error) {
            console.error('Error saving settings:', error);
            alert('Failed to save settings. Please check the console for details.');
        }
    }
    
    loadSettingsFromFile(file) {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const settings = JSON.parse(e.target.result);
                this.applySettings(settings);
                alert('Settings loaded successfully!');
                console.log('Settings loaded from file:', settings);
            } catch (error) {
                console.error('Error loading settings:', error);
                alert('Failed to load settings file. Please check that it is a valid JSON file.');
            }
        };
        
        reader.onerror = () => {
            console.error('Error reading file');
            alert('Failed to read settings file.');
        };
        
        reader.readAsText(file);
    }
    
    applySettings(settings) {
        if (!settings) {
            console.log('No settings to apply');
            return;
        }
        
        console.log('Applying settings:', settings);
        
        // Background settings
        if (settings.backgroundType) {
            document.getElementById('background-type').value = settings.backgroundType;
            document.getElementById('background-type').dispatchEvent(new Event('change'));
        }
        if (settings.backgroundColor) {
            document.getElementById('background-color').value = settings.backgroundColor;
            document.getElementById('background-color').dispatchEvent(new Event('input'));
        }
        if (settings.backgroundIntensity !== undefined) {
            document.getElementById('background-intensity').value = settings.backgroundIntensity;
            document.getElementById('background-intensity').dispatchEvent(new Event('input'));
        }
        
        // Ambient light
        if (settings.ambientIntensity !== undefined) {
            document.getElementById('ambient-intensity').value = settings.ambientIntensity;
            document.getElementById('ambient-intensity').dispatchEvent(new Event('input'));
        }
        if (settings.ambientColor) {
            document.getElementById('ambient-color').value = settings.ambientColor;
            document.getElementById('ambient-color').dispatchEvent(new Event('input'));
        }
        
        // Directional light
        if (settings.directionalIntensity !== undefined) {
            document.getElementById('directional-intensity').value = settings.directionalIntensity;
            document.getElementById('directional-intensity').dispatchEvent(new Event('input'));
        }
        if (settings.directionalColor) {
            document.getElementById('directional-color').value = settings.directionalColor;
            document.getElementById('directional-color').dispatchEvent(new Event('input'));
        }
        if (settings.directionalX !== undefined) {
            document.getElementById('directional-x').value = settings.directionalX;
            document.getElementById('directional-x').dispatchEvent(new Event('input'));
        }
        if (settings.directionalY !== undefined) {
            document.getElementById('directional-y').value = settings.directionalY;
            document.getElementById('directional-y').dispatchEvent(new Event('input'));
        }
        if (settings.directionalZ !== undefined) {
            document.getElementById('directional-z').value = settings.directionalZ;
            document.getElementById('directional-z').dispatchEvent(new Event('input'));
        }
        
        // Fill light
        if (settings.fillIntensity !== undefined) {
            document.getElementById('fill-intensity').value = settings.fillIntensity;
            document.getElementById('fill-intensity').dispatchEvent(new Event('input'));
        }
        if (settings.fillColor) {
            document.getElementById('fill-color').value = settings.fillColor;
            document.getElementById('fill-color').dispatchEvent(new Event('input'));
        }
        
        // Point light
        if (settings.pointIntensity !== undefined) {
            document.getElementById('point-intensity').value = settings.pointIntensity;
            document.getElementById('point-intensity').dispatchEvent(new Event('input'));
        }
        if (settings.pointColor) {
            document.getElementById('point-color').value = settings.pointColor;
            document.getElementById('point-color').dispatchEvent(new Event('input'));
        }
        
        // Environment
        if (settings.environmentType) {
            document.getElementById('environment-type').value = settings.environmentType;
            document.getElementById('environment-type').dispatchEvent(new Event('change'));
        } else {
            document.getElementById('environment-type').value = 'hdri';
            document.getElementById('environment-type').dispatchEvent(new Event('change'));
        }
        if (settings.envIntensity !== undefined) {
            document.getElementById('env-intensity').value = settings.envIntensity;
            document.getElementById('env-intensity').dispatchEvent(new Event('input'));
        }
        
        // Load scene and object data
        if (settings.sceneData) {
            // Delay loading scene data to ensure model is loaded
            setTimeout(() => {
                this.deserializeSceneData(settings.sceneData);
            }, 500);
        }
        
        // Panel states
        if (settings.loadPanelCollapsed !== undefined) {
            if (settings.loadPanelCollapsed) {
                document.getElementById('load-panel').classList.add('collapsed');
            } else {
                document.getElementById('load-panel').classList.remove('collapsed');
            }
        }
        if (settings.lightingPanelCollapsed !== undefined) {
            if (settings.lightingPanelCollapsed) {
                document.getElementById('lighting-panel').classList.add('collapsed');
            } else {
                document.getElementById('lighting-panel').classList.remove('collapsed');
            }
        }
        if (settings.outlinerPanelCollapsed !== undefined) {
            if (settings.outlinerPanelCollapsed) {
                document.getElementById('outliner-panel').classList.add('collapsed');
            } else {
                document.getElementById('outliner-panel').classList.remove('collapsed');
            }
        }
        if (settings.settingsPanelCollapsed !== undefined) {
            if (settings.settingsPanelCollapsed) {
                document.getElementById('settings-panel').classList.add('collapsed');
            } else {
                document.getElementById('settings-panel').classList.remove('collapsed');
            }
        }
        if (settings.rightPanelCollapsed !== undefined) {
            const rightPanel = document.getElementById('right-panel');
            const rightPanelToggle = document.getElementById('right-panel-toggle');
            if (settings.rightPanelCollapsed) {
                rightPanel.classList.add('collapsed');
                rightPanelToggle.textContent = '◄';
                rightPanelToggle.classList.add('panel-collapsed');
            } else {
                rightPanel.classList.remove('collapsed');
                rightPanelToggle.textContent = '►';
                rightPanelToggle.classList.remove('panel-collapsed');
            }
        }
        
        console.log('Settings applied successfully');
    }
    
    serializeSceneData() {
        if (!this.satellite) return null;
        
        const sceneData = {
            objects: [],
            partData: {}
        };
        
        // Serialize part data
        this.partData.forEach((partInfo, uuid) => {
            sceneData.partData[uuid] = partInfo;
        });
        
        // Serialize object and material data
        this.satellite.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                
                const objectData = {
                    uuid: child.uuid,
                    name: child.name,
                    position: {
                        x: child.position.x,
                        y: child.position.y,
                        z: child.position.z
                    },
                    rotation: {
                        x: child.rotation.x,
                        y: child.rotation.y,
                        z: child.rotation.z
                    },
                    scale: {
                        x: child.scale.x,
                        y: child.scale.y,
                        z: child.scale.z
                    },
                    visible: child.visible,
                    materials: []
                };
                
                materials.forEach((material, index) => {
                    const materialData = {
                        index: index,
                        name: material.name || '',
                        uuid: material.uuid,
                        color: '#' + material.color.getHexString(),
                        roughness: material.roughness !== undefined ? material.roughness : null,
                        metalness: material.metalness !== undefined ? material.metalness : null,
                        emissive: material.emissive ? '#' + material.emissive.getHexString() : null,
                        emissiveIntensity: material.emissiveIntensity !== undefined ? material.emissiveIntensity : null,
                        opacity: material.opacity !== undefined ? material.opacity : null,
                        transparent: material.transparent || false,
                        // Save texture sources if they exist (for custom loaded textures)
                        textures: {}
                    };
                    
                    // Save texture information (we can't save the actual texture data, but we can save if they exist)
                    const textureMaps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
                    textureMaps.forEach(mapName => {
                        if (material[mapName]) {
                            const texture = material[mapName];
                            let textureUrl = null;
                            
                            // Try multiple ways to get the source URL
                            // 1. Check userData (for custom loaded textures)
                            if (texture.userData && texture.userData.sourceUrl) {
                                textureUrl = texture.userData.sourceUrl;
                            }
                            // 2. Check texture source data
                            else if (texture.source && texture.source.data) {
                                if (texture.source.data.src) {
                                    textureUrl = texture.source.data.src;
                                } else if (texture.source.data instanceof HTMLImageElement && texture.source.data.src) {
                                    textureUrl = texture.source.data.src;
                                }
                            }
                            // 3. Check image element directly
                            else if (texture.image && texture.image.src) {
                                textureUrl = texture.image.src;
                            }
                            
                            // Save the URL if found, otherwise just mark that texture exists
                            if (textureUrl) {
                                // For data URLs, save them (they contain the full image data)
                                // For file paths, save them as-is
                                materialData.textures[mapName] = textureUrl;
                                console.log(`Saving texture ${mapName} with URL: ${textureUrl.substring(0, 50)}...`);
                            } else {
                                // Just mark that texture exists (original model texture)
                                materialData.textures[mapName] = true;
                            }
                        }
                    });
                    
                    objectData.materials.push(materialData);
                });
                
                sceneData.objects.push(objectData);
            }
        });
        
        return sceneData;
    }
    
    loadSettings() {
        // This function is kept for backward compatibility but settings are now loaded from files
        // The actual loading is handled by loadSettingsFromFile -> applySettings
        console.log('Settings are now loaded from files. Use "Load Settings from File" button.');
    }
    
    loadSettingsFromFile(file) {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const settings = JSON.parse(e.target.result);
                this.applySettings(settings);
                alert('Settings loaded successfully!');
                console.log('Settings loaded from file:', settings);
            } catch (error) {
                console.error('Error loading settings:', error);
                alert('Failed to load settings file. Please check that it is a valid JSON file.');
            }
        };
        
        reader.onerror = () => {
            console.error('Error reading file');
            alert('Failed to read settings file.');
        };
        
        reader.readAsText(file);
    }
    
    applySettings(settings) {
        if (!settings) {
            console.log('No settings to apply');
            return;
        }
        
        console.log('Applying settings:', settings);
        
        // Background settings
        if (settings.backgroundType) {
                document.getElementById('background-type').value = settings.backgroundType;
                document.getElementById('background-type').dispatchEvent(new Event('change'));
            }
            if (settings.backgroundColor) {
                document.getElementById('background-color').value = settings.backgroundColor;
                document.getElementById('background-color').dispatchEvent(new Event('input'));
            }
            if (settings.backgroundIntensity !== undefined) {
                document.getElementById('background-intensity').value = settings.backgroundIntensity;
                document.getElementById('background-intensity').dispatchEvent(new Event('input'));
            }
            
            // Ambient light
            if (settings.ambientIntensity !== undefined) {
                document.getElementById('ambient-intensity').value = settings.ambientIntensity;
                document.getElementById('ambient-intensity').dispatchEvent(new Event('input'));
            }
            if (settings.ambientColor) {
                document.getElementById('ambient-color').value = settings.ambientColor;
                document.getElementById('ambient-color').dispatchEvent(new Event('input'));
            }
            
            // Directional light
            if (settings.directionalIntensity !== undefined) {
                document.getElementById('directional-intensity').value = settings.directionalIntensity;
                document.getElementById('directional-intensity').dispatchEvent(new Event('input'));
            }
            if (settings.directionalColor) {
                document.getElementById('directional-color').value = settings.directionalColor;
                document.getElementById('directional-color').dispatchEvent(new Event('input'));
            }
            if (settings.directionalX !== undefined) {
                document.getElementById('directional-x').value = settings.directionalX;
                document.getElementById('directional-x').dispatchEvent(new Event('input'));
            }
            if (settings.directionalY !== undefined) {
                document.getElementById('directional-y').value = settings.directionalY;
                document.getElementById('directional-y').dispatchEvent(new Event('input'));
            }
            if (settings.directionalZ !== undefined) {
                document.getElementById('directional-z').value = settings.directionalZ;
                document.getElementById('directional-z').dispatchEvent(new Event('input'));
            }
            
            // Fill light
            if (settings.fillIntensity !== undefined) {
                document.getElementById('fill-intensity').value = settings.fillIntensity;
                document.getElementById('fill-intensity').dispatchEvent(new Event('input'));
            }
            if (settings.fillColor) {
                document.getElementById('fill-color').value = settings.fillColor;
                document.getElementById('fill-color').dispatchEvent(new Event('input'));
            }
            
            // Point light
            if (settings.pointIntensity !== undefined) {
                document.getElementById('point-intensity').value = settings.pointIntensity;
                document.getElementById('point-intensity').dispatchEvent(new Event('input'));
            }
            if (settings.pointColor) {
                document.getElementById('point-color').value = settings.pointColor;
                document.getElementById('point-color').dispatchEvent(new Event('input'));
            }
            
            // Environment
            if (settings.environmentType) {
                document.getElementById('environment-type').value = settings.environmentType;
                document.getElementById('environment-type').dispatchEvent(new Event('change'));
            } else {
                document.getElementById('environment-type').value = 'hdri';
                document.getElementById('environment-type').dispatchEvent(new Event('change'));
            }
            if (settings.envIntensity !== undefined) {
                document.getElementById('env-intensity').value = settings.envIntensity;
                document.getElementById('env-intensity').dispatchEvent(new Event('input'));
            }
            
            // Load scene and object data
            if (settings.sceneData) {
                // Delay loading scene data to ensure model is loaded
                setTimeout(() => {
                    this.deserializeSceneData(settings.sceneData);
                }, 500);
            }
            
            // Panel states
            if (settings.loadPanelCollapsed !== undefined) {
                if (settings.loadPanelCollapsed) {
                    document.getElementById('load-panel').classList.add('collapsed');
                } else {
                    document.getElementById('load-panel').classList.remove('collapsed');
                }
            }
            if (settings.lightingPanelCollapsed !== undefined) {
                if (settings.lightingPanelCollapsed) {
                    document.getElementById('lighting-panel').classList.add('collapsed');
                } else {
                    document.getElementById('lighting-panel').classList.remove('collapsed');
                }
            }
            if (settings.outlinerPanelCollapsed !== undefined) {
                if (settings.outlinerPanelCollapsed) {
                    document.getElementById('outliner-panel').classList.add('collapsed');
                } else {
                    document.getElementById('outliner-panel').classList.remove('collapsed');
                }
            }
            if (settings.settingsPanelCollapsed !== undefined) {
                if (settings.settingsPanelCollapsed) {
                    document.getElementById('settings-panel').classList.add('collapsed');
                } else {
                    document.getElementById('settings-panel').classList.remove('collapsed');
                }
            }
            if (settings.rightPanelCollapsed !== undefined) {
                const rightPanel = document.getElementById('right-panel');
                const rightPanelToggle = document.getElementById('right-panel-toggle');
                if (settings.rightPanelCollapsed) {
                    rightPanel.classList.add('collapsed');
                    rightPanelToggle.textContent = '◄';
                    rightPanelToggle.classList.add('panel-collapsed');
                } else {
                    rightPanel.classList.remove('collapsed');
                    rightPanelToggle.textContent = '►';
                    rightPanelToggle.classList.remove('panel-collapsed');
                }
            }
            
            console.log('Settings applied successfully');
    }
    
    deserializeSceneData(sceneData) {
        if (!sceneData || !this.satellite) {
            console.log('No scene data to load or model not loaded');
            return;
        }
        
        // Restore part data
        if (sceneData.partData) {
            Object.keys(sceneData.partData).forEach(uuid => {
                this.partData.set(uuid, sceneData.partData[uuid]);
            });
        }
        
        // Create a map of UUIDs to objects for quick lookup
        const objectMap = new Map();
        this.satellite.traverse((child) => {
            if (child.isMesh) {
                objectMap.set(child.uuid, child);
            }
        });
        
        // Restore object and material properties
        if (sceneData.objects) {
            sceneData.objects.forEach(objectData => {
                const obj = objectMap.get(objectData.uuid);
                if (!obj || !obj.material) return;
                
                // Restore object properties
                if (objectData.position) {
                    obj.position.set(objectData.position.x, objectData.position.y, objectData.position.z);
                }
                if (objectData.rotation) {
                    obj.rotation.set(objectData.rotation.x, objectData.rotation.y, objectData.rotation.z);
                }
                if (objectData.scale) {
                    obj.scale.set(objectData.scale.x, objectData.scale.y, objectData.scale.z);
                }
                if (objectData.visible !== undefined) {
                    obj.visible = objectData.visible;
                }
                
                // Restore material properties
                const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                
                objectData.materials.forEach(materialData => {
                    const material = materials[materialData.index];
                    if (!material) return;
                    
                    // Restore material properties
                    if (materialData.color) {
                        material.color.setHex(materialData.color.replace('#', '0x'));
                    }
                    if (materialData.roughness !== null && materialData.roughness !== undefined) {
                        material.roughness = materialData.roughness;
                    }
                    if (materialData.metalness !== null && materialData.metalness !== undefined) {
                        material.metalness = materialData.metalness;
                    }
                    if (materialData.emissive) {
                        material.emissive.setHex(materialData.emissive.replace('#', '0x'));
                    }
                    if (materialData.emissiveIntensity !== null && materialData.emissiveIntensity !== undefined) {
                        material.emissiveIntensity = materialData.emissiveIntensity;
                    }
                    if (materialData.opacity !== null && materialData.opacity !== undefined) {
                        material.opacity = materialData.opacity;
                        material.transparent = materialData.transparent || materialData.opacity < 1.0;
                    }
                    
                    // Restore textures (if source URLs are available)
                    if (materialData.textures) {
                        const texturePromises = [];
                        Object.keys(materialData.textures).forEach(mapName => {
                            const textureInfo = materialData.textures[mapName];
                            if (typeof textureInfo === 'string' && textureInfo !== 'true') {
                                // Load texture from saved URL (data URLs or file paths)
                                console.log(`Restoring texture ${mapName} from: ${textureInfo.substring(0, 50)}...`);
                                const promise = this.loadTextureFromUrlPromise(material, mapName, textureInfo);
                                texturePromises.push(promise);
                            }
                            // If textureInfo is true, it means the texture exists but we don't have a URL
                            // (original model texture, will remain as-is)
                        });
                        
                        // Wait for all textures to load before updating material
                        if (texturePromises.length > 0) {
                            Promise.all(texturePromises).then(() => {
                                material.needsUpdate = true;
                            });
                        } else {
                            material.needsUpdate = true;
                        }
                    } else {
                        material.needsUpdate = true;
                    }
                });
            });
            
            // Rebuild outliner to reflect changes after a short delay to allow textures to load
            setTimeout(() => {
                this.buildOutliner();
                console.log('Scene data loaded successfully');
            }, 500);
        }
    }
    
    loadTextureFromUrl(material, mapName, url) {
        this.loadTextureFromUrlPromise(material, mapName, url);
    }
    
    loadTextureFromUrlPromise(material, mapName, url) {
        return new Promise((resolve, reject) => {
            const textureLoader = new THREE.TextureLoader();
            
            textureLoader.load(
                url,
                (texture) => {
                    // Dispose old texture if it exists
                    if (material[mapName]) {
                        material[mapName].dispose();
                    }
                    
                    // Configure texture
                    const isColorTexture = mapName === 'map' || mapName === 'emissiveMap';
                    this.configureTexture(texture, isColorTexture);
                    
                    // Store source URL for future saves
                    texture.userData = texture.userData || {};
                    texture.userData.sourceUrl = url;
                    if (url.startsWith('data:') || url.startsWith('blob:')) {
                        texture.userData.isCustomTexture = true;
                    }
                    
                    // Generate mipmaps
                    if (texture.image && texture.image.width) {
                        texture.generateMipmaps = true;
                    }
                    
                    // Set texture on material
                    material[mapName] = texture;
                    material.needsUpdate = true;
                    
                    console.log(`✓ Restored texture ${mapName} from saved URL`);
                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.warn(`Failed to restore texture ${mapName} from ${url.substring(0, 50)}...:`, error);
                    reject(error);
                }
            );
        });
    }
    
    resetSettings() {
        if (confirm('Are you sure you want to reset all settings to default values? This cannot be undone.')) {
            try {
                localStorage.removeItem('satelliteViewerSettings');
                
                // Reset background
                document.getElementById('background-type').value = 'stars';
                document.getElementById('background-type').dispatchEvent(new Event('change'));
                document.getElementById('background-color').value = '#000000';
                document.getElementById('background-intensity').value = '1.0';
                document.getElementById('background-intensity').dispatchEvent(new Event('input'));
                
                // Reset environment
                document.getElementById('environment-type').value = 'hdri';
                document.getElementById('environment-type').dispatchEvent(new Event('change'));
                this.loadDefaultHDRI();
                
                // Reset ambient light
                document.getElementById('ambient-intensity').value = '0.5';
                document.getElementById('ambient-intensity').dispatchEvent(new Event('input'));
                document.getElementById('ambient-color').value = '#404040';
                document.getElementById('ambient-color').dispatchEvent(new Event('input'));
                
                // Reset directional light
                document.getElementById('directional-intensity').value = '1.0';
                document.getElementById('directional-intensity').dispatchEvent(new Event('input'));
                document.getElementById('directional-color').value = '#ffffff';
                document.getElementById('directional-color').dispatchEvent(new Event('input'));
                document.getElementById('directional-x').value = '-5';
                document.getElementById('directional-x').dispatchEvent(new Event('input'));
                document.getElementById('directional-y').value = '5';
                document.getElementById('directional-y').dispatchEvent(new Event('input'));
                document.getElementById('directional-z').value = '-5';
                document.getElementById('directional-z').dispatchEvent(new Event('input'));
                
                // Reset fill light
                document.getElementById('fill-intensity').value = '0.3';
                document.getElementById('fill-intensity').dispatchEvent(new Event('input'));
                document.getElementById('fill-color').value = '#4a9eff';
                document.getElementById('fill-color').dispatchEvent(new Event('input'));
                
                // Reset point light
                document.getElementById('point-intensity').value = '0.5';
                document.getElementById('point-intensity').dispatchEvent(new Event('input'));
                document.getElementById('point-color').value = '#4a9eff';
                document.getElementById('point-color').dispatchEvent(new Event('input'));
                
                // Reset environment intensity
                document.getElementById('env-intensity').value = '1.0';
                document.getElementById('env-intensity').dispatchEvent(new Event('input'));
                
                // Reset panel states
                document.getElementById('load-panel').classList.remove('collapsed');
                document.getElementById('lighting-panel').classList.remove('collapsed');
                document.getElementById('outliner-panel').classList.remove('collapsed');
                document.getElementById('settings-panel').classList.remove('collapsed');
                const rightPanel = document.getElementById('right-panel');
                const rightPanelToggle = document.getElementById('right-panel-toggle');
                rightPanel.classList.remove('collapsed');
                rightPanelToggle.textContent = '►';
                rightPanelToggle.classList.remove('panel-collapsed');
                
                alert('Settings reset to default values!');
                console.log('Settings reset to defaults');
            } catch (error) {
                console.error('Error resetting settings:', error);
                alert('Failed to reset settings. Please check the console for details.');
            }
        }
    }
    
    setupLightingControls() {
        // Background type
        const backgroundType = document.getElementById('background-type');
        const backgroundColorControl = document.getElementById('background-color-control');
        const backgroundColor = document.getElementById('background-color');
        const backgroundIntensity = document.getElementById('background-intensity');
        const backgroundIntensityValue = document.getElementById('background-intensity-value');
        
        // Initialize background intensity
        this.backgroundIntensity = parseFloat(backgroundIntensity.value) || 1.0;
        
        const applyBackgroundType = (type) => {
            if (type === 'color') {
                backgroundColorControl.style.display = 'block';
                if (this.starField) this.starField.visible = false;
                this.updateBackgroundColor();
            } else {
                backgroundColorControl.style.display = 'none';
                if (!this.starField) this.addStarField();
                this.starField.visible = true;
                this.updateStarFieldIntensity();
                this.scene.background = new THREE.Color(0x000000);
            }
        };
        
        const initialBackground = backgroundType.value || 'stars';
        backgroundType.value = initialBackground;
        applyBackgroundType(initialBackground);
        
        backgroundType.addEventListener('change', (e) => {
            applyBackgroundType(e.target.value);
        });
        
        backgroundColor.addEventListener('input', (e) => {
            if (backgroundType.value === 'color') {
                this.updateBackgroundColor();
            }
        });
        
        // Background intensity control
        backgroundIntensity.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            backgroundIntensityValue.textContent = value.toFixed(1);
            this.backgroundIntensity = value;
            
            if (backgroundType.value === 'color') {
                this.updateBackgroundColor();
            } else if (backgroundType.value === 'stars') {
                this.updateStarFieldIntensity();
            }
        });
        
        // Initialize background intensity display
        backgroundIntensityValue.textContent = this.backgroundIntensity.toFixed(1);
        
        // Environment controls (model reflections)
        const environmentType = document.getElementById('environment-type');
        const environmentHdriControl = document.getElementById('environment-hdri-control');
        const hdriFileInput = document.getElementById('hdri-file-input');
        const loadHdriButton = document.getElementById('load-hdri-button');
        
        const ensureEnvironmentMap = () => {
            if (this.environmentMap) {
                this.applyEnvironmentMap(this.environmentMap);
            } else {
                this.loadDefaultHDRI();
            }
        };
        
        const applyEnvironmentType = (type) => {
            if (type === 'hdri') {
                environmentHdriControl.style.display = 'block';
                ensureEnvironmentMap();
            } else {
                environmentHdriControl.style.display = 'none';
                this.scene.environment = null;
            }
        };
        
        const initialEnvType = environmentType.value || 'hdri';
        environmentType.value = initialEnvType;
        applyEnvironmentType(initialEnvType);
        
        environmentType.addEventListener('change', (e) => {
            applyEnvironmentType(e.target.value);
        });
        
        loadHdriButton.addEventListener('click', () => {
            hdriFileInput.click();
        });
        
        hdriFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.loadHDRI(file);
            }
            e.target.value = '';
        });
        
        // Ambient light controls
        const ambientIntensity = document.getElementById('ambient-intensity');
        const ambientIntensityValue = document.getElementById('ambient-intensity-value');
        const ambientColor = document.getElementById('ambient-color');
        
        ambientIntensity.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            ambientIntensityValue.textContent = value.toFixed(1);
            if (this.ambientLight) this.ambientLight.intensity = value;
        });
        
        ambientColor.addEventListener('input', (e) => {
            if (this.ambientLight) this.ambientLight.color.setHex(e.target.value.replace('#', '0x'));
        });
        
        // Directional light controls
        const directionalIntensity = document.getElementById('directional-intensity');
        const directionalIntensityValue = document.getElementById('directional-intensity-value');
        const directionalColor = document.getElementById('directional-color');
        const directionalX = document.getElementById('directional-x');
        const directionalXValue = document.getElementById('directional-x-value');
        const directionalY = document.getElementById('directional-y');
        const directionalYValue = document.getElementById('directional-y-value');
        const directionalZ = document.getElementById('directional-z');
        const directionalZValue = document.getElementById('directional-z-value');
        
        directionalIntensity.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            directionalIntensityValue.textContent = value.toFixed(1);
            if (this.directionalLight) this.directionalLight.intensity = value;
        });
        
        directionalColor.addEventListener('input', (e) => {
            if (this.directionalLight) this.directionalLight.color.setHex(e.target.value.replace('#', '0x'));
        });
        
        // Store base position for directional light
        let directionalBasePos = new THREE.Vector3(-5, 5, -5);
        if (this.directionalLight) {
            directionalBasePos.copy(this.directionalLight.position);
            // Update slider values to match current position
            document.getElementById('directional-x').value = directionalBasePos.x;
            document.getElementById('directional-y').value = directionalBasePos.y;
            document.getElementById('directional-z').value = directionalBasePos.z;
            document.getElementById('directional-x-value').textContent = directionalBasePos.x.toFixed(1);
            document.getElementById('directional-y-value').textContent = directionalBasePos.y.toFixed(1);
            document.getElementById('directional-z-value').textContent = directionalBasePos.z.toFixed(1);
        }
        
        directionalX.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            directionalXValue.textContent = value.toFixed(1);
            if (this.directionalLight) {
                this.directionalLight.position.x = value;
            }
        });
        
        directionalY.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            directionalYValue.textContent = value.toFixed(1);
            if (this.directionalLight) {
                this.directionalLight.position.y = value;
            }
        });
        
        directionalZ.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            directionalZValue.textContent = value.toFixed(1);
            if (this.directionalLight) {
                this.directionalLight.position.z = value;
            }
        });
        
        // Fill light controls
        const fillIntensity = document.getElementById('fill-intensity');
        const fillIntensityValue = document.getElementById('fill-intensity-value');
        const fillColor = document.getElementById('fill-color');
        
        fillIntensity.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            fillIntensityValue.textContent = value.toFixed(1);
            if (this.fillLight) this.fillLight.intensity = value;
        });
        
        fillColor.addEventListener('input', (e) => {
            if (this.fillLight) this.fillLight.color.setHex(e.target.value.replace('#', '0x'));
        });
        
        // Point light controls
        const pointIntensity = document.getElementById('point-intensity');
        const pointIntensityValue = document.getElementById('point-intensity-value');
        const pointColor = document.getElementById('point-color');
        
        pointIntensity.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            pointIntensityValue.textContent = value.toFixed(1);
            if (this.pointLight) this.pointLight.intensity = value;
        });
        
        pointColor.addEventListener('input', (e) => {
            if (this.pointLight) this.pointLight.color.setHex(e.target.value.replace('#', '0x'));
        });
        
        // Environment intensity
        const envIntensity = document.getElementById('env-intensity');
        const envIntensityValue = document.getElementById('env-intensity-value');
        
        envIntensity.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            envIntensityValue.textContent = value.toFixed(1);
            this.setEnvironmentIntensity(value);
        });
        
        // Initialize environment intensity with current slider value
        this.setEnvironmentIntensity(parseFloat(envIntensity.value));
    }
    
    setEnvironmentIntensity(value) {
        if (isNaN(value)) return;
        this.currentEnvIntensity = value;
        if (!this.scene) return;
        
        const applyIntensity = (material) => {
            if (!material || material.envMapIntensity === undefined) return;
            material.envMapIntensity = value;
            material.needsUpdate = true;
        };
        
        this.scene.traverse((child) => {
            if (child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(applyIntensity);
                } else {
                    applyIntensity(child.material);
                }
            }
        });
    }
    
    applyEnvironmentMap(map) {
        if (!map) return;
        this.scene.environment = map;
        this.setEnvironmentIntensity(this.currentEnvIntensity);
    }
    
    loadHDRIFromPath(hdriPath) {
        if (!hdriPath) return;
        const fileName = hdriPath.toLowerCase();
        const isEXR = fileName.endsWith('.exr');
        const loader = isEXR ? new EXRLoader() : new RGBELoader();
        
        loader.load(
            hdriPath,
            (texture) => {
                if (this.environmentMap) {
                    this.environmentMap.dispose();
                }
                const envTexture = this.pmremGenerator.fromEquirectangular(texture).texture;
                texture.dispose();
                this.environmentMap = envTexture;
                
                if (document.getElementById('environment-type').value === 'hdri') {
                    this.applyEnvironmentMap(this.environmentMap);
                }
                
                console.log(`HDRI loaded successfully from path: ${hdriPath}`);
            },
            undefined,
            (error) => {
                console.error('Error loading HDRI:', error);
                alert('Failed to load HDRI file. Please check the console for details.');
            }
        );
    }
    
    loadDefaultHDRI() {
        this.loadHDRIFromPath(this.resolveAssetPath('assets/hdri/Bevel_Reflection.exr'));
    }
    
    loadHDRI(file) {
        const fileName = file.name.toLowerCase();
        const isEXR = fileName.endsWith('.exr');
        const loader = isEXR ? new EXRLoader() : new RGBELoader();
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const url = e.target.result;
            
            loader.load(
                url,
                (texture) => {
                    if (this.environmentMap) {
                        this.environmentMap.dispose();
                    }
                    
                    const envTexture = this.pmremGenerator.fromEquirectangular(texture).texture;
                    texture.dispose();
                    this.environmentMap = envTexture;
                    
                    const environmentType = document.getElementById('environment-type');
                    if (environmentType) {
                        environmentType.value = 'hdri';
                    }
                    
                    this.applyEnvironmentMap(this.environmentMap);
                    
                    console.log('HDRI loaded successfully');
                },
                undefined,
                (error) => {
                    console.error('Error loading HDRI:', error);
                    alert('Failed to load HDRI file. Please check the console for details.');
                }
            );
        };
        
        reader.readAsDataURL(file);
    }

    buildOutliner() {
        const outlinerTree = document.getElementById('outliner-tree');
        if (!outlinerTree) {
            console.error('Outliner tree element not found!');
            return;
        }
        
        outlinerTree.innerHTML = '';
        
        if (!this.satellite) {
            outlinerTree.innerHTML = '<div style="color: #888; padding: 10px;">No model loaded</div>';
            return;
        }
        
        // Build tree starting from the satellite
        try {
            const rootItem = this.createOutlinerItem(this.satellite, 'Model');
            outlinerTree.appendChild(rootItem);
            console.log('Outliner built successfully');
        } catch (error) {
            console.error('Error building outliner:', error);
            outlinerTree.innerHTML = '<div style="color: #ff4444; padding: 10px;">Error building outliner</div>';
        }
    }

    createOutlinerItem(object, defaultName = null) {
        const item = document.createElement('div');
        item.className = 'outliner-item';
        item.dataset.objectUuid = object.uuid;
        
        const name = object.name || defaultName || object.type || 'Unnamed';
        const hasChildren = object.children && object.children.length > 0;
        const isMesh = object.isMesh;
        const isGroup = object.isGroup || object.isScene;
        
        // Check if item has attributes to show (object attributes or materials)
        const objAttrs = this.getObjectAttributes(object);
        const hasMaterialAttrs = isMesh && object.material;
        const hasAttributes = hasMaterialAttrs || objAttrs.length > 0;
        
        // Create header
        const header = document.createElement('div');
        header.className = 'outliner-item-header';
        
        // Expand button (if has children OR has attributes)
        if (hasChildren || hasAttributes) {
            const expand = document.createElement('span');
            expand.className = 'outliner-expand';
            header.appendChild(expand);
        } else {
            const spacer = document.createElement('span');
            spacer.style.width = '16px';
            spacer.style.marginRight = '4px';
            header.appendChild(spacer);
        }
        
        // Icon
        const icon = document.createElement('span');
        icon.className = 'outliner-icon';
        if (isMesh) {
            icon.textContent = '◻';
        } else if (isGroup) {
            icon.textContent = '▣';
        } else {
            icon.textContent = '○';
        }
        header.appendChild(icon);
        
        // Name
        const nameSpan = document.createElement('span');
        nameSpan.className = 'outliner-item-name';
        nameSpan.textContent = name;
        header.appendChild(nameSpan);
        
        item.appendChild(header);
        
        // Attributes section (only add if there are attributes to show)
        if (objAttrs.length > 0 || hasMaterialAttrs) {
            const attributes = document.createElement('div');
            attributes.className = 'outliner-attributes';
            
            // Object attributes
            if (objAttrs.length > 0) {
                objAttrs.forEach(attr => {
                    const attrDiv = document.createElement('div');
                    attrDiv.className = 'outliner-attribute';
                    attrDiv.innerHTML = `<span class="outliner-attribute-label">${attr.label}:</span><span class="outliner-attribute-value">${attr.value}</span>`;
                    attributes.appendChild(attrDiv);
                });
            }
            
            // Material attributes (if mesh)
            if (hasMaterialAttrs) {
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                materials.forEach((material, index) => {
                    const materialHeader = document.createElement('div');
                    materialHeader.className = 'outliner-attribute';
                    materialHeader.style.marginTop = '8px';
                    materialHeader.style.color = '#4a9eff';
                    materialHeader.style.fontWeight = 'bold';
                    materialHeader.textContent = `Material ${materials.length > 1 ? index + 1 : ''}`;
                    attributes.appendChild(materialHeader);
                    
                    // Create editable material controls
                    const materialControls = this.createMaterialControls(material, object);
                    attributes.appendChild(materialControls);
                });
            }
            
            item.appendChild(attributes);
        }
        
        // Children
        if (hasChildren) {
            const children = document.createElement('div');
            children.className = 'outliner-children';
            
            object.children.forEach(child => {
                const childItem = this.createOutlinerItem(child);
                children.appendChild(childItem);
            });
            
            item.appendChild(children);
        }
        
        // Event listeners
        header.addEventListener('click', (e) => {
            // Toggle expansion if item is expandable (has children or attributes)
            if (hasChildren || hasAttributes) {
                item.classList.toggle('expanded');
            }
            // Select item
            document.querySelectorAll('.outliner-item-header').forEach(h => h.classList.remove('selected'));
            header.classList.add('selected');
        });
        
        return item;
    }

    getObjectAttributes(object) {
        const attrs = [];
        
        // Position
        if (object.position) {
            attrs.push({
                label: 'Position',
                value: `X: ${object.position.x.toFixed(2)}, Y: ${object.position.y.toFixed(2)}, Z: ${object.position.z.toFixed(2)}`
            });
        }
        
        // Rotation
        if (object.rotation) {
            attrs.push({
                label: 'Rotation',
                value: `X: ${(object.rotation.x * 180 / Math.PI).toFixed(1)}°, Y: ${(object.rotation.y * 180 / Math.PI).toFixed(1)}°, Z: ${(object.rotation.z * 180 / Math.PI).toFixed(1)}°`
            });
        }
        
        // Scale
        if (object.scale) {
            attrs.push({
                label: 'Scale',
                value: `X: ${object.scale.x.toFixed(2)}, Y: ${object.scale.y.toFixed(2)}, Z: ${object.scale.z.toFixed(2)}`
            });
        }
        
        // Type
        attrs.push({
            label: 'Type',
            value: object.type
        });
        
        // Visible
        if (object.visible !== undefined) {
            attrs.push({
                label: 'Visible',
                value: object.visible ? 'Yes' : 'No'
            });
        }
        
        // Geometry info (if mesh)
        if (object.isMesh && object.geometry) {
            const geo = object.geometry;
            if (geo.attributes && geo.attributes.position) {
                const vertexCount = geo.attributes.position.count;
                attrs.push({
                    label: 'Vertices',
                    value: vertexCount.toLocaleString()
                });
            }
        }
        
        return attrs;
    }

    createMaterialControls(material, mesh) {
        const container = document.createElement('div');
        container.className = 'material-controls';
        container.style.marginLeft = '12px';
        
        if (!material) return container;
        
        // Material type (read-only)
        const typeDiv = document.createElement('div');
        typeDiv.className = 'outliner-attribute';
        typeDiv.innerHTML = `<span class="outliner-attribute-label">Type:</span><span class="outliner-attribute-value">${material.type}</span>`;
        container.appendChild(typeDiv);
        
        // Color picker
        if (material.color) {
            const colorDiv = document.createElement('div');
            colorDiv.className = 'outliner-attribute editable-attribute';
            const label = document.createElement('span');
            label.className = 'outliner-attribute-label';
            label.textContent = 'Color:';
            colorDiv.appendChild(label);
            
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.value = '#' + material.color.getHexString();
            colorInput.className = 'material-color-picker';
            
            const colorValue = document.createElement('span');
            colorValue.className = 'outliner-attribute-value';
            colorValue.textContent = colorInput.value;
            colorValue.style.marginLeft = '8px';
            
            colorInput.addEventListener('input', (e) => {
                material.color.setHex(e.target.value.replace('#', '0x'));
                material.needsUpdate = true;
                colorValue.textContent = e.target.value;
            });
            
            colorDiv.appendChild(colorInput);
            colorDiv.appendChild(colorValue);
            
            container.appendChild(colorDiv);
        }
        
        // Roughness slider
        if (material.roughness !== undefined) {
            const roughnessDiv = this.createSliderControl('Roughness', material.roughness, 0, 1, 0.01, (value) => {
                material.roughness = value;
                material.needsUpdate = true;
            });
            container.appendChild(roughnessDiv);
        }
        
        // Metalness slider
        if (material.metalness !== undefined) {
            const metalnessDiv = this.createSliderControl('Metalness', material.metalness, 0, 1, 0.01, (value) => {
                material.metalness = value;
                material.needsUpdate = true;
            });
            container.appendChild(metalnessDiv);
        }
        
        // Emissive color picker
        if (material.emissive) {
            const emissiveDiv = document.createElement('div');
            emissiveDiv.className = 'outliner-attribute editable-attribute';
            const label = document.createElement('span');
            label.className = 'outliner-attribute-label';
            label.textContent = 'Emissive:';
            emissiveDiv.appendChild(label);
            
            const emissiveInput = document.createElement('input');
            emissiveInput.type = 'color';
            emissiveInput.value = '#' + material.emissive.getHexString();
            emissiveInput.className = 'material-color-picker';
            
            const emissiveValue = document.createElement('span');
            emissiveValue.className = 'outliner-attribute-value';
            emissiveValue.textContent = emissiveInput.value;
            emissiveValue.style.marginLeft = '8px';
            
            emissiveInput.addEventListener('input', (e) => {
                material.emissive.setHex(e.target.value.replace('#', '0x'));
                material.needsUpdate = true;
                emissiveValue.textContent = e.target.value;
            });
            
            emissiveDiv.appendChild(emissiveInput);
            emissiveDiv.appendChild(emissiveValue);
            
            container.appendChild(emissiveDiv);
        }
        
        // Emissive intensity slider
        if (material.emissiveIntensity !== undefined) {
            const emissiveIntensityDiv = this.createSliderControl('Emissive Intensity', material.emissiveIntensity, 0, 5, 0.1, (value) => {
                material.emissiveIntensity = value;
                material.needsUpdate = true;
            });
            container.appendChild(emissiveIntensityDiv);
        }
        
        // Opacity slider (if transparent)
        if (material.opacity !== undefined) {
            const opacityDiv = this.createSliderControl('Opacity', material.opacity, 0, 1, 0.01, (value) => {
                material.opacity = value;
                material.transparent = value < 1.0;
                material.needsUpdate = true;
            });
            container.appendChild(opacityDiv);
        }
        
        // Textures - Add texture upload controls for all texture map types
        const textureMaps = [
            { name: 'map', label: 'Diffuse/Albedo Map', accept: 'image/*' },
            { name: 'normalMap', label: 'Normal Map', accept: 'image/*' },
            { name: 'roughnessMap', label: 'Roughness Map', accept: 'image/*' },
            { name: 'metalnessMap', label: 'Metalness Map', accept: 'image/*' },
            { name: 'aoMap', label: 'AO Map', accept: 'image/*' },
            { name: 'emissiveMap', label: 'Emissive Map', accept: 'image/*' }
        ];
        
        textureMaps.forEach(textureInfo => {
            const textureDiv = document.createElement('div');
            textureDiv.className = 'outliner-attribute editable-attribute';
            textureDiv.style.marginTop = '8px';
            
            const label = document.createElement('span');
            label.className = 'outliner-attribute-label';
            label.textContent = textureInfo.label + ':';
            label.style.display = 'block';
            label.style.marginBottom = '4px';
            textureDiv.appendChild(label);
            
            // Status indicator
            const statusSpan = document.createElement('span');
            statusSpan.className = 'outliner-attribute-value';
            statusSpan.style.fontSize = '11px';
            statusSpan.style.color = material[textureInfo.name] ? '#4a9eff' : '#888';
            statusSpan.textContent = material[textureInfo.name] ? '✓ Loaded' : 'Not loaded';
            textureDiv.appendChild(statusSpan);
            
            // File input (hidden)
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = textureInfo.accept;
            fileInput.style.display = 'none';
            fileInput.id = `texture-${textureInfo.name}-${material.uuid || Date.now()}`;
            
            // Load button
            const loadButton = document.createElement('button');
            loadButton.textContent = material[textureInfo.name] ? 'Replace Texture' : 'Load Texture';
            loadButton.className = 'material-texture-button';
            loadButton.style.marginTop = '4px';
            loadButton.style.padding = '4px 8px';
            loadButton.style.fontSize = '11px';
            loadButton.style.background = 'rgba(74, 158, 255, 0.2)';
            loadButton.style.border = '1px solid #4a9eff';
            loadButton.style.borderRadius = '4px';
            loadButton.style.color = '#4a9eff';
            loadButton.style.cursor = 'pointer';
            loadButton.style.width = '100%';
            
            loadButton.addEventListener('click', () => {
                fileInput.click();
            });
            
            // Remove button (if texture exists)
            let removeButton = null;
            if (material[textureInfo.name]) {
                removeButton = document.createElement('button');
                removeButton.textContent = 'Remove';
                removeButton.className = 'material-texture-button';
                removeButton.style.marginTop = '4px';
                removeButton.style.marginLeft = '4px';
                removeButton.style.padding = '4px 8px';
                removeButton.style.fontSize = '11px';
                removeButton.style.background = 'rgba(255, 68, 68, 0.2)';
                removeButton.style.border = '1px solid #ff4444';
                removeButton.style.borderRadius = '4px';
                removeButton.style.color = '#ff4444';
                removeButton.style.cursor = 'pointer';
                
                removeButton.addEventListener('click', () => {
                    if (material[textureInfo.name]) {
                        material[textureInfo.name].dispose();
                        material[textureInfo.name] = null;
                        material.needsUpdate = true;
                        statusSpan.textContent = 'Not loaded';
                        statusSpan.style.color = '#888';
                        loadButton.textContent = 'Load Texture';
                        if (removeButton) removeButton.remove();
                    }
                });
            }
            
            // File input handler
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.loadTextureForMaterial(material, textureInfo.name, file, statusSpan, loadButton, removeButton, textureDiv);
                }
            });
            
            textureDiv.appendChild(fileInput);
            textureDiv.appendChild(loadButton);
            if (removeButton) {
                textureDiv.appendChild(removeButton);
            }
            
            container.appendChild(textureDiv);
        });
        
        return container;
    }
    
    loadTextureForMaterial(material, mapName, file, statusSpan, loadButton, removeButton, container) {
        const textureLoader = new THREE.TextureLoader();
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const url = e.target.result;
            
            textureLoader.load(
                url,
                (texture) => {
                    // Dispose old texture if it exists
                    if (material[mapName]) {
                        material[mapName].dispose();
                    }
                    
                    // Configure texture based on map type
                    const isColorTexture = mapName === 'map' || mapName === 'emissiveMap';
                    this.configureTexture(texture, isColorTexture);
                    
                    // Store source URL for saving (if it's a file URL, we'll save it)
                    texture.userData = texture.userData || {};
                    if (url.startsWith('data:') || url.startsWith('blob:')) {
                        // For file uploads, we can't save the actual data, but we mark it as custom
                        texture.userData.isCustomTexture = true;
                        texture.userData.sourceUrl = url; // Save the data URL for restoration
                    } else {
                        // For file paths, save the path
                        texture.userData.sourceUrl = url;
                    }
                    
                    // Generate mipmaps
                    if (texture.image && texture.image.width) {
                        texture.generateMipmaps = true;
                    }
                    
                    // Set texture on material
                    material[mapName] = texture;
                    material.needsUpdate = true;
                    
                    // Update UI
                    statusSpan.textContent = '✓ Loaded';
                    statusSpan.style.color = '#4a9eff';
                    loadButton.textContent = 'Replace Texture';
                    
                    // Add remove button if it doesn't exist
                    if (!removeButton) {
                        removeButton = document.createElement('button');
                        removeButton.textContent = 'Remove';
                        removeButton.className = 'material-texture-button';
                        removeButton.style.marginTop = '4px';
                        removeButton.style.marginLeft = '4px';
                        removeButton.style.padding = '4px 8px';
                        removeButton.style.fontSize = '11px';
                        removeButton.style.background = 'rgba(255, 68, 68, 0.2)';
                        removeButton.style.border = '1px solid #ff4444';
                        removeButton.style.borderRadius = '4px';
                        removeButton.style.color = '#ff4444';
                        removeButton.style.cursor = 'pointer';
                        
                        removeButton.addEventListener('click', () => {
                            if (material[mapName]) {
                                material[mapName].dispose();
                                material[mapName] = null;
                                material.needsUpdate = true;
                                statusSpan.textContent = 'Not loaded';
                                statusSpan.style.color = '#888';
                                loadButton.textContent = 'Load Texture';
                                removeButton.remove();
                            }
                        });
                        
                        container.appendChild(removeButton);
                    }
                    
                    console.log(`Texture loaded for ${mapName}`);
                },
                undefined,
                (error) => {
                    console.error(`Error loading texture for ${mapName}:`, error);
                    alert(`Failed to load texture. Please check the console for details.`);
                    statusSpan.textContent = 'Error loading';
                    statusSpan.style.color = '#ff4444';
                }
            );
        };
        
        reader.readAsDataURL(file);
    }

    createSliderControl(label, value, min, max, step, onChange) {
        const div = document.createElement('div');
        div.className = 'outliner-attribute editable-attribute';
        
        const labelSpan = document.createElement('span');
        labelSpan.className = 'outliner-attribute-label';
        labelSpan.textContent = label + ':';
        div.appendChild(labelSpan);
        
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = value;
        slider.className = 'material-slider';
        slider.addEventListener('input', (e) => {
            const newValue = parseFloat(e.target.value);
            valueSpan.textContent = newValue.toFixed(2);
            onChange(newValue);
        });
        div.appendChild(slider);
        
        const valueSpan = document.createElement('span');
        valueSpan.className = 'outliner-attribute-value';
        valueSpan.textContent = value.toFixed(2);
        valueSpan.style.marginLeft = '8px';
        valueSpan.style.minWidth = '40px';
        valueSpan.style.display = 'inline-block';
        div.appendChild(valueSpan);
        
        return div;
    }

    getMaterialAttributes(material) {
        const attrs = [];
        
        if (!material) return attrs;
        
        // Material type
        attrs.push({
            label: 'Type',
            value: material.type
        });
        
        // Color
        if (material.color) {
            const color = material.color;
            const hex = '#' + color.getHexString();
            attrs.push({
                label: 'Color',
                value: hex
            });
        }
        
        // Roughness
        if (material.roughness !== undefined) {
            attrs.push({
                label: 'Roughness',
                value: material.roughness.toFixed(2)
            });
        }
        
        // Metalness
        if (material.metalness !== undefined) {
            attrs.push({
                label: 'Metalness',
                value: material.metalness.toFixed(2)
            });
        }
        
        // Transparency
        if (material.transparent !== undefined) {
            attrs.push({
                label: 'Transparent',
                value: material.transparent ? 'Yes' : 'No'
            });
        }
        
        // Opacity
        if (material.opacity !== undefined && material.transparent) {
            attrs.push({
                label: 'Opacity',
                value: material.opacity.toFixed(2)
            });
        }
        
        // Textures
        const textureMaps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
        textureMaps.forEach(mapName => {
            if (material[mapName]) {
                attrs.push({
                    label: mapName,
                    value: 'Yes'
                });
            }
        });
        
        return attrs;
    }

    loadModelFromFile(file) {
        // Remove existing model if any
        if (this.satellite) {
            this.scene.remove(this.satellite);
            // Dispose of materials and geometries
            this.satellite.traverse((child) => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => {
                                if (mat.map) mat.map.dispose();
                                if (mat.normalMap) mat.normalMap.dispose();
                                if (mat.roughnessMap) mat.roughnessMap.dispose();
                                if (mat.metalnessMap) mat.metalnessMap.dispose();
                                if (mat.aoMap) mat.aoMap.dispose();
                                if (mat.emissiveMap) mat.emissiveMap.dispose();
                                mat.dispose();
                            });
                        } else {
                            if (child.material.map) child.material.map.dispose();
                            if (child.material.normalMap) child.material.normalMap.dispose();
                            if (child.material.roughnessMap) child.material.roughnessMap.dispose();
                            if (child.material.metalnessMap) child.material.metalnessMap.dispose();
                            if (child.material.aoMap) child.material.aoMap.dispose();
                            if (child.material.emissiveMap) child.material.emissiveMap.dispose();
                            child.material.dispose();
                        }
                    }
                }
            });
            this.satellite = null;
        }
        
        // Clear part data
        this.partData.clear();
        
        // Close any open indicators
        this.closeIndicator();
        
        // Clear outliner
        this.buildOutliner();
        
        // Show loading indicator
        this.showLoadingIndicator();
        
        // Load new model
        const loader = this.createGLTFLoader();
        const fileURL = URL.createObjectURL(file);
        
        loader.load(
            fileURL,
            (gltf) => {
                this.satellite = gltf.scene;
                
                // Process all textures in the loaded model
                this.processGLTFTextures(gltf);
                
                // Calculate bounding box to center and scale the model
                const box = new THREE.Box3().setFromObject(this.satellite);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                
                // Center the model
                this.satellite.position.x = -center.x;
                this.satellite.position.y = -center.y;
                this.satellite.position.z = -center.z;
                
                // Scale model larger
                this.satellite.scale.set(40, 40, 40);
                
                // Convert materials to proper format for Three.js
                this.convertMaterials(this.satellite);
                
                // Apply solar panel texture to specific materials
                this.applySolarPanelTexture();
                
                // Add part info to meshes that have names
                this.satellite.traverse((child) => {
                    if (child.isMesh) {
                        // If the mesh has a name, create default part info
                        if (child.name && child.name.trim() !== '') {
                            const formattedName = this.formatPartName(child.name);
                            child.userData.partInfo = {
                                name: formattedName,
                                description: `Part of the ${formattedName} component.`
                            };
                            this.partData.set(child.uuid, child.userData.partInfo);
                        }
                    }
                });
                
                this.setEnvironmentIntensity(this.currentEnvIntensity);
                
                // Add satellite to scene
                this.scene.add(this.satellite);
                
                // Build outliner
                this.buildOutliner();
                
                // Adjust camera position based on model size (closer zoom)
                const newSize = new THREE.Box3().setFromObject(this.satellite).getSize(new THREE.Vector3());
                const maxSize = Math.max(newSize.x, newSize.y, newSize.z);
                this.camera.position.set(0, 0, -maxSize * 0.8);
                this.controls.update();
                
                // Hide loading indicator after model is fully loaded
                this.updateLoadingProgress(100);
                setTimeout(() => {
                    this.hideLoadingIndicator();
                }, 300);
                
                // Clean up object URL
                URL.revokeObjectURL(fileURL);
                
                console.log('Model loaded successfully from file:', file.name);
            },
            (progress) => {
                // Loading progress
                if (progress.lengthComputable) {
                    const percentComplete = (progress.loaded / progress.total) * 100;
                    this.updateLoadingProgress(percentComplete);
                    console.log('Loading progress:', percentComplete.toFixed(2) + '%');
                } else {
                    console.log('Loading...', progress.loaded, 'bytes');
                }
            },
            (error) => {
                console.error('Error loading GLTF model:', error);
                this.hideLoadingIndicator();
                alert('Failed to load 3D model. Please check the console for details.');
                URL.revokeObjectURL(fileURL);
            }
        );
    }

    onMouseDoubleClick(event) {
        // Calculate mouse position in normalized device coordinates
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        
        // DEBUG: Log mouse and camera position
        console.log('=== MOUSE CLICK DEBUG ===');
        console.log('Mouse Screen Position:', { x: event.clientX, y: event.clientY });
        console.log('Mouse NDC:', { x: this.mouse.x, y: this.mouse.y });
        console.log('Camera Position:', {
            x: this.camera.position.x.toFixed(3),
            y: this.camera.position.y.toFixed(3),
            z: this.camera.position.z.toFixed(3)
        });
        console.log('Camera Target:', {
            x: this.controls.target.x.toFixed(3),
            y: this.controls.target.y.toFixed(3),
            z: this.controls.target.z.toFixed(3)
        });
        
        // Update raycaster
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Find intersections (check the satellite and all its children)
        const intersects = this.raycaster.intersectObjects(this.satellite ? [this.satellite] : [], true);
        
        if (intersects.length > 0) {
            const clickedObject = intersects[0].object;
            const intersectionPoint = intersects[0].point;
            
            // DEBUG: Log intersection details
            console.log('Intersection Point (World):', {
                x: intersectionPoint.x.toFixed(3),
                y: intersectionPoint.y.toFixed(3),
                z: intersectionPoint.z.toFixed(3)
            });
            console.log('Clicked Object:', clickedObject.name || 'Unnamed');
            console.log('Distance from camera:', intersectionPoint.distanceTo(this.camera.position).toFixed(3));
            
            // Store the intersection point for positioning the popup
            this.lastIntersectionPoint = intersectionPoint.clone();
            
            // Pause rotation on click
            this.isRotationPaused = true;
            
            // If clicking the same part, close the indicator
            if (this.selectedPart === clickedObject) {
                this.closeIndicator();
            } else {
                // Show indicator for new part
                this.showIndicator(clickedObject, intersectionPoint);
            }
        } else {
            console.log('No intersection found');
        }
    }

    showIndicator(object, intersectionPoint) {
        this.selectedPart = object;
        this.selectedObject = object;
        
        // Convert intersection point (world coords) to local coords relative to object
        const localIntersection = intersectionPoint.clone();
        object.worldToLocal(localIntersection);
        this.selectedIntersectionPoint = localIntersection;
        
        // DEBUG: Log indicator details
        console.log('=== SHOW INDICATOR DEBUG ===');
        console.log('Object:', object.name || 'Unnamed');
        console.log('Intersection Point (World):', {
            x: intersectionPoint.x.toFixed(3),
            y: intersectionPoint.y.toFixed(3),
            z: intersectionPoint.z.toFixed(3)
        });
        console.log('Intersection Point (Local):', {
            x: localIntersection.x.toFixed(3),
            y: localIntersection.y.toFixed(3),
            z: localIntersection.z.toFixed(3)
        });
        
        // Pause rotation when indicator is shown
        this.isRotationPaused = true;
        
        const partInfo = object.userData.partInfo || this.partData.get(object.uuid);
        
        if (partInfo) {
            // Format the name for display
            const displayName = this.formatPartName(partInfo.name);
            document.getElementById('indicator-title').textContent = displayName;
            document.getElementById('indicator-description').textContent = partInfo.description;
            
            // Initial update of line and popup position
            this.updateIndicatorPosition();
            
            const overlay = document.getElementById('indicator-overlay');
            overlay.classList.remove('hidden');

            // Show panel first, then line after a short delay
            this.indicatorLineReady = false;
            setTimeout(() => {
                this.indicatorLineReady = true;
            }, 250);
        }
    }

    showPartPreset(partName) {
        if (!this.satellite) return;
        
        // Normalize part name for matching (handle variations)
        const normalizedName = partName.toLowerCase().trim();
        const matchPatterns = {
            'crew module': ['crew module', 'heat shield'],
            'european service': ['european service', 'european service module', 'mid02', 'mid17', 'mid02 white', 'mid17 white'],
            'solar arrays': ['solar arrays', 'panel', 'solar panel'],
            'exhaust': ['exhaust', 'exhaust01', 'exhaust02', 'exhaust01 exhaust', 'exhaust02 exhaust']
        };
        
        // Find matching pattern
        let patternsToMatch = [];
        for (const [key, patterns] of Object.entries(matchPatterns)) {
            if (patterns.some(p => normalizedName.includes(p.toLowerCase()))) {
                patternsToMatch = patterns;
                break;
            }
        }
        
        if (patternsToMatch.length === 0) {
            patternsToMatch = [normalizedName];
        }
        
        const matchingObjects = [];
        
        // Traverse all meshes and find matching parts
        this.satellite.traverse((child) => {
            if (child.isMesh) {
                const partInfo = child.userData.partInfo || this.partData.get(child.uuid);
                if (partInfo) {
                    const formattedName = this.formatPartName(partInfo.name).toLowerCase();
                    const matches = patternsToMatch.some(pattern => 
                        formattedName.includes(pattern.toLowerCase())
                    );
                    
                    if (matches) {
                        matchingObjects.push(child);
                    }
                } else {
                    // If no part info, check the mesh name
                    const meshName = child.name.toLowerCase();
                    const matches = patternsToMatch.some(pattern => 
                        meshName.includes(pattern.toLowerCase())
                    );
                    
                    if (matches) {
                        matchingObjects.push(child);
                    }
                }
            }
        });

        // Fallback: if European Service is not found, use the full satellite
        if (matchingObjects.length === 0 && normalizedName === 'european service' && this.satellite) {
            matchingObjects.push(this.satellite);
        }
        
        // Focus camera on matching parts if any found
        if (matchingObjects.length > 0) {
            const box = new THREE.Box3();
            matchingObjects.forEach(obj => {
                box.expandByObject(obj);
            });
            
            if (!box.isEmpty()) {
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                
                // For Crew Module, European Service, Solar Arrays, and Exhaust, show popup label and focus without getting too close
                if (normalizedName === 'crew module' || normalizedName === 'european service' || normalizedName === 'solar arrays' || normalizedName === 'exhaust') {
                    // Use a closer distance for better view
                    // For Solar Arrays, use a fixed distance for a tighter shot
                    const distance = normalizedName === 'solar arrays' ? 3 : maxDim * 2.2;
                    
                    let selectedObject = matchingObjects[0];
                    
                    // For Exhaust, try to find the main exhaust nozzle (Exhaust01 or Exhaust02)
                    if (normalizedName === 'exhaust' && matchingObjects.length > 1) {
                        // Try to find Exhaust01 or Exhaust02 by name
                        let mainExhaust = matchingObjects.find(obj => {
                            const objName = obj.name ? obj.name.toLowerCase() : '';
                            return objName.includes('exhaust01') || objName.includes('exhaust02');
                        });
                        
                        if (mainExhaust) {
                            selectedObject = mainExhaust;
                        }
                    }
                    
                    // For Solar Arrays, find Panel_01 specifically
                    if (normalizedName === 'solar arrays' && matchingObjects.length > 0) {
                        // Try to find Panel_01 by name
                        let panel01 = matchingObjects.find(obj => {
                            const objName = obj.name ? obj.name.toLowerCase() : '';
                            return objName.includes('panel_01') || objName.includes('panel01');
                        });
                        
                        if (panel01) {
                            selectedObject = panel01;
                        } else if (matchingObjects.length === 1) {
                            selectedObject = matchingObjects[0];
                        } else {
                            // Fallback: choose the leftmost panel to keep the popup near left arrays
                            const positions = matchingObjects.map(obj => {
                                const box = new THREE.Box3().setFromObject(obj);
                                const objCenter = box.getCenter(new THREE.Vector3());
                                obj.localToWorld(objCenter);
                                return { obj, x: objCenter.x };
                            });
                            
                            positions.sort((a, b) => a.x - b.x); // leftmost X first
                            selectedObject = positions[0].obj;
                        }
                    }
                    
                    // Define camera position first (needed for Solar Arrays calculation)
                    let offset;
                    let targetPositionOverride = null;
                    let lookAtOverride = null;
                    if (normalizedName === 'solar arrays') {
                        // For Solar Arrays: front view showing spacecraft and full panels
                        offset = new THREE.Vector3(0.0, 0.2, -1.3).multiplyScalar(distance);
                    } else if (normalizedName === 'exhaust') {
                        // For Exhaust: show the opposite side with gentle rotation approach
                        // Start further away and rotate around
                        offset = new THREE.Vector3(0.4, 0.15, 1.1).multiplyScalar(distance);
                    } else if (normalizedName === 'crew module') {
                        // For Crew Module: front view with circular structure visible on the right
                        offset = new THREE.Vector3(-0.4, 0.15, -1.1).multiplyScalar(distance);
                    } else if (normalizedName === 'european service') {
                        // For European Service: use exact captured camera position/target
                        targetPositionOverride = new THREE.Vector3(-3.80, -0.63, 0.56);
                        lookAtOverride = new THREE.Vector3(-0.04, -0.06, 0.07);
                    } else {
                        // Default fallback
                        offset = new THREE.Vector3(-0.5, 0.2, -1).multiplyScalar(distance);
                    }
                    const targetPosition = targetPositionOverride || center.clone().add(offset);
                    // For Solar Arrays, look at the center of the entire satellite to show the whole spacecraft
                    let lookAtPoint = lookAtOverride || center;
                    if (normalizedName === 'solar arrays' && this.satellite) {
                        const satelliteBox = new THREE.Box3().setFromObject(this.satellite);
                        if (!satelliteBox.isEmpty()) {
                            lookAtPoint = satelliteBox.getCenter(new THREE.Vector3());
                        }
                    }
                    
                    // Smooth camera transition
                    const startPosition = this.camera.position.clone();
                    const startTarget = this.controls.target.clone();
                    const startTime = performance.now();
                    const duration = normalizedName === 'exhaust' ? 2500 : 1500; // Longer duration for smoother transitions
                    
                    // Show the indicator popup for the selected part after camera movement
                    if (selectedObject) {
                        // Calculate the intersection point on the actual part surface (in world coordinates)
                        let intersectionPoint = center.clone();
                        
                        if (normalizedName === 'solar arrays') {
                            // For solar arrays, get a point on the visible surface of the panel
                            // Calculate based on target camera position
                            const objBox = new THREE.Box3().setFromObject(selectedObject);
                            const size = objBox.getSize(new THREE.Vector3());
                            const localCenter = objBox.getCenter(new THREE.Vector3());
                            
                            // Use the target camera position (where camera will be) to determine visible face
                            const targetCameraPos = targetPosition.clone();
                            const cameraLocalPos = targetCameraPos.clone();
                            selectedObject.worldToLocal(cameraLocalPos);
                            
                            // Calculate direction from panel center to target camera
                            const toCamera = cameraLocalPos.clone().sub(localCenter);
                            const toCameraNormalized = toCamera.normalize();
                            
                            // Find the face closest to the camera and place point on that surface
                            const surfacePoint = localCenter.clone();
                            
                            // Determine which face is most visible by checking the largest component
                            const absX = Math.abs(toCameraNormalized.x);
                            const absY = Math.abs(toCameraNormalized.y);
                            const absZ = Math.abs(toCameraNormalized.z);
                            
                            if (absX >= absY && absX >= absZ) {
                                // X-axis face is most visible
                                surfacePoint.x += toCameraNormalized.x > 0 ? size.x * 0.48 : -size.x * 0.48;
                            } else if (absY >= absX && absY >= absZ) {
                                // Y-axis face is most visible
                                surfacePoint.y += toCameraNormalized.y > 0 ? size.y * 0.48 : -size.y * 0.48;
                            } else {
                                // Z-axis face is most visible
                                surfacePoint.z += toCameraNormalized.z > 0 ? size.z * 0.48 : -size.z * 0.48;
                            }
                            
                            // Convert to world coordinates
                            intersectionPoint = surfacePoint.clone();
                            selectedObject.localToWorld(intersectionPoint);
                        }
                        // For other parts, use the overall center (already in world coordinates)
                        
                        // Ensure we have a valid object with part info
                        // For preset parts, always set clean part info to override any existing names
                        let partName = 'Part';
                        let partDescription = 'Part component.';
                        
                        if (normalizedName === 'solar arrays') {
                            partName = 'Solar Arrays';
                            partDescription = 'Part of the Solar Arrays component.';
                        } else if (normalizedName === 'exhaust') {
                            partName = 'Exhaust';
                            partDescription = 'Part of the Exhaust component.';
                        } else if (normalizedName === 'crew module') {
                            partName = 'Crew Module';
                            partDescription = 'Part of the Crew Module component.';
                        } else if (normalizedName === 'european service') {
                            partName = 'European Service';
                            partDescription = 'Part of the European Service component.';
                        }
                        
                        // Always set clean part info for preset parts to ensure correct label
                        selectedObject.userData.partInfo = {
                            name: partName,
                            description: partDescription
                        };
                        
                        // Delay showing popup until camera animation completes
                        if (normalizedName === 'solar arrays') {
                            // Wait for camera animation to complete, then calculate accurate intersection point
                            setTimeout(() => {
                                // DEBUG: Log camera position after animation
                                console.log('=== SOLAR ARRAYS PRESET DEBUG ===');
                                console.log('Camera Position (after animation):', {
                                    x: this.camera.position.x.toFixed(3),
                                    y: this.camera.position.y.toFixed(3),
                                    z: this.camera.position.z.toFixed(3)
                                });
                                console.log('Camera Target:', {
                                    x: this.controls.target.x.toFixed(3),
                                    y: this.controls.target.y.toFixed(3),
                                    z: this.controls.target.z.toFixed(3)
                                });
                                console.log('Selected Object:', selectedObject.name || 'Unnamed');
                                
                                // Use raycasting to find the exact intersection point on the panel surface
                                const raycaster = new THREE.Raycaster();
                                const cameraWorldPos = this.camera.position.clone();
                                
                                // Get the panel's bounding box center in world space
                                const objBox = new THREE.Box3().setFromObject(selectedObject);
                                const panelCenter = objBox.getCenter(new THREE.Vector3());
                                selectedObject.localToWorld(panelCenter);
                                
                                console.log('Panel Center (World):', {
                                    x: panelCenter.x.toFixed(3),
                                    y: panelCenter.y.toFixed(3),
                                    z: panelCenter.z.toFixed(3)
                                });
                                
                                // Calculate direction from camera to panel center
                                const direction = panelCenter.clone().sub(cameraWorldPos).normalize();
                                
                                console.log('Ray Direction:', {
                                    x: direction.x.toFixed(3),
                                    y: direction.y.toFixed(3),
                                    z: direction.z.toFixed(3)
                                });
                                
                                // Cast ray from camera through panel center
                                raycaster.set(cameraWorldPos, direction);
                                
                                // Find intersection with the panel
                                const intersects = raycaster.intersectObject(selectedObject, true);
                                
                                console.log('Raycast Intersections:', intersects.length);
                                
                                let finalIntersection;
                                if (intersects.length > 0) {
                                    // Use the first intersection point (closest to camera)
                                    finalIntersection = intersects[0].point;
                                    console.log('Using Raycast Intersection:', {
                                        x: finalIntersection.x.toFixed(3),
                                        y: finalIntersection.y.toFixed(3),
                                        z: finalIntersection.z.toFixed(3),
                                        distance: intersects[0].distance.toFixed(3)
                                    });
                                } else {
                                    console.log('No raycast intersection, using fallback calculation');
                                    // Fallback: calculate point on visible surface
                                    const size = objBox.getSize(new THREE.Vector3());
                                    const localCenter = objBox.getCenter(new THREE.Vector3());
                                    const cameraLocalPos = cameraWorldPos.clone();
                                    selectedObject.worldToLocal(cameraLocalPos);
                                    
                                    const toCamera = cameraLocalPos.clone().sub(localCenter);
                                    const toCameraNormalized = toCamera.normalize();
                                    
                                    const absX = Math.abs(toCameraNormalized.x);
                                    const absY = Math.abs(toCameraNormalized.y);
                                    const absZ = Math.abs(toCameraNormalized.z);
                                    
                                    const surfacePoint = localCenter.clone();
                                    if (absX >= absY && absX >= absZ) {
                                        surfacePoint.x += toCameraNormalized.x > 0 ? size.x * 0.48 : -size.x * 0.48;
                                    } else if (absY >= absX && absY >= absZ) {
                                        surfacePoint.y += toCameraNormalized.y > 0 ? size.y * 0.48 : -size.y * 0.48;
                                    } else {
                                        surfacePoint.z += toCameraNormalized.z > 0 ? size.z * 0.48 : -size.z * 0.48;
                                    }
                                    
                                    finalIntersection = surfacePoint.clone();
                                    selectedObject.localToWorld(finalIntersection);
                                    console.log('Fallback Intersection:', {
                                        x: finalIntersection.x.toFixed(3),
                                        y: finalIntersection.y.toFixed(3),
                                        z: finalIntersection.z.toFixed(3)
                                    });
                                }
                                
                                // Show indicator with the accurately calculated point
                                this.showIndicator(selectedObject, finalIntersection);
                            }, duration + 100);
                        } else {
                            setTimeout(() => {
                                this.showIndicator(selectedObject, intersectionPoint);
                            }, duration + 100);
                        }
                    }
                    
                    const animateCamera = () => {
                        const elapsed = performance.now() - startTime;
                        const progress = Math.min(elapsed / duration, 1);
                        
                        // Smooth ease in-out for all animations
                        const easeProgress = progress < 0.5
                            ? 2 * progress * progress // Ease in (quadratic)
                            : 1 - Math.pow(-2 * progress + 2, 3) / 2; // Ease out (cubic)
                        
                        if (normalizedName === 'exhaust') {
                            // For Exhaust: gentle rotation approach - don't fly directly into the part
                            // Start further away and gradually rotate around while getting closer
                            const angle = easeProgress * Math.PI * 0.25; // Rotate 45 degrees around
                            const startRadius = distance * 1.8; // Start further away
                            const endRadius = distance * 1.2; // End closer but not too close
                            const currentRadius = startRadius + (endRadius - startRadius) * easeProgress;
                            
                            // Calculate position on circular path around the object
                            const currentOffset = new THREE.Vector3(
                                Math.sin(angle) * 0.4 + Math.cos(angle) * 0.1,
                                0.15,
                                Math.cos(angle) * 1.1 - Math.sin(angle) * 0.1
                            ).multiplyScalar(currentRadius);
                            
                            const currentTarget = center.clone().add(currentOffset);
                            this.camera.position.lerpVectors(startPosition, currentTarget, easeProgress);
                            this.controls.target.lerp(lookAtPoint, easeProgress);
                        } else {
                            // For other parts: smooth direct approach
                            this.camera.position.lerpVectors(startPosition, targetPosition, easeProgress);
                            this.controls.target.lerp(lookAtPoint, easeProgress);
                        }
                        
                        // Update controls
                        this.controls.update();
                        
                        if (progress < 1) {
                            requestAnimationFrame(animateCamera);
                        }
                    };
                    
                    animateCamera();
                } else {
                    // For other parts, use the existing logic
                    const distance = maxDim * 2.5; // Slightly further for better view
                    
                    // Define camera positions and orientations for each part type
                    const cameraPresets = {
                        'european service': {
                            offset: new THREE.Vector3(0, 0, -1), // Back view
                            lookAt: new THREE.Vector3(0, 0, 0)
                        },
                        'solar arrays': {
                            offset: new THREE.Vector3(1, 0, 0), // Side view
                            lookAt: new THREE.Vector3(0, 0, 0)
                        },
                        'exhaust': {
                            offset: new THREE.Vector3(0, -0.5, -1), // Back-bottom view
                            lookAt: new THREE.Vector3(0, 0, 0)
                        }
                    };
                    
                    // Get preset for this part, or use default
                    const preset = cameraPresets[normalizedName] || {
                        offset: new THREE.Vector3(0, 0.3, 1),
                        lookAt: new THREE.Vector3(0, 0, 0)
                    };
                    
                    // Calculate target camera position relative to center
                    const targetPosition = center.clone();
                    const offset = preset.offset.clone().multiplyScalar(distance);
                    targetPosition.add(offset);
                    
                    // Calculate look-at point (center of the part)
                    const lookAtPoint = center.clone().add(preset.lookAt.clone().multiplyScalar(distance * 0.1));
                    
                    // Smooth camera transition
                    const startPosition = this.camera.position.clone();
                    const startTarget = this.controls.target.clone();
                    const startTime = performance.now();
                    const duration = 1200; // 1.2 seconds
                    
                    const animateCamera = () => {
                        const elapsed = performance.now() - startTime;
                        const progress = Math.min(elapsed / duration, 1);
                        const easeProgress = 1 - Math.pow(1 - progress, 3); // Ease out cubic
                        
                        // Interpolate camera position
                        this.camera.position.lerpVectors(startPosition, targetPosition, easeProgress);
                        
                        // Interpolate controls target (what camera looks at)
                        this.controls.target.lerp(lookAtPoint, easeProgress);
                        
                        // Update controls
                        this.controls.update();
                        
                        if (progress < 1) {
                            requestAnimationFrame(animateCamera);
                        }
                    };
                    
                    animateCamera();
                }
            }
        }
        
        this.currentPreset = partName;
    }
    
    resetPartPreset() {
        // Just reset the preset state, no opacity changes needed
        this.currentPreset = null;
    }

    setDefaultViewFromCamera() {
        if (!this.camera || !this.controls) return;
        this.defaultCameraPosition = this.camera.position.clone();
        this.defaultControlsTarget = this.controls.target.clone();
    }

    resetToDefaultView() {
        if (!this.camera || !this.controls || !this.defaultCameraPosition || !this.defaultControlsTarget) return;

        const startPosition = this.camera.position.clone();
        const startTarget = this.controls.target.clone();
        const endPosition = this.defaultCameraPosition.clone();
        const endTarget = this.defaultControlsTarget.clone();
        const startTime = performance.now();
        const duration = 1000;

        this.closeIndicator();
        this.selectedObject = null;
        this.selectedIntersectionPoint = null;

        const animateCamera = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeProgress = 1 - Math.pow(1 - progress, 3);

            this.camera.position.lerpVectors(startPosition, endPosition, easeProgress);
            this.controls.target.lerpVectors(startTarget, endTarget, easeProgress);
            this.controls.update();

            if (progress < 1) {
                requestAnimationFrame(animateCamera);
            }
        };

        animateCamera();
    }

    updateIndicatorPosition() {
        if (!this.selectedObject || !this.selectedIntersectionPoint) return;
        
        const object = this.selectedObject;
        const overlay = document.getElementById('indicator-overlay');
        
        // Transform local intersection point to current world space
        const worldIntersection = this.selectedIntersectionPoint.clone();
        object.localToWorld(worldIntersection);
        
        // Calculate offset in world space (upward from intersection point)
        const boundingBox = new THREE.Box3().setFromObject(object);
        const size = boundingBox.getSize(new THREE.Vector3());
        
        // For solar arrays, use a smaller offset to keep popup closer to the panel
        const partInfo = object.userData.partInfo || this.partData.get(object.uuid);
        const isSolarArray = partInfo && partInfo.name && partInfo.name.toLowerCase().includes('solar');
        
        let offsetY;
        if (isSolarArray) {
            // For solar arrays, keep the popup closer to the panel surface
            const minDim = Math.min(size.x, size.y, size.z);
            offsetY = Math.max(minDim * 0.2, 0.1);
        } else {
            offsetY = Math.max(size.y * 0.5, 0.5);
        }
        
        // Create a point above the intersection (initial estimate)
        const popupPosition = worldIntersection.clone();
        popupPosition.y += offsetY;
        
        // Convert 3D world position to screen coordinates (relative to canvas)
        const vector = popupPosition.project(this.camera);
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = rect.left + (vector.x * 0.5 + 0.5) * rect.width;
        const y = rect.top + (-vector.y * 0.5 + 0.5) * rect.height;
        
        // DEBUG: Log position calculations
        console.log('=== UPDATE INDICATOR POSITION DEBUG ===');
        console.log('World Intersection:', {
            x: worldIntersection.x.toFixed(3),
            y: worldIntersection.y.toFixed(3),
            z: worldIntersection.z.toFixed(3)
        });
        console.log('Popup Position (World):', {
            x: popupPosition.x.toFixed(3),
            y: popupPosition.y.toFixed(3),
            z: popupPosition.z.toFixed(3)
        });
        console.log('Projected Vector:', {
            x: vector.x.toFixed(3),
            y: vector.y.toFixed(3),
            z: vector.z.toFixed(3)
        });
        console.log('Screen Coordinates:', { x: x.toFixed(1), y: y.toFixed(1) });
        console.log('Canvas Size:', { width: rect.width, height: rect.height });
        console.log('Offset Y:', offsetY.toFixed(3));
        console.log('Is Solar Array:', isSolarArray);
        
        // Position the overlay above the intersection point
        // For solar arrays, bias the popup toward the upper-left area (near the left panels)
        let desiredLeft = x;
        let desiredTop = y - 10;
        if (isSolarArray && this.satellite) {
            // Place popup at the top of the overall model
            const satelliteBox = new THREE.Box3().setFromObject(this.satellite);
            if (!satelliteBox.isEmpty()) {
                const topCenter = satelliteBox.getCenter(new THREE.Vector3());
                topCenter.y = satelliteBox.max.y;
                const topVector = topCenter.clone().project(this.camera);
                const topX = rect.left + (topVector.x * 0.5 + 0.5) * rect.width;
                const topY = rect.top + (-topVector.y * 0.5 + 0.5) * rect.height;
                desiredLeft = topX;
                desiredTop = topY - 10;
            }
            overlay.style.transform = 'translate(-50%, -100%)';
        } else {
            overlay.style.transform = 'translate(-50%, -100%)';
        }
        overlay.style.position = 'fixed';
        overlay.style.left = desiredLeft + 'px';
        overlay.style.top = desiredTop + 'px';

        // Clamp the popup to the viewport so it stays visible
        let popupRect = overlay.getBoundingClientRect();
        const padding = 12;
        const minLeft = padding + popupRect.width / 2;
        const maxLeft = window.innerWidth - padding - popupRect.width / 2;
        const minTop = padding + 40; // keep below top buttons
        const maxTop = window.innerHeight - padding - popupRect.height;
        const clampedLeft = Math.min(Math.max(desiredLeft, minLeft), maxLeft);
        const clampedTop = Math.min(Math.max(desiredTop, minTop), maxTop);
        if (clampedLeft !== desiredLeft || clampedTop !== desiredTop) {
            overlay.style.left = clampedLeft + 'px';
            overlay.style.top = clampedTop + 'px';
            popupRect = overlay.getBoundingClientRect();
        }

        // Calculate the bottom center of the popup box in screen space
        const popupBottomX = popupRect.left + popupRect.width / 2;
        const popupBottomY = popupRect.bottom;
        
        // DEBUG: Log popup rect
        console.log('Popup Rect:', {
            left: popupRect.left.toFixed(1),
            top: popupRect.top.toFixed(1),
            right: popupRect.right.toFixed(1),
            bottom: popupRect.bottom.toFixed(1),
            width: popupRect.width.toFixed(1),
            height: popupRect.height.toFixed(1)
        });
        console.log('Popup Bottom Center:', {
            x: popupBottomX.toFixed(1),
            y: popupBottomY.toFixed(1)
        });
        
        // Convert screen coordinates to normalized device coordinates relative to canvas
        const ndcX = ((popupBottomX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -(((popupBottomY - rect.top) / rect.height) * 2 - 1);
        
        // Create a raycaster to find the 3D position at the bottom of the popup
        const tempRaycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2(ndcX, ndcY);
        tempRaycaster.setFromCamera(mouse, this.camera);
        
        // Find point at the same distance from camera as the original popupPosition
        const distance = popupPosition.distanceTo(this.camera.position);
        const popup3DPosition = this.camera.position.clone();
        popup3DPosition.add(tempRaycaster.ray.direction.clone().multiplyScalar(distance));
        
        // DEBUG: Log final 3D positions
        console.log('Popup 3D Position:', {
            x: popup3DPosition.x.toFixed(3),
            y: popup3DPosition.y.toFixed(3),
            z: popup3DPosition.z.toFixed(3)
        });
        console.log('Distance from camera:', distance.toFixed(3));
        
        if (!this.indicatorLineReady) {
            // Hide line/marker until panel is shown
            if (this.connectionLine) {
                this.scene.remove(this.connectionLine);
                this.connectionLine.geometry.dispose();
                this.connectionLine.material.dispose();
                this.connectionLine = null;
            }
            if (this.connectionMarker) {
                this.scene.remove(this.connectionMarker);
                this.connectionMarker.geometry.dispose();
                this.connectionMarker.material.dispose();
                this.connectionMarker = null;
            }
            return;
        }

        if (isSolarArray) {
            // Hide indicator line for Solar Arrays
            if (this.connectionLine) {
                this.scene.remove(this.connectionLine);
                this.connectionLine.geometry.dispose();
                this.connectionLine.material.dispose();
                this.connectionLine = null;
            }
            if (this.connectionMarker) {
                this.scene.remove(this.connectionMarker);
                this.connectionMarker.geometry.dispose();
                this.connectionMarker.material.dispose();
                this.connectionMarker = null;
            }
        } else {
            // Update the connection line to attach to the bottom of the popup box
            this.updateConnectionLine(worldIntersection, popup3DPosition);
            
            // Update the marker position at the start of the line
            this.updateConnectionMarker(worldIntersection);
        }
    }

    updateConnectionLine(startPoint, endPoint, shortenFactor = 1.0) {
        // Shorten the line based on factor (1.0 = full length)
        const shortenedEnd = startPoint.clone().lerp(endPoint, shortenFactor);
        if (!this.connectionLine) {
            // Create line if it doesn't exist
            this.createConnectionLine(startPoint, shortenedEnd);
        } else {
            // Update existing line geometry
            const positions = this.connectionLine.geometry.attributes.position;
            positions.setXYZ(0, startPoint.x, startPoint.y, startPoint.z);
            positions.setXYZ(1, shortenedEnd.x, shortenedEnd.y, shortenedEnd.z);
            positions.needsUpdate = true;
        }
    }

    updateConnectionMarker(position) {
        if (!this.connectionMarker) {
            // Create marker if it doesn't exist
            this.createConnectionMarker(position);
        } else {
            // Update existing marker position
            this.connectionMarker.position.copy(position);
        }
    }

    createConnectionMarker(position) {
        // Create a small sphere to mark the point
        const geometry = new THREE.SphereGeometry(0.05, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0x4a9eff,
            transparent: true,
            opacity: 0.9,
            depthTest: false, // Always render on top
            depthWrite: false // Don't write to depth buffer
        });
        
        this.connectionMarker = new THREE.Mesh(geometry, material);
        this.connectionMarker.position.copy(position);
        this.connectionMarker.renderOrder = 999; // Render last (on top)
        this.scene.add(this.connectionMarker);
    }

    formatPartName(name) {
        if (!name) return name;
        
        // Replace underscores and hyphens with spaces
        let formatted = name.replace(/[_-]/g, ' ');
        
        // Remove duplicate spaces
        formatted = formatted.replace(/\s+/g, ' ').trim();
        
        // Replace "Panel" with "Solar Arrays" (case-insensitive)
        formatted = formatted.replace(/\bpanel\b/gi, 'Solar Arrays');
        
        // Replace "HEAT Shield" with "Crew Module" (case-insensitive)
        formatted = formatted.replace(/\bheat\s+shield\b/gi, 'Crew Module');
        
        // Replace "MID12 White" with "Crew Module Adapter" (case-insensitive)
        formatted = formatted.replace(/\bmid12\s+white\b/gi, 'Crew Module Adapter');
        
        // Replace "MID02 White" with "EUROPEAN SERVICE MODULE" (case-insensitive)
        formatted = formatted.replace(/\bmid02\s+white\b/gi, 'EUROPEAN SERVICE MODULE');
        
        // Replace "MID17 White" with "EUROPEAN SERVICE MODULE" (case-insensitive)
        formatted = formatted.replace(/\bmid17\s+white\b/gi, 'EUROPEAN SERVICE MODULE');
        
        // Replace "MID White" with "Crew Module Adapter" (case-insensitive)
        formatted = formatted.replace(/\bmid\s+white\b/gi, 'Crew Module Adapter');
        
        // Replace "Exhaust01 Exhaust" with "Exhaust" (case-insensitive)
        formatted = formatted.replace(/\bexhaust01\s+exhaust\b/gi, 'Exhaust');
        
        // Replace "Exhaust02" with "Exhaust" (case-insensitive)
        formatted = formatted.replace(/\bexhaust02\b/gi, 'Exhaust');
        
        // Replace "Exhaust01" with "Exhaust" (case-insensitive)
        formatted = formatted.replace(/\bexhaust01\b/gi, 'Exhaust');
        
        // Replace "Exhaust Metal" with "Exhaust" (case-insensitive)
        formatted = formatted.replace(/\bexhaust\s+metal\b/gi, 'Exhaust');
        
        // Replace "Exhaust UV" with "Exhaust" (case-insensitive)
        formatted = formatted.replace(/\bexhaust\s+uv\b/gi, 'Exhaust');
        
        // Remove any trailing numbers or extra text after "Exhaust"
        formatted = formatted.replace(/\bexhaust\s*\d+\s*.*$/gi, 'Exhaust');
        
        // Handle specific patterns like "HEAT_Shield-Heat_Shield_Metal_UV" -> "HEAT SHIELD"
        // Remove duplicate words (case-insensitive) and keep only first two significant words
        const words = formatted.split(' ');
        const uniqueWords = [];
        const seen = new Set();
        
        for (const word of words) {
            const lowerWord = word.toLowerCase();
            // Skip common suffixes like "UV", "Metal" if they appear after the main name
            if (!seen.has(lowerWord) && (uniqueWords.length < 2 || !['uv', 'metal', 'texture', 'material'].includes(lowerWord))) {
                seen.add(lowerWord);
                uniqueWords.push(word);
            }
        }
        
        // Keep only first two words for cleaner display
        formatted = uniqueWords.slice(0, 2).join(' ');
        
        return formatted;
    }

    createConnectionLine(startPoint, endPoint) {
        // Remove existing line if it exists
        if (this.connectionLine) {
            this.scene.remove(this.connectionLine);
            this.connectionLine.geometry.dispose();
            this.connectionLine.material.dispose();
        }
        
        // Create line geometry
        const points = [startPoint, endPoint];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        
        // Create line material
        const material = new THREE.LineBasicMaterial({
            color: 0x4a9eff,
            linewidth: 2,
            transparent: true,
            opacity: 0.9,
            depthTest: false, // Always render on top
            depthWrite: false, // Don't write to depth buffer
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
        });
        
        // Create the line
        this.connectionLine = new THREE.Line(geometry, material);
        this.connectionLine.renderOrder = 9999; // Render last (on top) - higher value
        this.connectionLine.frustumCulled = false; // Always render
        this.scene.add(this.connectionLine);
    }

    closeIndicator() {
        this.selectedPart = null;
        this.selectedObject = null;
        this.selectedIntersectionPoint = null;
        this.lastIntersectionPoint = null;
        this.indicatorLineReady = true;
        
        // Remove connection line
        if (this.connectionLine) {
            this.scene.remove(this.connectionLine);
            this.connectionLine.geometry.dispose();
            this.connectionLine.material.dispose();
            this.connectionLine = null;
        }
        
        // Remove connection marker
        if (this.connectionMarker) {
            this.scene.remove(this.connectionMarker);
            this.connectionMarker.geometry.dispose();
            this.connectionMarker.material.dispose();
            this.connectionMarker = null;
        }
        
        const overlay = document.getElementById('indicator-overlay');
        overlay.classList.add('hidden');
        
        // Resume rotation when indicator is closed
        this.isRotationPaused = false;
    }

    fadeOutIndicator() {
        const overlay = document.getElementById('indicator-overlay');
        if (!overlay || overlay.classList.contains('hidden')) {
            return false;
        }
        overlay.classList.add('hidden');
        // Clean up line/marker after fade completes
        setTimeout(() => {
            if (overlay.classList.contains('hidden')) {
                if (this.connectionLine) {
                    this.scene.remove(this.connectionLine);
                    this.connectionLine.geometry.dispose();
                    this.connectionLine.material.dispose();
                    this.connectionLine = null;
                }
                if (this.connectionMarker) {
                    this.scene.remove(this.connectionMarker);
                    this.connectionMarker.geometry.dispose();
                    this.connectionMarker.material.dispose();
                    this.connectionMarker = null;
                }
            }
        }, 320);
        return true;
    }

    onWindowResize() {
        const containerWidth = this.container ? this.container.clientWidth : window.innerWidth;
        const containerHeight = this.container ? this.container.clientHeight : window.innerHeight;
        this.camera.aspect = containerWidth / containerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(containerWidth, containerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Calculate delta time for frame-rate independent animation
        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastFrameTime) / 1000; // Convert to seconds
        this.lastFrameTime = currentTime;
        
        // Update controls
        this.controls.update();
        
        // Oscillate rotation between -45 and +45 degrees (90 degrees total)
        if (!this.isRotationPaused) {
            // Increment time for oscillation (completes one cycle every 80 seconds - 10x slower)
            this.rotationTime += deltaTime;
            const cycleDuration = 80; // seconds for full oscillation (10x slower than before)
            const oscillation = Math.sin((this.rotationTime / cycleDuration) * Math.PI * 2);
            
            // Convert to -45 to +45 degrees (in radians: -PI/4 to +PI/4)
            const rotationAngle = oscillation * (Math.PI / 4); // 45 degrees in radians
            
            // Rotate satellite (oscillate between -45 and +45 degrees)
            if (this.satellite) {
                this.satellite.rotation.y = rotationAngle;
            }
            
            // Oscillate lights side by side (preserve Y position)
            if (this.directionalLight && this.initialLightPositions.directional) {
                const initial = this.initialLightPositions.directional;
                const radius = Math.sqrt(initial.x ** 2 + initial.z ** 2);
                const baseAngle = Math.atan2(initial.z, initial.x);
                const newAngle = baseAngle + rotationAngle;
                this.directionalLight.position.x = Math.cos(newAngle) * radius;
                this.directionalLight.position.z = Math.sin(newAngle) * radius;
                this.directionalLight.position.y = initial.y;
            }
            
            if (this.fillLight && this.initialLightPositions.fill) {
                const initial = this.initialLightPositions.fill;
                const radius = Math.sqrt(initial.x ** 2 + initial.z ** 2);
                const baseAngle = Math.atan2(initial.z, initial.x);
                const newAngle = baseAngle + rotationAngle;
                this.fillLight.position.x = Math.cos(newAngle) * radius;
                this.fillLight.position.z = Math.sin(newAngle) * radius;
                this.fillLight.position.y = initial.y;
            }
            
            if (this.pointLight && this.initialLightPositions.point) {
                const initial = this.initialLightPositions.point;
                const radius = Math.sqrt(initial.x ** 2 + initial.z ** 2);
                const baseAngle = Math.atan2(initial.z, initial.x);
                const newAngle = baseAngle + rotationAngle;
                this.pointLight.position.x = Math.cos(newAngle) * radius;
                this.pointLight.position.z = Math.sin(newAngle) * radius;
                this.pointLight.position.y = initial.y;
            }
        }
        
        // Update indicator position in real-time if it's visible
        if (this.selectedObject && !document.getElementById('indicator-overlay').classList.contains('hidden')) {
            this.updateIndicatorPosition();
        }
        
        // Render
        this.renderer.render(this.scene, this.camera);

        // Update camera debug overlay
        this.updateCameraDebug();
    }

    updateCameraDebug() {
        if (!this.cameraDebugContent || !this.camera || !this.controls) return;

        const camPos = this.camera.position;
        const camRot = this.camera.rotation;
        const camDir = new THREE.Vector3();
        this.camera.getWorldDirection(camDir);
        const target = this.controls.target;
        const distance = camPos.distanceTo(target);

        this.cameraDebugContent.textContent =
            `Pos: (${camPos.x.toFixed(2)}, ${camPos.y.toFixed(2)}, ${camPos.z.toFixed(2)})\n` +
            `Rot: (${THREE.MathUtils.radToDeg(camRot.x).toFixed(1)}°, ${THREE.MathUtils.radToDeg(camRot.y).toFixed(1)}°, ${THREE.MathUtils.radToDeg(camRot.z).toFixed(1)}°)\n` +
            `Dir: (${camDir.x.toFixed(2)}, ${camDir.y.toFixed(2)}, ${camDir.z.toFixed(2)})\n` +
            `Target: (${target.x.toFixed(2)}, ${target.y.toFixed(2)}, ${target.z.toFixed(2)})\n` +
            `Distance: ${distance.toFixed(2)}`;
    }
}

// Initialize the viewer when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new SatelliteViewer();
});

