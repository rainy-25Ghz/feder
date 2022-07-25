import * as d3 from 'd3';
import { renderLoading, finishLoading } from './loading';
import * as THREE from 'three';
import { OrbitControls } from './jsm/controls/OrbitControls';
import { HNSW_LINK_TYPE, HNSW_NODE_TYPE } from 'Types';
import { GLTFExporter } from './jsm/exporters/GLTFExporter';
import { SphereGeometry } from 'three';
import { RenderPass } from './jsm/postprocessing/RenderPass';
import { EffectComposer } from './jsm/postprocessing/EffectComposer';
import { ShaderPass } from './jsm/postprocessing/ShaderPass';
import { UnrealBloomPass } from './jsm/postprocessing/UnrealBloomPass';
import { PinchGesture } from '@use-gesture/vanilla';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// import { VIEW_TYPE } from 'Types';

export default class BaseView {
  constructor({ viewParams, getVectorById }) {
    this.viewParams = viewParams;

    const { width, height, canvasScale, mediaType, mediaCallback } = viewParams;
    this.clientWidth = width;
    this.width = width * canvasScale;
    this.clientHeight = height;
    this.height = height * canvasScale;
    this.getVectorById = getVectorById;
    this.canvasScale = canvasScale;
    this.mediaType = mediaType;
    this.mediaCallback = mediaCallback;
  }

  // override
  initInfoPanel() {}
  renderOverview() {}
  renderSearchView() {}
  searchViewHandler() {}
  getOverviewEventHandler() {}
  getSearchViewEventHandler() {}

  async overview(dom) {
    const canvas = initCanvas(
      dom,
      this.clientWidth,
      this.clientHeight,
      this.canvasScale
    );
    const ctx = canvas.getContext('2d');
    const infoPanel = this.initInfoPanel(dom);

    this.overviewLayoutPromise && (await this.overviewLayoutPromise);
    finishLoading(dom);
    this.renderOverview(ctx, infoPanel);
    const eventHandlers = this.getOverviewEventHandler(ctx, infoPanel);
    addMouseListener(canvas, this.canvasScale, eventHandlers);
  }

