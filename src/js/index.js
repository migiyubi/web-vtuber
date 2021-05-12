import 'css/main.css';

import Human from './libs/human.esm.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { VRM, VRMSchema } from '@pixiv/three-vrm';

class ModelRenderer {
    constructor(canvas, resolution={ width: 640, height: 360 }) {
        this._renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
        this._renderer.setPixelRatio(window.devicePixelRatio);

        this._scene = new THREE.Scene();

        this._camera = new THREE.PerspectiveCamera(30, resolution.width/resolution.height, 0.1, 100);
        this._camera.position.set(0, 1.45, -0.77);
        this._camera.lookAt(new THREE.Vector3(0, 1.45, 0));

        this._light = new THREE.DirectionalLight(0xffffff, 0.8);
        this._light.position.set(1, 1, -1);
        this._scene.add(this._light);

        this._ambient = new THREE.AmbientLight(0xffffff, 0.2);
        this._scene.add(this._ambient);

        this._container = new THREE.Group();
        this._scene.add(this._container);

        this._clock = new THREE.Clock();

        this._avatar = null;

        this._nextBlinkTime = 0.0;

        this._morphNameMap = {
            happy: VRMSchema.BlendShapePresetName.Fun,
            angry: VRMSchema.BlendShapePresetName.Angry,
            sad: VRMSchema.BlendShapePresetName.Sorrow,
            neutral: VRMSchema.BlendShapePresetName.Neutral
        };

        this._curr = {
            position: new THREE.Vector3(0, 0, 0),
            rotation: new THREE.Quaternion()
        };
        this._dest = {
            position: new THREE.Vector3(0, 0, 0),
            rotation: new THREE.Quaternion()
        };

        this._euler = new THREE.Euler();
        this._rotationHead = new THREE.Quaternion();
        this._rotationNeck = new THREE.Quaternion();

        window.addEventListener('resize', this.onResize.bind(this));

        this.onResize();
    }

    onResize() {
        const w = Math.min(window.innerWidth, 640);
        const h = w * 9 / 16 | 0;
        this._renderer.setSize(w, h);
    }

    init(vrmFilepath, adjust, onLoad) {
        const loader = new GLTFLoader();
        loader.load(vrmFilepath,
            (gltf) => {
                VRM.from(gltf).then((vrm) => {
                    this._avatar = vrm;
                    this._scene.add(vrm.scene);

                    this._head = vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.Head);
                    this._neck = vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.Neck);
                    this._chest = vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.Chest);
  
                    this._avatar.lookAt.target = this._camera;

                    if (adjust !== undefined) {
                        adjust(vrm);
                    }

                    if (onLoad !== undefined) {
                        onLoad();
                    }
                });
            },
            (xhr) => {
                // do nothing.
            },
            (err) => {
                console.error(err);
            }
        );
    }

    render(face) {
        const c = this._camera;
        const curr = this._curr;
        const dest = this._dest;
        const p = dest.position;
        const r = dest.rotation;

        let mouth;
        let emotion;

        if (face !== null) {
            const a = face.rotation.angle;
            const b = face.boxRaw;
            const m = face.meshRaw;

            // position.
            p.set(2.0*b[0]+b[2]-1.0, -2.0*b[1]-b[3]+1.0, 0.5);
            p.unproject(c);
            p.sub(c.position).normalize();
            const d = -c.position.z / p.z;
            p.multiplyScalar(d);
            p.add(c.position);

            // rotation.
            this._euler.set(-0.5*a.pitch, -0.5*a.yaw, 0.5*a.roll);
            r.setFromEuler(this._euler);

            // mouth.
            mouth = Math.min(Math.max(100.0 * (m[14][1] - m[13][1]) - 1.0, 0.0), 1.0);

            // emotion.
            emotion = (face.emotion.length > 0) && (face.emotion[0].score > 0.7) ? face.emotion[0].emotion : 'neutral';
        }

        // easing.
        const coef = 0.2;
        curr.position.lerp(p, coef);
        curr.rotation.slerp(r, coef);
        this._rotationHead.set(0, 0, 0, 1).slerp(curr.rotation, 0.5);
        this._rotationNeck.set(0, 0, 0, 1).slerp(curr.rotation, 0.5);

        if (this._avatar !== null) {
            const chestRotCoef = 1.0;

            this._head.quaternion.copy(this._rotationHead);
            this._head.rotation.z += 0.5 * chestRotCoef * curr.position.x;

            this._neck.quaternion.copy(this._rotationNeck);
            this._neck.rotation.z += 0.5 * chestRotCoef * curr.position.x;

            this._chest.rotation.set(0, 0, -chestRotCoef * curr.position.x);

            this._avatar.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.A, mouth);

            const dt = this._clock.getDelta();
            const t = this._clock.getElapsedTime();
            if (this._nextBlinkTime - t < 0.0) {
                this._nextBlinkTime = t + 3.0 + 4.0 * Math.random();
            }
            const blink = 1.0 - Math.min(Math.abs(15.0 * (this._nextBlinkTime - t) - 1.0), 1.0);
            this._avatar.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.Blink, blink);

            const morphName = (this._morphNameMap[emotion] !== undefined) ? this._morphNameMap[emotion] : this._morphNameMap['neutral'];
            for (const n of Object.values(this._morphNameMap)) {
                this._avatar.blendShapeProxy.setValue(n, 0.0);
            }
            this._avatar.blendShapeProxy.setValue(morphName, 0.7);

            this._avatar.update(dt);
        }

        this._renderer.render(this._scene, c);
    }
}

