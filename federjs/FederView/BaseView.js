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
import { BloomPass } from './jsm/postprocessing/BloomPass';
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
    document.body.appendChild(canvas);

    const searchViewLayoutData = await this.searchViewHandler(searchRes);
    // console.log(searchViewLayoutData.visData, searchViewLayoutData.id2forcePos);

    const setup3d = () => {
      const scene = new THREE.Scene();

      //setup the orthographic camera
      const camera = new THREE.OrthographicCamera(
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
      let entryPts = [],
        finePts = [];
      let maxX = 0,
        maxY = 0,
        minX = 0,
        minY = 0;
      // add the nodes to the scene
      const setupNodes = () => {
        let z0 = 0;
        for (let i = searchViewLayoutData.visData.length - 1; i >= 0; i--) {
          const { entryIds, fineIds, links, nodes } =
            searchViewLayoutData.visData[i];
          const { id2forcePos } = searchViewLayoutData;
          entryPts.unshift(
            new THREE.Vector3(
              id2forcePos[entryIds[0]][0],
              z0,
              id2forcePos[entryIds[0]][1]
            )
          );
          finePts.unshift(
            new THREE.Vector3(
              id2forcePos[fineIds[0]][0],
              z0,
              id2forcePos[fineIds[0]][1]
            )
          );

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
            sphere.position.set(x, z0, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            spheres.push(sphere);
            scene.add(sphere);
          }

          z0 += 400;
        }
      };
      setupNodes();

      let planes = [];
      const setupPlanes = () => {
        console.log(maxX, maxY, minX, minY);
        let z0 = -10;
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
          });
          const plane = new THREE.Mesh(planeGeometry, planeMaterial);
          plane.position.set(0, z0, 0);
          plane.rotateX(Math.PI / 2);
          z0 += 400;
          scene.add(plane);
          planes.push(plane);
        }
      };
      setupPlanes();
      //gpu picking
      const pickingScene = new THREE.Scene();
      const pickingRenderer = new THREE.WebGLRenderTarget(
        canvas.clientWidth,
        canvas.clientHeight
      );
      pickingScene.background = new THREE.Color(0xffffff);
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
        geometry.setAttribute(
          'color',
          new THREE.Float32BufferAttribute(colors, 3)
        );
      }
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
          pickingScene.add(mesh);
        }
      };
      setupPickingObjects();
      //get pointer coordinates in canvas
      let pointer = { x: -1, y: -1 };
      //setup the mouse events
      canvas.addEventListener('mousemove', (e) => {
        pointer = { x: e.offsetX, y: e.offsetY };
      });
      let selectedLayer = null;
      let render2d = false;
      canvas.addEventListener('mousedown', (e) => {
        if (!render2d) {
          render2d = !render2d;
          const id = pick();
          const plane = planes[id - spheres.length];
          if (plane) {
            plane.material.color.setHex(0xffff00);
            selectedLayer = plane;

            camera.position.y = selectedLayer.position.y + 400;
            camera.position.z = 0;
            camera.position.x = 0;
            camera.lookAt(new THREE.Vector3(0, selectedLayer.position.y, 0));
            const layerId =
              searchViewLayoutData.visData.length -
              1 -
              (selectedLayer.position.y + 10) / 400;
            scene.traverse((child) => {
              console.log(selectedLayer.position.y + 10);
              if (child.position.y !== selectedLayer.position.y + 10) {
                if (child.type === spheres[0].type) {
                  child.visible = false;
                }
              }
              if (
                child.name.substring(0, 4) === 'link' &&
                child.name !== `link-${layerId}`
              ) {
                child.visible = false;
              }
              if(child.name==="link-up"){
                child.visible = false;
              }
            });
          }
        }
      });
      canvas.addEventListener('mouseup', (e) => {
        if (selectedLayer) {
          // selectedLayer.material.color.setHex(0x0055ff);
          // selectedLayer = null;
        }
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

      const setupLinks = async () => {
        let z0 = 0;
        let lines = [];
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
            });
            //create a new line
            const line = new THREE.Line(lineGeometry, material);
            line.name = `link-${i}`;
            if (opacity > 0) lines.push(line);
          }
          if (i > 0) {
            const finePt = finePts[i];
            const entryPt = entryPts[i - 1];
            const lineGeometry = new THREE.BufferGeometry().setFromPoints([
              entryPt,
              finePt,
            ]);
            const material = new THREE.LineBasicMaterial({
              color: new THREE.Color(0xeeee00),
            });
            const line = new THREE.Line(lineGeometry, material);
            line.name=`link-up`
            lines.push(line);
          }
          z0 += 400;
        }

        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        for (let i = 0; i < lines.length; i++) {
          scene.add(lines[i]);
          // await delay(500);
        }
      };
      setupLinks();

      //adjust the display 响应式画布会用到，暂时不用
      function adjustDisplay() {
        renderer.setSize(
          renderer.domElement.clientWidth,
          renderer.domElement.clientHeight
        );
        camera.left = canvas.clientWidth * -1;
        camera.right = canvas.clientWidth;
        camera.top = canvas.clientHeight;
        camera.bottom = canvas.clientHeight * -1;
        camera.updateProjectionMatrix();
      }

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
        // bloomPass.threshold = 0.7;
        composer.addPass(bloomPass);
        // composer.addPass(bloomPass);
      };
      setupPostProcessing();

      //setup the controls
      const controls = new OrbitControls(camera, renderer.domElement);
      let lastObject = null,
        then = 0;

      const render = (now) => {
        now *= 0.001;
        const deltaTime = now - then;
        then = now;
        //update the controls
        controls.update();

        //pick
        const id = pick();
        const object = spheres[id];
        if (object) {
          //change emissive color
          object.material.emissive.setHex(0xffccd1);
        }
        if (lastObject !== object && lastObject) {
          lastObject.material.emissive.setHex(0x000000);
        }
        lastObject = object;

        //render the scene
        // renderer.render(scene, camera);
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