  async search(dom, { searchRes, targetMediaUrl }) {
    //create a canvas
    const canvas = document.createElement('canvas');
    canvas.width = this.clientWidth;
    canvas.height = this.clientHeight;
    dom.appendChild(canvas);

    const searchViewLayoutData = await this.searchViewHandler(searchRes);
    console.log(searchViewLayoutData);

    //setup info panel
    const infoPanel = document.createElement('div');
    //set white font color
    infoPanel.style.color = '#fff';

    const setup3d = () => {
      const scene = new THREE.Scene();
      let id2sphereIdx = new Map();

      //setup the orthographic camera
      let camera = new THREE.OrthographicCamera(
        canvas.clientWidth,
        canvas.clientWidth * -1,
        canvas.clientHeight,
        canvas.clientHeight * -1,
        -4000,
        4000
      );
      camera.position.z = -10;
      camera.position.y = 1;
      camera.lookAt(scene.position);

      //setup the renderer
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      // renderer.setClearColor(0xffffff, 1);

      const setupLights = () => {
        //setup the directional light
        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(1, 1, 1);
        scene.add(light);
        //setup ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
        scene.add(ambientLight);
      };
      setupLights();

      let spheres = [];
      let entryPts = [];
      let finePts = [];
      let maxX = 0,
        maxY = 0,
        minX = 0,
        minY = 0;
      const setupSpheres = () => {
        let z0 = 0;
        let count = 0;
        for (let i = searchViewLayoutData.visData.length - 1; i >= 0; i--) {
          const { entryIds, fineIds, links, nodes } =
            searchViewLayoutData.visData[i];
          const { id2forcePos } = searchViewLayoutData;

          entryPts.unshift([
            new THREE.Vector3(
              id2forcePos[entryIds[0]][0],
              z0,
              id2forcePos[entryIds[0]][1]
            ),
            entryIds[0],
          ]);
          finePts.unshift([
            new THREE.Vector3(
              id2forcePos[fineIds[0]][0],
              z0,
              id2forcePos[fineIds[0]][1]
            ),
            fineIds[0],
          ]);

          for (let j = 0; j < nodes.length; j++) {
            const node = nodes[j];
            const { id, x, y, type } = node;
            let color = new THREE.Color(),
              opacity = 1;
            if (type === HNSW_NODE_TYPE.Coarse) {
              color.setHex(0x333344);
            } else if (type === HNSW_NODE_TYPE.Candidate) {
              color.setHex(0xaa00ff);
            } else if (type === HNSW_NODE_TYPE.Fine) {
              color.setHex(0x00bc00);
            } else if (type === HNSW_NODE_TYPE.Target) {
              color.setHex(0xee0000);
            }
            const geometry = new THREE.SphereGeometry(20, 32, 32);
            const material = new THREE.MeshPhongMaterial({
              color,
              transparent: true,
              opacity,
              flatShading: true,
            });
            const sphere = new THREE.Mesh(geometry, material);
            sphere.hnswData = node;
            sphere.position.set(x, z0, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            spheres.push(sphere);
            sphere.name = `layer_${i}_node_${j}`;
            id2sphereIdx.set(`layer_${i}_nodeId_${node.id}`, count);
            count++;
          }
          z0 += -400;
        }
      };
      setupSpheres();

      let planes = [];
      const setupPlanes = () => {
        let z0 = -30;
        for (let i = searchViewLayoutData.visData.length - 1; i >= 0; i--) {
          const planeGeometry = new THREE.PlaneGeometry(
            maxX - minX,
            maxY - minY,
            1,
            1
          );
          const planeMaterial = new THREE.MeshBasicMaterial({
            color: 0x0055ff,
            side: THREE.DoubleSide,
            opacity: 0.2,
            transparent: true,
            depthWrite: false,
          });
          const plane = new THREE.Mesh(planeGeometry, planeMaterial);
          plane.position.set(maxX / 2 + minX / 2, z0, maxY / 2 + minY / 2);
          plane.rotateX(Math.PI / 2);
          z0 += -400;
          plane.name = `layer_${i}_plane`;
          planes.push(plane);
        }
      };

      setupPlanes();

      let lines = [];
      const setupLines = () => {
        let z0 = 0;
        console.log(entryPts, finePts);
        for (let i = searchViewLayoutData.visData.length - 1; i >= 0; i--) {
          const { links } = searchViewLayoutData.visData[i];
          for (let j = 0; j < links.length; j++) {
            const link = links[j];
            const { source, target } = link;
            //create points array
            const points = [];
            points.push(new THREE.Vector3(source.x, z0, source.y));
            points.push(new THREE.Vector3(target.x, z0, target.y));
            const lineGeometry = new THREE.BufferGeometry().setFromPoints(
              points
            );
            let color = new THREE.Color(),
              opacity = 1.0;

            if (link.type === HNSW_LINK_TYPE.Fine) {
              color = color.setHex(0xee8484);
            } else if (link.type === HNSW_LINK_TYPE.Searched) {
              color.setHex(0x80bc7a);
            } else if (link.type === HNSW_LINK_TYPE.Extended) {
              color.setHex(0x4477ff);

              opacity = 0.5;
            } else if (link.type === HNSW_LINK_TYPE.Visited) {
              color.setHex(0x000000);
              opacity = 0;
            }

            //create a new material
            const material = new THREE.LineBasicMaterial({
              color,
              opacity,
              linewidth: 2,
              transparent: true,
              depthWrite: true,
            });
            //create a new line
            const line = new THREE.Line(lineGeometry, material);
            line.name = `layer_${i}_link_${j}`;
            let sourceId = source.nodeId;
            let targetId = target.nodeId;
            if (sourceId && targetId) {
              line.sourceId = sourceId;
              line.targetId = targetId;
            }

            if (opacity > 0) lines.push(line);
          }
          if (i > 0) {
            const sourceId = finePts[i][1];
            const targetId = entryPts[i - 1][1];

            const finePt = finePts[i][0];
            const entryPt = entryPts[i - 1][0];
            const lineGeometry = new THREE.BufferGeometry().setFromPoints([
              entryPt,
              finePt,
            ]);
            const material = new THREE.LineBasicMaterial({
              color: new THREE.Color(0xeeee00),
            });
            const line = new THREE.Line(lineGeometry, material);
            line.name = `layer_${i}_link_up`;
            if (sourceId && targetId) {
              line.sourceId = sourceId;
              line.targetId = targetId;
              console.log(sourceId, targetId);
            }
            lines.push(line);
          }
          z0 += -400;
        }
      };
      setupLines();

      scene.add(...spheres);
      scene.add(...planes);
      scene.add(...lines);

      /**
       *
       * @param {number} searchSteps
       */
      const jump = (searchSteps) => {
        //hide lines and sheres
        lines.forEach((line) => {
          line.visible = false;
        });
        spheres.forEach((sphere) => {
          sphere.visible = false;
        });
        for (let i = 0; i < searchSteps; i++) {
          const line = lines[i];
          line.visible = true;
          const name = line.name;
          const layerIdx = parseInt(name.split('_')[1]);
          const { targetId, sourceId } = line;
          const keyTarget = `layer_${layerIdx}_nodeId_${targetId}`;
          const sphereIdxTarget = id2sphereIdx.get(keyTarget);
          if (sphereIdxTarget !== undefined) {
            const sphere = spheres[sphereIdxTarget];
            sphere.visible = true;
          }
          const keySource = `layer_${layerIdx}_nodeId_${sourceId}`;
          const sphereIdxSource = id2sphereIdx.get(keySource);
          if (sphereIdxSource !== undefined) {
            const sphere = spheres[sphereIdxSource];
            sphere.visible = true;
          }
        }
      };

      const composer = new EffectComposer(renderer);
      const setupPostProcessing = () => {
        const renderPass = new RenderPass(scene, camera);
        renderPass.clearColor = new THREE.Color(0x000000);
        // renderPass.clearAlpha = 0;
        composer.addPass(renderPass);
        // composer.addPass();

        const bloomPass = new UnrealBloomPass(
          new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
          1.5,
          0.7,
          0.5
        );
        composer.addPass(bloomPass);
      };
      setupPostProcessing();

      //pick
      //gpu picking
      const pickingScene = new THREE.Scene();
      const pickingRenderer = new THREE.WebGLRenderTarget(
        canvas.clientWidth,
        canvas.clientHeight
      );
      pickingScene.background = new THREE.Color(0xffffff);

      let pickingObjects = [];
      const pickingMaterial = new THREE.MeshBasicMaterial({
        vertexColors: true,
      });
      const setupPickingObjects = () => {
        for (let i = 0; i < spheres.length; i++) {
          const sphere = spheres[i];
          //get geometry of the sphere
          const geometry = sphere.geometry.clone();
          const color = new THREE.Color();
          applyVertexColors(geometry, color.setHex(i));
          const mesh = new THREE.Mesh(geometry, pickingMaterial);
          mesh.position.set(
            sphere.position.x,
            sphere.position.y,
            sphere.position.z
          );
          mesh.name = sphere.name;
          pickingObjects.push(mesh);
          pickingScene.add(mesh);
        }
        for (let i = spheres.length; i < planes.length + spheres.length; i++) {
          const plane = planes[i - spheres.length];
          //get geometry of the plane
          const geometry = plane.geometry.clone();
          const color = new THREE.Color();
          applyVertexColors(geometry, color.setHex(i));
          const mesh = new THREE.Mesh(geometry, pickingMaterial);
          mesh.position.set(
            plane.position.x,
            plane.position.y,
            plane.position.z
          );
          //set the same rotation as plane
          mesh.rotation.set(
            plane.rotation.x,
            plane.rotation.y,
            plane.rotation.z
          );
          mesh.name = plane.name;
          pickingObjects.push(mesh);
          pickingScene.add(mesh);
        }
        for (
          let i = planes.length + spheres.length;
          i < planes.length + spheres.length + lines.length;
          i++
        ) {
          const line = lines[i - planes.length - spheres.length];
          //get geometry of the plane
          const geometry = line.geometry.clone();
          const color = new THREE.Color();
          applyVertexColors(geometry, color.setHex(i));
          const mesh = new THREE.Mesh(geometry, pickingMaterial);
          mesh.name = line.name;
          pickingObjects.push(mesh);
          pickingScene.add(mesh);
        }
      };
      setupPickingObjects();
      //get pointer coordinates in canvas
      let pointer = { x: -1, y: -1 };
      let absolutePointer = { x: -1, y: -1 };
      let lastObject = null,
        currentObject = null;
      let startX = null,
        startY = null;

      //setup the mouse events
      canvas.addEventListener('mousemove', (e) => {
        pointer = { x: e.offsetX, y: e.offsetY };
        //get absolute position
        absolutePointer = { x: e.clientX, y: e.clientY };
      });
      let mouseDown = false,
        shift = false;
      let mouseDownTime = 0;
      let mouseUpTime = 0;
      window.addEventListener('keydown', (e) => {
        //check shift key is pressed no keycode
        if (e.key === 'Shift') {
          shift = true;
        }
      });
      window.addEventListener('keyup', (e) => {
        shift = false;
      });
      canvas.addEventListener('mousedown', (e) => {
        console.log('mousedown');
        mouseDown = true;
        startX = e.clientX;
        startY = e.clientY;
        mouseDownTime = new Date().getTime();
      });
      window.addEventListener('mouseup', (e) => {
        mouseDown = false;
        mouseUpTime = new Date().getTime();
      });
      //listen to wheel event
      canvas.addEventListener('wheel', (e) => {
        if (!render3dView) {
          //set the camera zoom level
          const zoom = -e.deltaY / 10000;
          camera.zoom += zoom;
        }
      });

      //pinch to zoom

      const gesture = new PinchGesture(canvas, (state) => {
        if (render3dView) return;
        const {
          da, // [d,a] absolute distance and angle of the two pointers
          origin, // coordinates of the center between the two touch event
          offset, // [scale, angle] offsets (starts withs scale=1)
        } = state;
        camera.zoom = offset[0];
      });

      const pick = () => {
        if (pointer.x < 0 || pointer.y < 0) return -1;
        const pixelRatio = renderer.getPixelRatio();
        // set the view offset to represent just a single pixel under the mouse
        camera.setViewOffset(
          canvas.clientWidth,
          canvas.clientHeight,
          pointer.x * pixelRatio,
          pointer.y * pixelRatio,
          1,
          1
        );
        // render the scene
        renderer.setRenderTarget(pickingRenderer);
        renderer.render(pickingScene, camera);
        renderer.setRenderTarget(null);
        //clear the view offset so the camera returns to normal
        camera.clearViewOffset();
        // get the pixel color under the mouse
        const pixelBuffer = new Uint8Array(4);
        renderer.readRenderTargetPixels(
          pickingRenderer,
          0,
          0,
          1,
          1,
          pixelBuffer
        );
        const id =
          (pixelBuffer[0] << 16) | (pixelBuffer[1] << 8) | pixelBuffer[2];
        return id;
      };

      const handlePick = () => {
        if (mouseDown || shift) return;
        const id = pick();
        const sphere = spheres[id];
        const plane = planes[id - spheres.length];
        const line = lines[id - spheres.length - planes.length];

        if (sphere) {
          sphere.material.emissive.setHex(0xffffff);
        } else if (plane) {
          plane.material.color.setHex(0xffffff);
        } else if (line) {
          // line.material.color.multiplyScalar(1.5);
        }
        return sphere || plane || line;
      };

      let lastCam = null,
        cam3dView = null;
      //create a return button
      const returnButton = document.createElement('button');
      let render3dView = true;
      returnButton.innerText = 'return to 3d view';
      returnButton.addEventListener('click', () => {
        if (lastCam) {
          // console.log('lastCam', lastCam.position, lastCam.rotation);
          // console.log('camera', camera.position, camera.rotation);
          linearCameraAnimation(camera, cam3dView, 500, () => {
            requestAnimationFrame(render);
          });
        }
        //disable the button
        returnButton.disabled = true;
        render3dView = true;
        scene.traverse((child) => {
          child.visible = true;
        });
        pickingScene.traverse((child) => {
          child.visible = true;
        });
      });

      canvas.addEventListener('click', () => {
        if (
          render3dView &&
          currentObject &&
          currentObject.name.includes('plane') &&
          !shift &&
          mouseUpTime - mouseDownTime < 500
        ) {
          render3dView = false;
          //get layer id
          const layerId = currentObject.name.split('_')[1];

          pickingObjects.forEach((child) => {
            if (!child.name.includes(`layer_${layerId}`)) {
              child.visible = false;
            }
          });

          spheres.forEach((sphere) => {
            if (!sphere.name.includes(`layer_${layerId}`)) {
              sphere.visible = false;
            }
          });
          planes.forEach((plane) => {
            // if (!plane.name.includes(`layer_${layerId}`)) {
            plane.visible = false;
            // }
          });
          lines.forEach((line) => {
            if (!line.name.includes(`layer_${layerId}`)) {
              line.visible = false;
            }
          });
          let endCam = camera.clone();
          endCam.lookAt(
            endCam.position.x,
            endCam.position.y + 100,
            endCam.position.z
          );
          cam3dView = camera.clone();

          linearCameraAnimation(camera, endCam, 500, () => {
            requestAnimationFrame(render);
          });
        }
      });

      //setup the controls
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      let then = 0;
      dom.appendChild(returnButton);
      dom.appendChild(infoPanel);

      //create play toggle button
      const playToggle = document.createElement('button');
      playToggle.innerText = 'play';
      let toggled = false;
      dom.appendChild(playToggle);

      const step = () => {
        let currentVal = parseInt(slider.value);
        jump(currentVal + 1);
        slider.value = currentVal + 1;
      };

      //create a slider
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = 0;
      slider.max = lines.length - 1;
      slider.value =lines.length - 1;
      slider.step = 1;
      slider.addEventListener('input', (e) => {
        toggled = false;
        playToggle.innerText = 'play';
        const searchSteps = e.target.value;
        jump(searchSteps);
      });
      dom.appendChild(slider);
      const play = async () => {
        while (parseInt(slider.value) <= parseInt(slider.max)) {
          if (!toggled) return;
          step();
          await delay(300);
        }
        toggled = false;
        playToggle.innerText = 'play';
      };
      playToggle.addEventListener('click', () => {
        if (!toggled) {
          playToggle.innerText = 'pause';
          toggled = true;
          play(); //start playing
        } else {
          playToggle.innerText = 'play';
          toggled = false;
        }
      });

      let inAnimation = false; //check if in animation
      /**
       *
       * @param {THREE.Camera} startCam
       * @param {THREE.Camera} endCam
       * @param {number} duration
       * @param {function} onComplete
       * @returns
       */
      const linearCameraAnimation = (
        startCam,
        endCam,
        duration = 2000,
        callback = () => {}
      ) => {
        const start = {
          position: startCam.position.clone(),
          quaternion: startCam.quaternion.clone(),
          zoom: startCam.zoom,
        };
        const end = {
          position: endCam.position.clone(),
          quaternion: endCam.quaternion.clone(),
          zoom: endCam.zoom,
        };
        let startTime = new Date().getTime();
        let endTime = startTime + duration;
        const startAnimation = () => {
          inAnimation = true;
          startTime = new Date().getTime();
          endTime = startTime + duration;
          animate();
        };
        const animate = () => {
          const now = new Date().getTime();
          const t = (now - startTime) / duration;
          if (t >= 1) {
            camera.position.copy(end.position);
            camera.quaternion.copy(end.quaternion);
            camera.zoom = end.zoom;
            inAnimation = false;
            if (callback) callback();
            return;
          }
          camera.position.copy(start.position.clone().lerp(end.position, t));
          camera.quaternion.copy(
            start.quaternion.clone().slerp(end.quaternion, t)
          );
          camera.zoom = start.zoom + (end.zoom - start.zoom) * t;
          composer.render();
          requestAnimationFrame(animate);
        };
        startAnimation();
      };

      const render = (now) => {
        if (inAnimation) return;
        if (render3dView) {
          controls.enabled = true;

          //recover the camera
          if (lastCam) {
            pickingObjects.forEach((child) => {
              child.visible = true;
            });
            // console.log('lastCam', lastCam.position, lastCam.rotation);
            // console.log('camera', camera.position, camera.rotation);
            // //recover the camera
            // camera.position.set(
            //   lastCam.position.x,
            //   lastCam.position.y,
            //   lastCam.position.z
            // );
            // camera.rotation.set(
            //   lastCam.rotation.x,
            //   lastCam.rotation.y,
            //   lastCam.rotation.z
            // );
            // camera.updateProjectionMatrix();
            controls.update();

            lastCam = null;
          }
        } else {
          //disable the controls
          controls.enabled = false;
          // controls.enableDamping = false;
          // controls.enablePan = false;
          // controls.enableRotate = false;
          // controls.enableZoom = true;
          //enable the button
          returnButton.disabled = false;
          lastCam = camera.clone();
          if (mouseDown && shift && startX && startY) {
            let dx = absolutePointer.x - startX;
            let dy = absolutePointer.y - startY;
            let cameraX = camera.position.x + dx * 10;
            let cameraY = camera.position.y;
            let cameraZ = camera.position.z + dy * 10;
            startX = absolutePointer.x;
            startY = absolutePointer.y;
            console.log(
              `cameraX: ${cameraX}, cameraY: ${cameraY}, cameraZ: ${cameraZ}`
            );
            camera.position.set(cameraX, cameraY, cameraZ);
            camera.lookAt(cameraX, cameraY + 100, cameraZ);

            // camera.lookAt(dx, 100, dy);
          } else {
            camera.lookAt(
              camera.position.x,
              camera.position.y + 100,
              camera.position.z
            );
          }

          camera.updateProjectionMatrix();
        }
        now *= 0.001;
        const deltaTime = now - then;
        then = now;

        if (!mouseDown && !shift) {
          currentObject = handlePick();
          if (currentObject && currentObject.hnswData) {
            // console.log(currentObject.hnswData);
            infoPanel.innerHTML = /*html*/ `
          <div><b>id:</b> ${currentObject.hnswData.id}</div>
          <div><b>distance:</b> ${currentObject.hnswData.dist}</div>
          `;
          }
          if (currentObject !== lastObject) {
            if (lastObject && lastObject.name.includes('node')) {
              lastObject.material.emissive.setHex(0x000000);
            } else if (lastObject && lastObject.name.includes('plane')) {
              lastObject.material.color.setHex(0x0055ff);
            }
          }
          lastObject = currentObject;
        }
        if (render3dView) {
          cam3dView = camera.clone();
        }
        cam3dView.zoom = camera.zoom;
        //render the scene
        composer.render(deltaTime);

        //request the next frame
        requestAnimationFrame(render);
      };
      render();
    };
    setup3d();

    finishLoading(dom);
    // this.renderSearchView(
    //   ctx,
    //   infoPanel,
    //   searchViewLayoutData,
    //   targetMediaUrl,
    //   dom
    // );
    // const eventHandlers = this.getSearchViewEventHandler(
    //   ctx,
    //   searchViewLayoutData,
    //   infoPanel
    // );
    // addMouseListener(canvas, this.canvasScale, eventHandlers);
  }
}

const addMouseListener = (
  element,
  canvasScale,
  { mouseMoveHandler, mouseClickHandler, mouseLeaveHandler } = {}
) => {
  element.addEventListener('mousemove', (e) => {
    const { offsetX, offsetY } = e;
    const x = offsetX * canvasScale;
    const y = offsetY * canvasScale;
    mouseMoveHandler && mouseMoveHandler({ x, y });
  });
  element.addEventListener('click', (e) => {
    const { offsetX, offsetY } = e;
    const x = offsetX * canvasScale;
    const y = offsetY * canvasScale;
    mouseClickHandler && mouseClickHandler({ x, y });
  });
  element.addEventListener('mouseleave', () => {
    mouseLeaveHandler && mouseLeaveHandler();
  });
};

const initCanvas = (dom, clientWidth, clientHeight, canvasScale) => {
  renderLoading(dom, clientWidth, clientHeight);

  const domD3 = d3.select(dom);
  domD3.selectAll('canvas').remove();

  const canvas = domD3
    .append('canvas')
    .attr('width', clientWidth)
    .attr('height', clientHeight);
  // const ctx = canvas.node().getContext('2d');
  // ctx.scale(1 / canvasScale, 1 / canvasScale);

  return canvas.node();
};
/**
 *
 * @param {THREE.Geometry} geometry
 * @param {THREE.Color } color
 */
function applyVertexColors(geometry, color) {
  const positions = geometry.getAttribute('position');
  const colors = [];
  for (let i = 0; i < positions.count; i++) {
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}