class FaceDetector {
    constructor(canvas, resolution) {
        this._canvas = canvas;
        this._resolution = resolution;
    }

    async init(modelBasePath) {
        const config = {
            debug: false,
            backend: 'webgl',
            modelBasePath: modelBasePath,
            filter: {
                enabled: true,
                width: this._resolution.width,
                height: this._resolution.height,
                brightness: -0.2,
                contrast: 0.5,
                return: true
            },
            face: {
                enabled: true,
                detector: {
                    enabled: true,
                    maxDetected: 1
                },
                emotion: { enabled: true },
                iris: { enabled: false }
            },
            body: { enabled: false },
            gesture: { enabled: false },
            hand: { enabled: false },
            object: { enabled: false }
        }

        this._human = new Human(config);
    }

    async update(video) {
        const h = this._human;
        const c = this._canvas;

        const result = await h.detect(video);

        c.getContext('2d').drawImage(result.canvas, 0, 0);

        if (result.face.length <= 0) {
            return null;
        }

        h.draw.face(c, result.face, {
            drawLabels: false,
            // workaround: `drawLabels` doesn't work.
            labelColor: 'rgba(0, 0, 0, 0.0)',
            shadowColor: 'rgba(0, 0, 0, 0.0)'
        });

        return result.face[0];
    }
}

class App {
    constructor(resolution) {
        this._video = document.createElement('video');
        this._canvasInput = document.querySelector('#canvas-input');
        this._canvasOutput = document.querySelector('#canvas-output');

        this._detector = new FaceDetector(this._canvasInput, resolution);
        this._renderer = new ModelRenderer(this._canvasOutput);

        this._resolution = resolution;
    }

    async init() {
        try {
            await this.openCamera(this._resolution, this._video);
        }
        catch (e) {
            alert('Failed to connect to the camera service.\nPlease make sure that other applications are not using the camera.');
            return;
        }

        this._renderer.init(
            'https://raw.githubusercontent.com/migiyubi/web-vtuber/master/models/jinbot.vrm',
            (vrm) => {
                vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftUpperArm).rotation.z = 1.0;
                vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightUpperArm).rotation.z = -1.0;
            },
            () => {
                document.querySelector('#image-load').style.display = 'none';
            }
        );

        this._canvasInput.width = this._resolution.width;
        this._canvasInput.height = this._resolution.height;

        await this._detector.init(
            'https://raw.githubusercontent.com/migiyubi/web-vtuber/master/weights'
        );
    }

    start() {
        this._video.play();
        this.loop();
    }

    async loop() {
        await this.update();

        requestAnimationFrame(this.loop.bind(this));
    }

    async update() {
        const face = await this._detector.update(this._video);

        this._renderer.render(face);
    }

    async openCamera(resolution, domElement=document.createElement('video')) {
        return new Promise((resolve, reject) => {
            navigator.mediaDevices.getUserMedia({
                video: resolution,
                audio: false,
            }).then((stream) => {
                domElement.srcObject = stream;
                resolve(domElement);
            }).catch((e) => {
                reject(e);
            });
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('#image-load').style.display = 'none';

    const onClickButton = async () => {
        document.querySelector('#button-start').style.display = 'none';
        document.querySelector('#text-attention').style.display = 'none';
        document.querySelector('#image-load').style.display = 'block';

        const resolution = { width: 224, height: 224 };

        const app = new App(resolution);
        await app.init();
        app.start();
    }

    document.querySelector('#button-start').addEventListener('click', (e) => {
        onClickButton();
    });
});
